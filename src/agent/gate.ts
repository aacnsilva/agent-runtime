import type { Gate } from "../tenants/schema";

export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    on_topic: { type: "boolean" },
    answer: { type: "string" },
  },
  required: ["on_topic", "answer"],
  additionalProperties: false,
} as const;

const MAX_ANSWER_CHARS = 4000;

export interface GatedReply {
  onTopic: boolean;
  answer: string;
}

export interface GateTexts {
  refusal: string;
  unreadable: string;
}

const hasReplyShape = (value: unknown): value is { on_topic: boolean; answer: string } =>
  typeof value === "object" &&
  value !== null &&
  "on_topic" in value &&
  "answer" in value &&
  typeof value.on_topic === "boolean" &&
  typeof value.answer === "string";

const parseJsonObject = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

export const parseReply = (text: string): GatedReply | null => {
  const value = parseJsonObject(text);
  if (!hasReplyShape(value)) {
    return null;
  }
  const answer = value.answer.trim();
  return answer === ""
    ? null
    : { onTopic: value.on_topic, answer: answer.slice(0, MAX_ANSWER_CHARS) };
};

export const textsFor = (gate: Gate, question: string): GateTexts =>
  gate.locales.find((locale) => new RegExp(locale.pattern, "i").test(question)) ?? gate.fallback;
