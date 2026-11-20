import Anthropic from "@anthropic-ai/sdk";

import type { ModelId } from "./catalog";
import { MODELS } from "./catalog";
import type { Usage } from "./cost";
import type {
  Listeners,
  MessageBlock,
  ModelMessage,
  ModelReply,
  ModelRequest,
  Provider,
  ReplyBlock,
} from "./provider";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 1;
const CACHED = { type: "ephemeral" } as const;

export interface AnthropicSettings {
  apiKey: string;
  baseURL: string | undefined;
}

type Params = Anthropic.MessageCreateParamsNonStreaming;

const blockParam = (block: MessageBlock): Anthropic.ContentBlockParam => {
  if (block.type === "image") {
    return {
      type: "image",
      source: { type: "base64", media_type: block.mediaType, data: block.data },
    };
  }
  return block;
};

const messageParam = (message: ModelMessage): Anthropic.MessageParam => ({
  role: message.role,
  content: typeof message.content === "string" ? message.content : message.content.map(blockParam),
});

const messagesFor = (request: ModelRequest): Anthropic.MessageParam[] => [
  ...request.messages.map(messageParam),
  ...(request.trailingReminder === undefined
    ? []
    : [{ role: "system" as const, content: request.trailingReminder }]),
];

const systemFor = (request: ModelRequest): Anthropic.TextBlockParam[] => [
  { type: "text", text: request.system, cache_control: CACHED },
  ...request.systemTail.map((text) => ({ type: "text" as const, text })),
];

const toolsFor = (request: ModelRequest): Pick<Params, "tools" | "tool_choice"> =>
  request.tools.length === 0
    ? {}
    : {
        tools: request.tools.map((tool, index) => ({
          name: tool.name,
          description: tool.description,
          input_schema: { type: "object" as const, ...tool.input_schema },
          ...(index === request.tools.length - 1 ? { cache_control: CACHED } : {}),
        })),
        tool_choice: { type: "auto" },
      };

const paramsFor = (model: ModelId, request: ModelRequest): Params => ({
  model,
  max_tokens: request.maxOutputTokens,
  system: systemFor(request),
  messages: messagesFor(request),
  ...toolsFor(request),
  ...(request.thinking === "off" ? { thinking: MODELS[model].thinkingOff } : {}),
  output_config: {
    effort: request.effort,
    ...(request.replySchema === undefined
      ? {}
      : { format: { type: "json_schema" as const, schema: request.replySchema } }),
  },
});

const usageOf = (usage: Anthropic.Usage): Usage => ({
  input: usage.input_tokens,
  output: usage.output_tokens,
  cacheWrite: usage.cache_creation_input_tokens ?? 0,
  cacheRead: usage.cache_read_input_tokens ?? 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const replyBlocks = (message: Anthropic.Message): ReplyBlock[] =>
  message.content.flatMap((block): ReplyBlock[] => {
    if (block.type === "text") {
      return block.text.trim() === "" ? [] : [{ type: "text", text: block.text }];
    }
    if (block.type === "tool_use") {
      const input = isRecord(block.input) ? block.input : {};
      return [{ type: "tool_use", id: block.id, name: block.name, input }];
    }
    return [];
  });

const replyOf = (message: Anthropic.Message): ModelReply => {
  const blocks = replyBlocks(message);
  return {
    blocks,
    text: blocks.map((block) => (block.type === "text" ? block.text : "")).join(""),
    stopReason: message.stop_reason,
    usage: usageOf(message.usage),
  };
};

const isToolStart = (event: Anthropic.MessageStreamEvent): boolean =>
  event.type === "content_block_start" && event.content_block.type === "tool_use";

export const createAnthropicProvider = (settings: AnthropicSettings): Provider => {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    ...(settings.baseURL === undefined ? {} : { baseURL: settings.baseURL }),
  });

  const streamed = async (params: Params, listeners: Listeners): Promise<Anthropic.Message> =>
    client.messages
      .stream(params)
      .on("text", (text) => listeners.onText?.(text))
      .on("streamEvent", (event) => {
        if (isToolStart(event)) {
          listeners.onTool?.();
        }
      })
      .finalMessage();

  const complete = async (
    model: ModelId,
    request: ModelRequest,
    listeners: Listeners,
  ): Promise<ModelReply> => {
    const params = paramsFor(model, request);
    const message =
      listeners.onText === undefined
        ? await client.messages.create(params)
        : await streamed(params, listeners);
    return replyOf(message);
  };

  return {
    complete,
    isTimeout: (error) => error instanceof Anthropic.APIConnectionTimeoutError,
  };
};
