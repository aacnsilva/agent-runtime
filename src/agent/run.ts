import { conversationChars, latestQuestion } from "../gateway/conversation";
import type { ModelId } from "../llm/catalog";
import type { Usage } from "../llm/cost";
import type { ChatMessage, ModelReply } from "../llm/provider";
import type { GatedAgent } from "../tenants/schema";
import { parseReply, REPLY_SCHEMA, textsFor } from "./gate";
import type { Reservation, Spend } from "./spend";
import { callModel, failureReport, reservePool } from "./spend";

export interface RunInput {
  spend: Spend;
  agent: GatedAgent;
  messages: readonly ChatMessage[];
}

export interface RunResult {
  status: number;
  outcome: string;
  body: Record<string, unknown>;
  model: ModelId | null;
  attempts: number;
  usage: Usage;
  costNanoEur: number;
}

export const reserve = async (input: RunInput): Promise<Reservation> => {
  const { agent } = input;
  const promptChars =
    conversationChars(input.messages) + agent.system.length + (agent.reminder?.length ?? 0);
  return reservePool(input.spend, promptChars, agent.maxOutputTokens);
};

const verdict = (input: RunInput, reply: ModelReply): Pick<RunResult, "outcome" | "body"> => {
  const texts = textsFor(input.agent.gate, latestQuestion(input.messages));
  if (reply.stopReason === "refusal") {
    return { outcome: "refusal", body: { onTopic: false, answer: texts.refusal } };
  }
  const parsed = parseReply(reply.text);
  if (parsed === null) {
    return { outcome: "unreadable", body: { onTopic: false, answer: texts.unreadable } };
  }
  return parsed.onTopic
    ? { outcome: "answered", body: { onTopic: true, answer: parsed.answer } }
    : { outcome: "off_topic", body: { onTopic: false, answer: texts.refusal } };
};

export const answer = async (
  input: RunInput,
  reservation: Reservation,
  onText: ((text: string) => void) | undefined,
): Promise<RunResult> => {
  const { agent } = input;
  const outcome = await callModel({
    spend: input.spend,
    reservation,
    listeners: onText === undefined ? {} : { onText },
    request: {
      maxOutputTokens: agent.maxOutputTokens,
      effort: input.spend.effortOverride ?? agent.effort,
      system: agent.system,
      systemTail: [],
      messages: input.messages,
      trailingReminder: agent.reminder,
      replySchema: REPLY_SCHEMA,
      tools: [],
      thinking: "default",
    },
  });
  const measured = {
    model: outcome.model,
    attempts: outcome.attempts,
    usage: outcome.usage,
    costNanoEur: outcome.costNanoEur,
  };
  if (!outcome.ok) {
    return { ...failureReport(outcome), ...measured };
  }
  return { status: 200, ...verdict(input, outcome.reply), ...measured };
};
