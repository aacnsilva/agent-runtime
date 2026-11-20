import { z } from "zod";

const isRegex = (pattern: string): boolean => {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
};

const shortText = z.string().min(1).max(600);

const localeSchema = z.object({
  pattern: z.string().min(1).max(500).refine(isRegex, "pattern must be a regular expression"),
  refusal: shortText,
  unreadable: shortText,
});

const gateSchema = z.object({
  fallback: z.object({ refusal: shortText, unreadable: shortText }),
  locales: z.array(localeSchema).max(10),
});

const inputSchema = z.object({
  maxMessages: z.number().int().min(1).max(60),
  maxUserChars: z.number().int().min(1).max(8000),
  maxAssistantChars: z.number().int().min(1).max(8000),
  maxBodyBytes: z.number().int().min(256).max(240_000),
});

const agentSchema = z.object({
  tier: z.enum(["fast", "balanced"]),
  effort: z.enum(["low", "medium", "high"]),
  maxOutputTokens: z.number().int().min(256).max(4000),
  system: z.string().min(1).max(400_000),
  reminder: z.string().min(1).max(1000).optional(),
  input: inputSchema,
  gate: gateSchema,
});

const limitsSchema = z.object({
  ipPerHour: z.number().int().min(1).max(1000),
  ipPerDay: z.number().int().min(1).max(5000),
  poolEurPerMonth: z.number().min(0).max(5000),
  usdPerEur: z.number().min(0.01).max(100),
});

export const tenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(80),
  authn: z.object({
    kind: z.literal("anonymous"),
    allowedOrigins: z.array(z.url()).max(20),
  }),
  limits: limitsSchema,
  agent: agentSchema,
});

export type Tenant = z.infer<typeof tenantSchema>;
export type Gate = z.infer<typeof gateSchema>;
export type InputLimits = z.infer<typeof inputSchema>;
