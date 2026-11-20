import type { ChatContext } from "../gateway/chat-body";
import type { MessageBlock, ModelMessage } from "../llm/provider";
import type { ChatAgent, Contract } from "../tenants/schema";
import type { Version } from "./version";
import { isBefore, parseVersion } from "./version";

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

type LanguageOption = NonNullable<ChatAgent["language"]>["options"][number];

export const languageOf = (
  agent: ChatAgent,
  question: string,
  context: ChatContext,
): LanguageOption | undefined => {
  const options = agent.language?.options ?? [];
  const scored = options.map((option) => ({ option, score: countMatches(option.words, question) }));
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  const leaders = scored.filter((entry) => entry.score === best);
  const [leader] = leaders;
  if (leader !== undefined && leaders.length === 1) {
    return leader.option;
  }
  const locale = localeChoice(agent, context);
  return options.find((option) => locale?.startsWith(option.id) === true) ?? options[0];
};

export const languageInstruction = (
  agent: ChatAgent,
  question: string,
  context: ChatContext,
): string => languageOf(agent, question, context)?.instruction ?? "";

export const systemTail = (
  agent: ChatAgent,
  messages: readonly ModelMessage[],
  context: ChatContext,
): string[] => {
  const language = languageInstruction(agent, latestQuestion(messages), context);
  const closing = [agent.reminder ?? "", language].filter((part) => part !== "").join(" ");
  return [contextBlock(agent, context), closing].filter((part) => part !== "");
};

const clientVersion = (agent: ChatAgent, context: ChatContext): Version | null => {
  const value = agent.versionField === undefined ? undefined : context[agent.versionField];
  return typeof value === "string" ? parseVersion(value) : null;
};

export interface PromptChoice {
  agent: ChatAgent;
  contract: Contract;
  context: ChatContext;
}

export const systemFor = ({ agent, contract, context }: PromptChoice): string => {
  const version = clientVersion(agent, context);
  const rule = agent.systems.find((candidate) => {
    const contractFits =
      candidate.contractVersion === undefined || candidate.contractVersion === contract.version;
    const minimum =
      candidate.versionAtLeast === undefined ? null : parseVersion(candidate.versionAtLeast);
    const versionFits = minimum === null || (version !== null && !isBefore(version, minimum));
    return contractFits && versionFits;
  });
  return rule?.system ?? agent.system;
};

export const refusalFor = (agent: ChatAgent, question: string, context: ChatContext): string => {
  const language = languageOf(agent, question, context);
  return (
    (language === undefined ? undefined : agent.refusal.byLanguage[language.id]) ??
    agent.refusal.fallback
  );
};
