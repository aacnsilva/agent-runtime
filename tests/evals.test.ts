import { describe, expect, it } from "vitest";

import type { Observation } from "../evals/grade";
import {
  byGroup,
  compareToBaseline,
  grade,
  hasAmount,
  includesShape,
  languageOf,
  moneyIn,
} from "../evals/grade";

const LANGUAGES = {
  en: "\\b(the|is|and|you|this|what)\\b",
  pt: "\\b(que|não|uma|este|para|com)\\b",
};

const seen = (overrides: Partial<Observation> = {}): Observation => ({
  answer: "This month you spent €89.75 on extras.",
  written: ["This month you spent €89.75 on extras."],
  tools: ["summarize"],
  calls: [{ name: "summarize", input: { group: ["month"], where: { category: ["Food"] } } }],
  toolResults: ['{"total":"89.75","count":3}'],
  questions: ["How much did we spend?"],
  onTopic: null,
  stopReason: "end_turn",
  modelCalls: 2,
  seconds: 1.5,
  ...overrides,
});

describe("eval grading", () => {
  it("passes a case whose every check holds", () => {
    const expectation = {
      anyTool: ["summarize", "find"],
      noTools: ["propose"],
      amounts: ["89.75"],
      contains: ["extras"],
      excludes: ["sorry"],
      language: "en",
      stopReason: "end_turn",
      maxModelCalls: 3,
    };
    expect(grade(expectation, seen(), LANGUAGES)).toEqual([]);
  });

  it("says exactly what failed", () => {
    const failures = grade(
      {
        tools: ["find"],
        noAnyTool: true,
        contains: ["Açores"],
        amounts: ["12"],
        onTopic: true,
        maxSeconds: 1,
      },
      seen(),
    );
    expect(failures).toEqual([
      "did not call find",
      "called summarize but should call no tool",
      'answer lacks "Açores"',
      "answer lacks the amount 12",
      "onTopic was null, expected true",
      "took 1.5 s, more than 1 s",
    ]);
  });

  it("compares text without case or accents", () => {
    expect(grade({ contains: ["acores"] }, seen({ answer: "A viagem aos AÇORES" }))).toEqual([]);
    expect(grade({ containsAny: ["nope", "viagem"] }, seen({ answer: "A viagem" }))).toEqual([]);
  });

  it.each([
    ["89,75 €", "89.75", true],
    ["€89.75", "89.75", true],
    ["1 250,00", "1250", true],
    ["1.250", "1250", true],
    ["3000", "3000", true],
    ["3000.00", "3000", true],
    ["189.75", "89.75", false],
    ["89.756", "89.75", false],
    ["30000", "3000", false],
    ["89.70", "89.75", false],
  ])("reads %j as the amount %s: %s", (text, amount, expected) => {
    expect(hasAmount(text, amount)).toBe(expected);
  });

  it("checks the language of every long line the model wrote, including before a tool call", () => {
    const written = [
      "Let me check what you spent this month and the last.",
      "Este mês não gastou nada com uma coisa.",
    ];
    const failures = grade({ language: "pt" }, seen({ written }), LANGUAGES);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Let me check");
    expect(languageOf("89,75 €", LANGUAGES)).toBeNull();
  });

  it("checks what a tool was called with, as a partial match at any depth", () => {
    const ok = grade(
      {
        calls: [{ tool: "summarize", times: 1, input: { where: { category: ["food"] } } }],
        noCalls: [{ tool: "propose" }],
      },
      seen(),
    );
    expect(ok).toEqual([]);
    const failures = grade(
      {
        calls: [
          { tool: "summarize", input: { group: ["week"] } },
          { tool: "summarize", times: 2 },
        ],
        noCalls: [{ tool: "summarize", input: { group: ["month"] } }],
      },
      seen(),
    );
    expect(failures).toEqual([
      'did not call summarize with {"group":["week"]}',
      "did not call summarize 2 time(s), saw 1",
      'called summarize with {"group":["month"]}',
    ]);
    expect(
      includesShape(
        { changes: [{ op: "add", amount: "12,50" }, { op: "delete" }] },
        { changes: [{ op: "delete" }] },
      ),
    ).toBe(true);
    expect(includesShape({ changes: [{ op: "add" }] }, { changes: [{ op: "delete" }] })).toBe(
      false,
    );
  });

  it("finds an invented amount: every amount of money in the answer must come from a tool or the question", () => {
    expect(grade({ grounded: true }, seen())).toEqual([]);
    expect(grade({ grounded: true }, seen({ answer: "About €90 on extras." }))).toEqual([]);
    expect(
      grade({ grounded: true }, seen({ answer: "You spent €89.75, so save 250 EUR a month." })),
    ).toEqual(["the amount 250 is in no tool result or question"]);
    expect(grade({ grounded: true }, seen({ answer: "It was 3 purchases in 2026." }))).toEqual([]);
    expect(moneyIn("1 250,00 € and $3,000.50 and 12 €")).toEqual(["1250", "3000.50", "12"]);
  });

  it("reports what changed against a baseline", () => {
    const baseline = [
      { id: "a", group: "reads", passed: true },
      { id: "b", group: "reads", passed: false },
    ];
    const results = [
      { id: "a", group: "reads", passed: false },
      { id: "b", group: "reads", passed: true },
      { id: "c", group: "writes", passed: true },
    ];
    expect(compareToBaseline(results, baseline)).toEqual({
      nowFailing: ["a"],
      nowPassing: ["b"],
      added: ["c"],
    });
    expect(byGroup(results)).toEqual({
      reads: { cases: 2, passed: 1 },
      writes: { cases: 1, passed: 1 },
    });
  });
});
