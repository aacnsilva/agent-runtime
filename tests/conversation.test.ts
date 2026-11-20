import { describe, expect, it } from "vitest";

import { parseConversation } from "../src/gateway/conversation";
import { Rejection } from "../src/http/respond";

const LIMITS = { maxMessages: 4, maxUserChars: 20, maxAssistantChars: 10, maxBodyBytes: 2000 };

const parse = (messages: unknown): ReturnType<typeof parseConversation> =>
  parseConversation(JSON.stringify({ messages }), LIMITS);

const codeOf = (work: () => unknown): string => {
  try {
    work();
  } catch (error) {
    return error instanceof Rejection ? error.code : "threw something else";
  }
  return "accepted";
};

describe("conversation", () => {
  it("strips control characters, trims, and cuts earlier answers to their cap", () => {
    expect(
      parse([
        { role: "user", content: " first\u0000 question " },
        { role: "assistant", content: "a long earlier answer" },
        { role: "user", content: "second\nline" },
      ]),
    ).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "a long ear" },
      { role: "user", content: "second\nline" },
    ]);
  });

  it("starts at the first question when the history opens on an answer", () => {
    const messages = parse([
      { role: "assistant", content: "orphan" },
      { role: "user", content: "question" },
    ]);
    expect(messages).toEqual([{ role: "user", content: "question" }]);
  });

  it("drops turns that are empty after cleaning", () => {
    const messages = parse([
      { role: "user", content: "\u0001 " },
      { role: "user", content: "real" },
    ]);
    expect(messages).toEqual([{ role: "user", content: "real" }]);
  });

  it.each([
    [
      "missing_question",
      [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
    ],
    ["question_too_long", [{ role: "user", content: "x".repeat(21) }]],
    ["bad_length", new Array(5).fill({ role: "user", content: "q" })],
    ["bad_role", [{ role: "tool", content: "q" }]],
    ["bad_content", [{ role: "user", content: ["q"] }]],
    ["missing_messages", "not a list"],
  ])("refuses with %s", (code, messages) => {
    expect(codeOf(() => parse(messages))).toBe(code);
  });

  it("refuses a body over the byte cap before parsing it", () => {
    expect(codeOf(() => parseConversation("x".repeat(2001), LIMITS))).toBe("too_large");
  });
});
