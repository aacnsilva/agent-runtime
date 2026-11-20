import { conversationChars } from "../gateway/chat-body";
import type { MessageBlock, ModelMessage, ToolResultBlock } from "../llm/provider";

export interface Pending {
  orderedIds: string[];
  clientIds: string[];
  serverResults: ToolResultBlock[];
  toolRounds: number;
}

export interface SessionState {
  owner: string;
  version: number;
  messages: ModelMessage[];
  pending: Pending | null;
  updatedAt: number;
}

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface HistoryLimits {
  maxChars: number;
  maxMessages: number;
  imageChars: number;
}

export const newSession = (owner: string, now: number): SessionState => ({
  owner,
  version: 0,
  messages: [],
  pending: null,
  updatedAt: now,
});

const isQuestion = (message: ModelMessage): boolean =>
  message.role === "user" &&
  (typeof message.content === "string" ||
    message.content.every((block) => block.type !== "tool_result"));

const fits = (messages: readonly ModelMessage[], limits: HistoryLimits): boolean =>
  messages.length <= limits.maxMessages &&
  conversationChars(messages, limits.imageChars) <= limits.maxChars;

export const trimHistory = (
  messages: readonly ModelMessage[],
  limits: HistoryLimits,
): ModelMessage[] => {
  let kept = [...messages];
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
