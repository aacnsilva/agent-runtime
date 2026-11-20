import { readFile } from "node:fs/promises";

import { z } from "zod";

const texts = z.array(z.string().min(1)).max(40);

const expectSchema = z.strictObject({
  tools: texts.optional(),
  anyTool: texts.optional(),
  noTools: texts.optional(),
  noAnyTool: z.boolean().optional(),
  contains: texts.optional(),
  containsAny: texts.optional(),
  excludes: texts.optional(),
  amounts: texts.optional(),
  excludesAmounts: texts.optional(),
  language: z.string().optional(),
  onTopic: z.boolean().optional(),
  stopReason: z.string().optional(),
  maxModelCalls: z.number().int().positive().optional(),
  maxSeconds: z.number().positive().optional(),
});

const caseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/),
  group: z.string().min(1).max(40),
  questions: z.array(z.string().min(1)).min(1).max(10),
  context: z.record(z.string(), z.unknown()).optional(),
  toolResults: z.record(z.string(), z.string()).optional(),
  expect: expectSchema,
});

const suiteSchema = z
  .strictObject({
    version: z.literal(1),
    agent: z.enum(["gated", "stateless", "stored"]),
    contractVersion: z.number().int().positive().default(1),
    context: z.record(z.string(), z.unknown()).default({}),
    languages: z.record(z.string(), z.string()).default({}),
    toolResults: z.record(z.string(), z.string()).default({}),
    cases: z.array(caseSchema).min(1),
  })
  .refine((suite) => new Set(suite.cases.map((entry) => entry.id)).size === suite.cases.length, {
    message: "case ids must be unique",
  });

export type Suite = z.infer<typeof suiteSchema>;
export type EvalCase = Suite["cases"][number];

export const loadSuite = async (path: string): Promise<Suite> => {
  const parsed = suiteSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`${path} is not a valid eval suite:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
};

export const selectCases = (suite: Suite, only: string | undefined): EvalCase[] =>
  only === undefined
    ? suite.cases
    : suite.cases.filter((entry) => entry.id === only || entry.group === only);
