import { describe, expect, it } from "vitest";

import { parseReply, textsFor } from "../src/agent/gate";
import { GateStream } from "../src/agent/gate-stream";

const streamed = (chunks: string[]): string => {
  const stream = new GateStream();
  return chunks.map((chunk) => stream.push(chunk)).join("");
};

const inChunksOf = (text: string, size: number): string[] =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
    text.slice(index * size, (index + 1) * size),
  );

describe("gate stream", () => {
  const reply = JSON.stringify({ on_topic: true, answer: 'Say "hi"\n\tPreço: 5 € 😀 \\ done' });
  const answer = 'Say "hi"\n\tPreço: 5 € 😀 \\ done';

  it.each([1, 2, 3, 5, 7, 500])("yields the same answer in chunks of %i", (size) => {
    expect(streamed(inChunksOf(reply, size))).toBe(answer);
  });

  it("decodes escaped surrogate pairs split across chunks", () => {
    const escaped = '{"on_topic": true, "answer": "ok \\ud83d\\ude00!"}';
    expect(streamed(inChunksOf(escaped, 4))).toBe("ok 😀!");
  });

  it("yields nothing when the reply is off topic", () => {
    expect(streamed(['{"on_topic": false, "answer": "secret', ' text"}'])).toBe("");
  });

  it("yields nothing when the reply is not the expected shape", () => {
    expect(streamed(["Sure! Here is a long preamble. ".repeat(10)])).toBe("");
    expect(streamed(['{"answer": "x", "on_topic": true}'])).toBe("");
  });

  it("stops at the end of the answer and does not open on blank space", () => {
    expect(streamed(['{"on_topic":true,"answer":"  \\n hello"', ', "extra": "no"}'])).toBe("hello");
  });
});

describe("gate", () => {
  it("reads the reply out of surrounding text", () => {
    expect(parseReply('noise {"on_topic": true, "answer": " yes "} noise')).toEqual({
      onTopic: true,
      answer: "yes",
    });
  });

  it.each([
    "",
    "plain words",
    '{"on_topic": "yes", "answer": "x"}',
    '{"on_topic": true, "answer": " "}',
  ])("rejects %j", (text) => {
    expect(parseReply(text)).toBeNull();
  });

  it("picks the texts of the first locale whose pattern matches the question", () => {
    const gate = {
      fallback: { refusal: "en", unreadable: "en?" },
      locales: [{ pattern: "\\bnão\\b|ç", refusal: "pt", unreadable: "pt?" }],
    };
    expect(textsFor(gate, "Não sei").refusal).toBe("pt");
    expect(textsFor(gate, "I do not know").refusal).toBe("en");
  });
});
