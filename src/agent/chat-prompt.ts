import type { ChatContext } from "../gateway/chat-body";
import type { MessageBlock, ModelMessage } from "../llm/provider";
import type { ChatAgent, Contract } from "../tenants/schema";

const textOf = (content: string | MessageBlock[]): string | null => {
  if (typeof content === "string") {
    return content;
  }
  const text = content.find((block) => block.type === "text");
  return text?.type === "text" ? text.text : null;
};

export const latestQuestion = (messages: readonly ModelMessage[]): string => {
  let question = "";
  for (const message of messages) {
    const text = message.role === "user" ? textOf(message.content) : null;
    question = text ?? question;
  }
  return question;
};

const valueText = (value: string | string[]): string =>
  typeof value === "string" ? value : value.length > 0 ? value.join(", ") : "none";

export const contextBlock = (agent: ChatAgent, context: ChatContext): string =>
  agent.context
    .flatMap((field) => {
      const value = context[field.name];
      return value === undefined ? [] : [`${field.label}: ${valueText(value)}`];
    })
    .join("\n");

const countMatches = (words: string, question: string): number =>
  (question.match(new RegExp(words, "gi")) ?? []).length;

const localeChoice = (agent: ChatAgent, context: ChatContext): string | undefined => {
  const field = agent.language?.localeField;
  const locale = field === undefined ? undefined : context[field];
  return typeof locale === "string" ? locale.toLowerCase() : undefined;
};

export const languageInstruction = (
  agent: ChatAgent,
  question: string,
  context: ChatContext,
): string => {
  const options = agent.language?.options ?? [];
  const scored = options.map((option) => ({ option, score: countMatches(option.words, question) }));
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  const leaders = scored.filter((entry) => entry.score === best);
  const [leader] = leaders;
  if (leader !== undefined && leaders.length === 1) {
    return leader.option.instruction;
  }
  const locale = localeChoice(agent, context);
  const byLocale = options.find((option) => locale?.startsWith(option.id) === true);
  return (byLocale ?? options[0])?.instruction ?? "";
};

export const systemTail = (
  agent: ChatAgent,
  messages: readonly ModelMessage[],
  context: ChatContext,
): string[] => {
  const language = languageInstruction(agent, latestQuestion(messages), context);
  const closing = [agent.reminder ?? "", language].filter((part) => part !== "").join(" ");
  return [contextBlock(agent, context), closing].filter((part) => part !== "");
};

export const systemFor = (agent: ChatAgent, contract: Contract): string =>
  contract.system ?? agent.system;

export const refusalFor = (agent: ChatAgent, question: string): string =>
  agent.refusal.locales.find((locale) => new RegExp(locale.pattern, "i").test(question))?.text ??
  agent.refusal.fallback;
