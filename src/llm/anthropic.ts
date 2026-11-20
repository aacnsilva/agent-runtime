import Anthropic from "@anthropic-ai/sdk";

import type { ModelId } from "./catalog";
import type { Usage } from "./cost";
import type { Completion, CompletionRequest, Provider, TextListener } from "./provider";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 1;

export interface AnthropicSettings {
  apiKey: string;
  baseURL: string | undefined;
}

const paramsFor = (
  model: ModelId,
  request: CompletionRequest,
): Anthropic.MessageCreateParamsNonStreaming => ({
  model,
  max_tokens: request.maxOutputTokens,
  system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
  messages: [
    ...request.messages,
    ...(request.reminder === undefined
      ? []
      : [{ role: "system" as const, content: request.reminder }]),
  ],
  output_config: {
    effort: request.effort,
    format: { type: "json_schema", schema: request.replySchema },
  },
});

const usageOf = (usage: Anthropic.Usage): Usage => ({
  input: usage.input_tokens,
  output: usage.output_tokens,
  cacheWrite: usage.cache_creation_input_tokens ?? 0,
  cacheRead: usage.cache_read_input_tokens ?? 0,
});

const completionOf = (message: Anthropic.Message): Completion => ({
  text: message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(""),
  stopReason: message.stop_reason,
  usage: usageOf(message.usage),
});

export const createAnthropicProvider = (settings: AnthropicSettings): Provider => {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    ...(settings.baseURL === undefined ? {} : { baseURL: settings.baseURL }),
  });

  const complete = async (
    model: ModelId,
    request: CompletionRequest,
    onText: TextListener | undefined,
  ): Promise<Completion> => {
    const params = paramsFor(model, request);
    const message =
      onText === undefined
        ? await client.messages.create(params)
        : await client.messages.stream(params).on("text", onText).finalMessage();
    return completionOf(message);
  };

  return {
    complete,
    isTimeout: (error) => error instanceof Anthropic.APIConnectionTimeoutError,
  };
};
