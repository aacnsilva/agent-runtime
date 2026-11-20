import { conversationChars } from "../gateway/chat-body";
import type { Usage } from "../llm/cost";
import { CHARS_PER_TOKEN } from "../llm/cost";
import type { MessageBlock, ModelMessage, ToolResultBlock } from "../llm/provider";
import type { ChatInputLimits } from "../tenants/schema";

export interface Pending {
  orderedIds: string[];
  clientIds: string[];
  serverResults: ToolResultBlock[];
  toolRounds: number;
  messages: ModelMessage[];
}

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface HistoryLimits {
  maxChars: number;
  maxMessages: number;
  imageChars: number;
  maxTokens: number | null;
  tokensPerChar: number;
}

const MIN_TOKENS_PER_CHAR = 0.05;
const MAX_TOKENS_PER_CHAR = 2;

export const DEFAULT_TOKENS_PER_CHAR = 1 / CHARS_PER_TOKEN;

export const measuredTokensPerChar = (usage: Usage, promptChars: number): number | null => {
  const promptTokens = usage.input + usage.cacheWrite + usage.cacheRead;
  if (promptTokens <= 0 || promptChars <= 0) {
    return null;
  }
  return Math.min(MAX_TOKENS_PER_CHAR, Math.max(MIN_TOKENS_PER_CHAR, promptTokens / promptChars));
};

export const historyLimits = (input: ChatInputLimits, measured: number | null): HistoryLimits => ({
  maxChars: input.maxConversationChars,
  maxMessages: input.maxMessages,
  imageChars: input.imageChars,
  maxTokens: input.maxConversationTokens ?? null,
  tokensPerChar: measured ?? DEFAULT_TOKENS_PER_CHAR,
});

const isQuestion = (message: ModelMessage): boolean =>
  message.role === "user" &&
  (typeof message.content === "string" ||
    message.content.every((block) => block.type !== "tool_result"));

const fits = (messages: readonly ModelMessage[], limits: HistoryLimits): boolean => {
  const chars = conversationChars(messages, limits.imageChars);
  const withinTokens =
    limits.maxTokens === null || Math.ceil(chars * limits.tokensPerChar) <= limits.maxTokens;
  return messages.length <= limits.maxMessages && chars <= limits.maxChars && withinTokens;
};

const fromFirstQuestion = (messages: readonly ModelMessage[]): ModelMessage[] => {
  const first = messages.findIndex(isQuestion);
  return first <= 0 ? [...messages] : messages.slice(first);
};

export const trimHistory = (
  messages: readonly ModelMessage[],
  limits: HistoryLimits,
): ModelMessage[] => {
  let kept = fromFirstQuestion(messages);
  while (!fits(kept, limits)) {
    const next = kept.findIndex((message, index) => index > 0 && isQuestion(message));
    if (next === -1) {
      break;
    }
    kept = kept.slice(next);
  }
  return kept;
};

const withoutImage = (block: MessageBlock): MessageBlock[] =>
  block.type === "image" ? [] : [block];

export const withoutImages = (messages: readonly ModelMessage[]): ModelMessage[] =>
  messages.map((message) =>
    typeof message.content === "string"
      ? message
      : { role: message.role, content: message.content.flatMap(withoutImage) },
  );

const textOf = (message: ModelMessage): string =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((block) => (block.type === "text" ? block.text : "")).join("");

export const transcript = (messages: readonly ModelMessage[]): TranscriptEntry[] =>
  messages
    .map((message) => ({ role: message.role, text: textOf(message).trim() }))
    .filter((entry) => entry.text !== "");

export const orderedResults = (
  pending: Pending,
  clientResults: readonly ToolResultBlock[],
): ToolResultBlock[] => {
  const all = [...pending.serverResults, ...clientResults];
  return pending.orderedIds.flatMap((id) => all.filter((result) => result.tool_use_id === id));
};
