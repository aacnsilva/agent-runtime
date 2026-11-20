import type { ModelId } from "./catalog";
import { LONG_PROMPT_TOKENS, MODELS } from "./catalog";

export interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface Pricing {
  model: ModelId;
  usdPerEur: number;
}

export const NO_USAGE: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

export const euroToNano = (euros: number): number => Math.round(euros * 1_000_000_000);

export const nanoToEuro = (nano: number): number => nano / 1_000_000_000;

export const costNanoEur = (usage: Usage, pricing: Pricing): number => {
  const prices = MODELS[pricing.model];
  const promptTokens = usage.input + usage.cacheWrite + usage.cacheRead;
  const multiplier = promptTokens > LONG_PROMPT_TOKENS ? prices.longPromptMultiplier : 1;
  const nanoUsd =
    multiplier *
    (usage.input * prices.input +
      usage.output * prices.output +
      usage.cacheWrite * prices.cacheWrite +
      usage.cacheRead * prices.cacheRead);
  return Math.round(nanoUsd / pricing.usdPerEur);
};

export interface ReserveInput {
  promptChars: number;
  maxOutputTokens: number;
}

const CHARS_PER_TOKEN = 3;
const REQUEST_OVERHEAD_TOKENS = 600;

export const worstCaseUsage = (input: ReserveInput): Usage => ({
  input: Math.ceil(input.promptChars / CHARS_PER_TOKEN) + REQUEST_OVERHEAD_TOKENS,
  output: input.maxOutputTokens,
  cacheWrite: 0,
  cacheRead: 0,
});

export const reserveNanoEur = (
  input: ReserveInput,
  models: readonly ModelId[],
  usdPerEur: number,
): number =>
  Math.max(...models.map((model) => costNanoEur(worstCaseUsage(input), { model, usdPerEur })));
