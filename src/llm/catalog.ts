export interface Prices {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  longPromptMultiplier: number;
}

export type ThinkingOff = { type: "disabled" } | { type: "between_tools" };

export interface ModelEntry {
  prices: Prices;
  thinkingOff: ThinkingOff;
}

export const LONG_PROMPT_TOKENS = 100_000;

export const MODELS = {
  "claude-haiku-5-5": {
    prices: { input: 100, output: 500, cacheWrite: 125, cacheRead: 10, longPromptMultiplier: 5 },
    thinkingOff: { type: "disabled" },
  },
  "claude-sonnet-5-5": {
    prices: {
      input: 2000,
      output: 10_000,
      cacheWrite: 2500,
      cacheRead: 100,
      longPromptMultiplier: 1,
    },
    thinkingOff: { type: "between_tools" },
  },
} as const satisfies Record<string, ModelEntry>;

export type ModelId = keyof typeof MODELS;
export type Tier = "fast" | "balanced";
export type Candidates = readonly [ModelId, ...ModelId[]];

const CANDIDATES: Record<Tier, Candidates> = {
  fast: ["claude-haiku-5-5"],
  balanced: ["claude-sonnet-5-5", "claude-haiku-5-5"],
};

export const candidatesFor = (tier: Tier): Candidates => CANDIDATES[tier];
