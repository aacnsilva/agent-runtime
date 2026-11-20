import { describe, expect, it } from "vitest";

import type { AnthropicSettings } from "../src/llm/anthropic";
import { createAnthropicProvider } from "../src/llm/anthropic";
import type { ModelRequest, Provider } from "../src/llm/provider";

const REQUEST: ModelRequest = {
  maxOutputTokens: 300,
  effort: "low",
  system: "You are the example helper.",
  systemTail: [],
  messages: [{ role: "user", content: "hello" }],
  trailingReminder: undefined,
  replySchema: undefined,
  tools: [],
  thinking: "off",
};

const frame = (type: string, data: Record<string, unknown>): string =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const OPENING = [
  frame("message_start", {
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  }),
  frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
];

const CLOSING = [
  frame("content_block_stop", { index: 0 }),
  frame("message_delta", {
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 5 },
  }),
  frame("message_stop", {}),
];

const delta = (text: string): string =>
  frame("content_block_delta", { index: 0, delta: { type: "text_delta", text } });

interface Script {
  frames: string[];
  gapMs: number;
  thenHang: boolean;
}

const pause = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const sseBody = (
  script: Script,
  signal: AbortSignal | null | undefined,
): ReadableStream<Uint8Array> =>
  new ReadableStream({
    async start(controller) {
      signal?.addEventListener("abort", () => {
        controller.error(new DOMException("aborted", "AbortError"));
      });
      const encoder = new TextEncoder();
      for (const piece of script.frames) {
        await pause(script.gapMs);
        if (signal?.aborted === true) {
          return;
        }
        controller.enqueue(encoder.encode(piece));
      }
      if (!script.thenHang) {
        controller.close();
      }
    },
  });

const streaming =
  (script: Script): typeof fetch =>
  (_input, init) =>
    Promise.resolve(
      new Response(sseBody(script, init?.signal), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

const answering =
  (status: number): typeof fetch =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify({ type: "error", error: { type: "x", message: "mock" } }), {
        status,
        headers: { "content-type": "application/json", "x-should-retry": "false" },
      }),
    );

const providerWith = (settings: Partial<AnthropicSettings>): Provider =>
  createAnthropicProvider({
    apiKey: "test-key",
    baseURL: "https://provider.example",
    firstByteTimeoutMs: 80,
    streamIdleTimeoutMs: 80,
    ...settings,
  });

const failureOf = async (provider: Provider): Promise<string> =>
  provider.complete("claude-haiku-5-5", REQUEST, {}).then(
    () => "answered",
    (error: unknown) => provider.failureKind(error),
  );

describe("anthropic provider", () => {
  it("lets an answer run far longer than the first-byte limit while it keeps arriving", async () => {
    const words = Array.from({ length: 12 }, (_, index) => `w${String(index)} `);
    const provider = providerWith({
      fetch: streaming({
        frames: [...OPENING, ...words.map(delta), ...CLOSING],
        gapMs: 25,
        thenHang: false,
      }),
    });
    const heard: string[] = [];
    const reply = await provider.complete("claude-haiku-5-5", REQUEST, {
      onText: (text) => heard.push(text),
    });
    expect(reply.text).toBe(words.join(""));
    expect(heard.join("")).toBe(words.join(""));
    expect(reply.usage).toMatchObject({ input: 10, output: 5 });
  });

  it("streams from the provider even when the caller did not ask to listen", async () => {
    const bodies: string[] = [];
    const inner = streaming({
      frames: [...OPENING, delta("hi"), ...CLOSING],
      gapMs: 0,
      thenHang: false,
    });
    const provider = providerWith({
      fetch: (input, init) => {
        bodies.push(typeof init?.body === "string" ? init.body : "");
        return inner(input, init);
      },
    });
    expect((await provider.complete("claude-haiku-5-5", REQUEST, {})).text).toBe("hi");
    expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({ stream: true });
  });

  it("gives up on a stream that goes silent, and calls it a timeout", async () => {
    const provider = providerWith({
      fetch: streaming({ frames: [...OPENING, delta("half")], gapMs: 5, thenHang: true }),
    });
    expect(await failureOf(provider)).toBe("timeout");
  });

  it("stops the model call when the caller's signal fires", async () => {
    const abort = new AbortController();
    const provider = providerWith({
      signal: abort.signal,
      streamIdleTimeoutMs: 5000,
      fetch: streaming({ frames: [...OPENING, delta("half")], gapMs: 5, thenHang: true }),
    });
    setTimeout(() => {
      abort.abort();
    }, 60);
    expect(await failureOf(provider)).toBe("aborted");
  });

  it.each([
    [400, "rejected"],
    [401, "rejected"],
    [404, "rejected"],
    [429, "unavailable"],
    [500, "unavailable"],
    [529, "unavailable"],
  ])("reads a %i from the provider as %s", async (status, kind) => {
    expect(await failureOf(providerWith({ fetch: answering(status) }))).toBe(kind);
  });
});
