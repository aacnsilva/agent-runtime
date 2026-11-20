import { describe, expect, it } from "vitest";

import demo from "../examples/tenants/demo.tenant.json" with { type: "json" };
import type { LedgerPort, RunInput } from "../src/agent/run";
import { answer, limitsOf, reserve } from "../src/agent/run";
import { Rejection } from "../src/http/respond";
import type { ModelId } from "../src/llm/catalog";
import type { Completion, Provider } from "../src/llm/provider";
import type { LedgerState } from "../src/quota/ledger";
import { begin, emptyState, release, reservedNanoEur, settle } from "../src/quota/ledger";
import type { Tenant } from "../src/tenants/schema";
import { tenantSchema } from "../src/tenants/schema";

const tenantWith = (tier: Tenant["agent"]["tier"]): Tenant => {
  const tenant = tenantSchema.parse(demo);
  return { ...tenant, agent: { ...tenant.agent, tier } };
};

interface Book {
  state: LedgerState;
  port: LedgerPort;
}

const createBook = (): Book => {
  const book: Book = {
    state: emptyState(Date.now()),
    port: {
      begin: (input) => {
        const step = begin(book.state, input);
        book.state = step.state;
        return Promise.resolve(step.result);
      },
      settle: (input) => {
        book.state = settle(book.state, input).state;
        return Promise.resolve();
      },
      release: (input) => {
        book.state = release(book.state, input).state;
        return Promise.resolve();
      },
    },
  };
  return book;
};

const TIMEOUT = new Error("timeout");
const USAGE = { input: 1000, output: 100, cacheWrite: 0, cacheRead: 0 };
const GOOD: Completion = {
  text: '{"on_topic": true, "answer": "Yes."}',
  stopReason: "end_turn",
  usage: USAGE,
};

type Behaviour = (model: ModelId, onText: ((text: string) => void) | undefined) => Completion;

const providerThat = (behaviour: Behaviour): Provider & { models: ModelId[] } => {
  const models: ModelId[] = [];
  return {
    models,
    isTimeout: (error) => error === TIMEOUT,
    complete: (model, _request, onText) => {
      models.push(model);
      try {
        return Promise.resolve(behaviour(model, onText));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("failed"));
      }
    },
  };
};

const inputFor = (tenant: Tenant, provider: Provider, book: Book): RunInput => ({
  tenant,
  messages: [{ role: "user", content: "Does Lumen sync?" }],
  ip: "1.1.1.1",
  provider,
  ledger: book.port,
});

describe("run", () => {
  it("settles at the real cost of the model that answered", async () => {
    const book = createBook();
    const input = inputFor(
      tenantWith("fast"),
      providerThat(() => GOOD),
      book,
    );
    const run = await answer(input, await reserve(input), undefined);
    expect(run).toMatchObject({ status: 200, outcome: "answered", model: "claude-haiku-5-5" });
    expect(run.costNanoEur).toBe(Math.round((1000 * 100 + 100 * 500) / 1.08));
    expect(book.state.spentNanoEur).toBe(run.costNanoEur);
    expect(reservedNanoEur(book.state)).toBe(0);
  });

  it("falls back to the next model when the first fails before writing anything", async () => {
    const book = createBook();
    const provider = providerThat((model) => {
      if (model === "claude-sonnet-5-5") {
        throw new Error("overloaded");
      }
      return GOOD;
    });
    const input = inputFor(tenantWith("balanced"), provider, book);
    const run = await answer(input, await reserve(input), undefined);
    expect(provider.models).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(run).toMatchObject({ status: 200, model: "claude-haiku-5-5", attempts: 2 });
  });

  it("gives the reservation back when every model fails before writing anything", async () => {
    const book = createBook();
    const provider = providerThat(() => {
      throw new Error("down");
    });
    const input = inputFor(tenantWith("balanced"), provider, book);
    const run = await answer(input, await reserve(input), undefined);
    expect(run).toMatchObject({ status: 502, outcome: "upstream", costNanoEur: 0, attempts: 2 });
    expect(book.state.spentNanoEur).toBe(0);
    expect(reservedNanoEur(book.state)).toBe(0);
  });

  it("counts a timeout as spent and does not try another model", async () => {
    const book = createBook();
    const provider = providerThat(() => {
      throw TIMEOUT;
    });
    const input = inputFor(tenantWith("balanced"), provider, book);
    const reservation = await reserve(input);
    const run = await answer(input, reservation, undefined);
    expect(provider.models).toEqual(["claude-sonnet-5-5"]);
    expect(run).toMatchObject({ status: 502, outcome: "upstream_billed" });
    expect(book.state.spentNanoEur).toBe(reservation.nanoEur);
  });

  it("counts a stream that broke after it began as spent, with no silent retry", async () => {
    const book = createBook();
    const provider = providerThat((_model, onText) => {
      onText?.('{"on_topic": true, "answer": "Par');
      throw new Error("connection lost");
    });
    const input = inputFor(tenantWith("balanced"), provider, book);
    const reservation = await reserve(input);
    const heard: string[] = [];
    const run = await answer(input, reservation, (text) => heard.push(text));
    expect(provider.models).toHaveLength(1);
    expect(heard).toHaveLength(1);
    expect(run.outcome).toBe("upstream_billed");
    expect(book.state.spentNanoEur).toBe(reservation.nanoEur);
  });

  it("refuses with the limit's public message when the pool cannot cover the reservation", async () => {
    const book = createBook();
    const tenant = tenantWith("fast");
    const poor = { ...tenant, limits: { ...tenant.limits, poolEurPerMonth: 0 } };
    const refusal = await reserve(
      inputFor(
        poor,
        providerThat(() => GOOD),
        book,
      ),
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(Rejection);
    expect(refusal).toMatchObject({ status: 429, code: "budget" });
    expect(limitsOf(poor).poolNanoEur).toBe(0);
  });
});
