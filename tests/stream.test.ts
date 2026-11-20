import { describe, expect, it } from "vitest";

import type { RequestContext } from "../src/gateway/context";
import { streamResponse } from "../src/gateway/stream";

interface Harness {
  context: RequestContext;
  settled: () => Promise<unknown>;
}

const harness = (): Harness => {
  const work: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      work.push(promise);
    },
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;
  return {
    context: {
      request: new Request("https://runtime.example/v1/tenants/demo/runs"),
      env: {} as RequestContext["env"],
      ctx,
      abort: new AbortController(),
      requestId: "r-1",
      startedAt: 0,
    },
    settled: async () => Promise.all(work),
  };
};

const eventsOf = async (response: Response): Promise<Record<string, unknown>[]> =>
  (await response.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)) as Record<string, unknown>);

describe("event stream", () => {
  it("sends the deltas in order and ends on the last event", async () => {
    const { context } = harness();
    const response = streamResponse(context, (emit) => {
      emit({ type: "delta", text: "one" });
      emit({ type: "delta", text: "two" });
      return Promise.resolve({ type: "done" });
    });
    expect((await eventsOf(response)).map((event) => event["type"])).toEqual([
      "delta",
      "delta",
      "done",
    ]);
  });

  it("ends on an error event and closes when the work throws something unexpected", async () => {
    const { context, settled } = harness();
    const response = streamResponse(context, (emit) => {
      emit({ type: "delta", text: "half an ans" });
      return Promise.reject(new TypeError("a bug"));
    });
    const events = await eventsOf(response);
    expect(events.at(-1)).toMatchObject({ type: "error", error: "internal" });
    expect(JSON.stringify(events)).not.toContain("a bug");
    await settled();
  });

  it("signals the work to stop when the reader goes away", async () => {
    const { context, settled } = harness();
    const response = streamResponse(
      context,
      async (emit) =>
        new Promise((resolve) => {
          emit({ type: "delta", text: "first" });
          context.abort.signal.addEventListener("abort", () => {
            resolve({ type: "done" });
          });
        }),
    );
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    await settled();
    expect(context.abort.signal.aborted).toBe(true);
  });
});
