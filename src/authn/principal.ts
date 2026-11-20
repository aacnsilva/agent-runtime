import type { Tier } from "../llm/catalog";

export interface Principal {
  subjectId: string;
  planId: string | null;
  messagesPerMonth: number | null;
  tier: Tier;
  authenticated: boolean;
  evaluated: boolean;
  effortOverride: "low" | "medium" | "high" | null;
}
