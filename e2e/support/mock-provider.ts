import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export interface RecordedCall {
  model: string;
  stream: boolean;
  question: string;
  systemChars: number;
  cacheMarked: boolean;
  hasSchema: boolean;
  lastRole: string;
}

export interface MockProvider {
  url: string;
  calls: RecordedCall[];
  close: () => Promise<void>;
}

interface Scenario {
  status: number;
  text: string;
  stopReason: string;
  delayMs: number;
  breakMidStream: boolean;
}

const USAGE = { input_tokens: 40, output_tokens: 25, cache_read_input_tokens: 5000 };
const CHUNK_CHARS = 9;
const FIRST_TOKEN_DELAY_MS = 30;

const reply = (onTopic: boolean, answer: string): string =>
  JSON.stringify({ on_topic: onTopic, answer });

const scenarioFor = (question: string): Scenario => {
  const base = { status: 200, stopReason: "end_turn", delayMs: 0, breakMidStream: false };
  if (question.includes("OFFTOPIC")) {
    return { ...base, text: reply(false, "I cannot help with that.") };
  }
  if (question.includes("REFUSAL")) {
    return { ...base, text: "", stopReason: "refusal" };
  }
  if (question.includes("GARBAGE")) {
    return { ...base, text: "this is not the reply shape" };
  }
  if (question.includes("UPSTREAM500")) {
    return { ...base, status: 500, text: "" };
  }
  if (question.includes("BREAK")) {
    return { ...base, text: reply(true, "This answer breaks half way."), breakMidStream: true };
  }
  return { ...base, text: reply(true, `Answer to: ${question} — with "quotes" and\na newline.`) };
};

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

interface ProviderRequest {
  model: string;
  stream?: boolean;
  system?: { text: string; cache_control?: unknown }[];
  messages: { role: string; content: string }[];
  output_config?: { format?: unknown };
}

const describe = (body: ProviderRequest): RecordedCall => {
  const users = body.messages.filter((message) => message.role === "user");
  const system = body.system ?? [];
  return {
    model: body.model,
    stream: body.stream === true,
    question: users.at(-1)?.content ?? "",
    systemChars: system.reduce((total, block) => total + block.text.length, 0),
    cacheMarked: system.some((block) => block.cache_control !== undefined),
    hasSchema: body.output_config?.format !== undefined,
    lastRole: body.messages.at(-1)?.role ?? "",
  };
};

const messageOf = (model: string, scenario: Scenario): Record<string, unknown> => ({
  id: "msg_mock",
  type: "message",
  role: "assistant",
  model,
  content: scenario.text === "" ? [] : [{ type: "text", text: scenario.text }],
  stop_reason: scenario.stopReason,
  stop_sequence: null,
  usage: USAGE,
});

const chunksOf = (text: string): string[] =>
  Array.from({ length: Math.ceil(text.length / CHUNK_CHARS) }, (_, index) =>
    text.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS),
  );

const writeEvent = (
  response: ServerResponse,
  type: string,
  data: Record<string, unknown>,
): void => {
  response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
};

const streamReply = async (
  response: ServerResponse,
  model: string,
  scenario: Scenario,
): Promise<void> => {
  response.writeHead(200, { "content-type": "text/event-stream" });
  writeEvent(response, "message_start", {
    message: { ...messageOf(model, scenario), content: [], stop_reason: null },
  });
  writeEvent(response, "content_block_start", {
    index: 0,
    content_block: { type: "text", text: "" },
  });
  await sleep(FIRST_TOKEN_DELAY_MS);
  const chunks = chunksOf(scenario.text);
  for (const [index, chunk] of chunks.entries()) {
    if (scenario.breakMidStream && index === Math.floor(chunks.length / 2)) {
      response.destroy();
      return;
    }
    writeEvent(response, "content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text: chunk },
    });
    await sleep(2);
  }
  writeEvent(response, "content_block_stop", { index: 0 });
  writeEvent(response, "message_delta", {
    delta: { stop_reason: scenario.stopReason, stop_sequence: null },
    usage: { output_tokens: USAGE.output_tokens },
  });
  writeEvent(response, "message_stop", {});
  response.end();
};

const handle = async (
  request: IncomingMessage,
  response: ServerResponse,
  calls: RecordedCall[],
): Promise<void> => {
  if (request.url === "/__calls") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(calls));
    return;
  }
  const body = JSON.parse(await readBody(request)) as ProviderRequest;
  const call = describe(body);
  calls.push(call);
  const scenario = scenarioFor(call.question);
  if (scenario.status !== 200) {
    response.writeHead(scenario.status, {
      "content-type": "application/json",
      "x-should-retry": "false",
    });
    response.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "mock" } }));
    return;
  }
  if (call.stream) {
    await streamReply(response, body.model, scenario);
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(messageOf(body.model, scenario)));
};

const listen = async (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

export const startMockProvider = async (): Promise<MockProvider> => {
  const calls: RecordedCall[] = [];
  const server = createServer((request, response) => {
    handle(request, response, calls).catch(() => {
      response.destroy();
    });
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${String(port)}`,
    calls,
    close: async () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
};
