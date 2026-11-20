import { describe, expect, it } from "vitest";

import demo from "../examples/tenants/demo.tenant.json" with { type: "json" };
import type { RunInput } from "../src/agent/run";
import { answer, reserve } from "../src/agent/run";
import type { LedgerPort } from "../src/agent/spend";
import { limitsOf } from "../src/agent/spend";
import { Rejection } from "../src/http/respond";
import { createBreaker } from "../src/llm/breaker";
import type { ModelId, Tier } from "../src/llm/catalog";
import type { ModelReply, Provider } from "../src/llm/provider";
import { routeWithFallback } from "../src/llm/router";
import type { LedgerState } from "../src/quota/ledger";
import { begin, emptyState, release, reservedNanoEur, settle } from "../src/quota/ledger";
import type { GatedAgent, Tenant } from "../src/tenants/schema";
import { tenantSchema } from "../src/tenants/schema";

const tenant: Tenant = tenantSchema.parse(demo);

const gatedAgent = (): GatedAgent => {
  if (tenant.agent.kind !== "gated") {
    throw new Error("the example tenant is gated");
  }
  return tenant.agent;
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
const GOOD: ModelReply = {
  text: '{"on_topic": true, "answer": "Yes."}',
  blocks: [],
  stopReason: "end_turn",
  usage: USAGE,
};

type Behaviour = (model: ModelId, onText: ((text: string) => void) | undefined) => ModelReply;

const providerThat = (behaviour: Behaviour): Provider & { models: ModelId[] } => {
  const models: ModelId[] = [];
  return {
    models,
    isTimeout: (error) => error === TIMEOUT,
    complete: (model, _request, listeners) => {
      models.push(model);
      try {
        return Promise.resolve(behaviour(model, listeners.onText));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("failed"));
      }
    },
  };
};

const inputFor = (tier: Tier, provider: Provider, book: Book): RunInput => ({
  spend: {
    tenant,
    tier,
    effortOverride: null,
    ip: "1.1.1.1",
    skipNetworkLimit: false,
    provider,
    ledger: book.port,
  },
  agent: gatedAgent(),
  messages: [{ role: "user", content: "Does Lumen sync?" }],
});

describe("run", () => {
  it("settles at the real cost of the model that answered", async () => {
    const book = createBook();
    const input = inputFor(
      "fast",
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
    const input = inputFor("balanced", provider, book);
    const run = await answer(input, await reserve(input), undefined);
    expect(provider.models).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(run).toMatchObject({ status: 200, model: "claude-haiku-5-5", attempts: 2 });
  });

  it("gives the reservation back when every model fails before writing anything", async () => {
    const book = createBook();
    const provider = providerThat(() => {
      throw new Error("down");
    });
    const input = inputFor("balanced", provider, book);
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
    const input = inputFor("balanced", provider, book);
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
    const input = inputFor("balanced", provider, book);
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
    const input = inputFor(
      "fast",
      providerThat(() => GOOD),
      book,
    );
    const poor = { ...tenant, limits: { ...tenant.limits, poolEurPerMonth: 0 } };
    const refusal = await reserve({ ...input, spend: { ...input.spend, tenant: poor } }).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(Rejection);
    expect(refusal).toMatchObject({ status: 429, code: "budget" });
    expect(limitsOf(poor).poolNanoEur).toBe(0);
  });
});

describe("circuit breaker", () => {
  const failing = (): Promise<ModelReply> => Promise.reject(new Error("down"));

  it("skips a model that failed three times in a row, then tries it again after a pause", async () => {
    const breaker = createBreaker();
    const tried: ModelId[] = [];
    const route = async (): Promise<unknown> =>
      routeWithFallback({
        candidates: ["claude-sonnet-5-5", "claude-haiku-5-5"],
        breaker,
        isBillable: () => false,
        call: (model) => {
          tried.push(model);
          return model === "claude-sonnet-5-5" ? failing() : Promise.resolve(GOOD);
        },
      });
    await route();
    await route();
    await route();
    expect(tried.filter((model) => model === "claude-sonnet-5-5")).toHaveLength(3);
    await route();
    expect(tried.at(-1)).toBe("claude-haiku-5-5");
    expect(tried.filter((model) => model === "claude-sonnet-5-5")).toHaveLength(3);
    expect(breaker.isOpen("claude-sonnet-5-5", Date.now())).toBe(true);
    expect(breaker.isOpen("claude-sonnet-5-5", Date.now() + 31_000)).toBe(false);
  });

  it("still tries the only model there is when its circuit is open", () => {
    const breaker = createBreaker();
    const now = Date.now();
    breaker.failed("claude-haiku-5-5", now);
    breaker.failed("claude-haiku-5-5", now);
    breaker.failed("claude-haiku-5-5", now);
    expect(breaker.order(["claude-haiku-5-5"], now)).toEqual(["claude-haiku-5-5"]);
  });

  it("closes a circuit as soon as the model answers", () => {
    const breaker = createBreaker();
    breaker.failed("claude-haiku-5-5", 0);
    breaker.failed("claude-haiku-5-5", 0);
    breaker.succeeded("claude-haiku-5-5");
    breaker.failed("claude-haiku-5-5", 0);
    expect(breaker.isOpen("claude-haiku-5-5", 0)).toBe(false);
  });
});
