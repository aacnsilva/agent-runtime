import { describe, expect, it } from "vitest";

import { chunkText } from "../src/knowledge/chunk";
import { bm25, cosine, fuse, rankedIndexes, tokenize } from "../src/knowledge/rank";
import type { StoredChunk } from "../src/knowledge/search";
import { searchChunks } from "../src/knowledge/search";

const chunk = (overrides: Partial<StoredChunk>): StoredChunk => ({
  documentId: "doc",
  title: "Title",
  text: "",
  plans: null,
  model: null,
  vector: null,
  ...overrides,
});

const query = { plan: null, topK: 3, embeddingModel: null, queryVector: null };

describe("chunking", () => {
  it("keeps paragraphs whole and starts a new chunk when the next one would not fit", () => {
    const chunks = chunkText("First paragraph here.\n\nSecond paragraph here.\n\nThird one.", 45);
    expect(chunks).toEqual(["First paragraph here.\n\nSecond paragraph here.", "Third one."]);
  });

  it("starts a chunk at each heading and carries the heading into later chunks of its section", () => {
    const text = `# Tuning\n\n${"Tune each string in turn. ".repeat(4)}\n\n${"Check with a tuner. ".repeat(4)}\n\n# Chords\n\nPress close to the fret.`;
    const chunks = chunkText(text, 130);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.startsWith("# Tuning\n\nTune each")).toBe(true);
    expect(chunks[1]?.startsWith("# Tuning\nCheck with a tuner.")).toBe(true);
    expect(chunks[2]).toBe("# Chords\n\nPress close to the fret.");
  });

  it("splits a paragraph longer than a chunk at a sentence or word, never mid-word", () => {
    const chunks = chunkText(
      "One two three four five six. Seven eight nine ten eleven twelve.",
      30,
    );
    expect(chunks.every((piece) => piece.length <= 30)).toBe(true);
    expect(chunks.join(" ")).toBe(
      "One two three four five six. Seven eight nine ten eleven twelve.",
    );
  });

  it("returns nothing for blank text", () => {
    expect(chunkText(" \n\n \n", 100)).toEqual([]);
  });
});

describe("ranking", () => {
  it("tokenizes without case or accents", () => {
    expect(tokenize("Não há AÇÚCAR, e-mail 42!")).toEqual([
      "nao",
      "ha",
      "acucar",
      "e",
      "mail",
      "42",
    ]);
  });

  it("scores a rare matching term above a common one and ignores unrelated text", () => {
    const documents = [
      tokenize("the capo raises the pitch"),
      tokenize("the the the strings"),
      tokenize("drums and cymbals"),
    ];
    const scores = bm25(tokenize("the capo"), documents);
    expect(rankedIndexes(scores)).toEqual([0, 1]);
    expect(scores[2]).toBe(0);
  });

  it("measures direction, not length, and refuses vectors of different sizes", () => {
    expect(cosine([1, 0], [5, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 0], [1, 0, 0])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("fuses rankings so an item both lists like comes first", () => {
    expect(
      fuse([
        [0, 1, 2],
        [1, 3],
      ]),
    ).toEqual([1, 0, 3, 2]);
  });
});

describe("search", () => {
  const chunks = [
    chunk({ documentId: "open", text: "the capo raises the pitch" }),
    chunk({ documentId: "paid", text: "sweep picking arpeggios", plans: ["pro"] }),
    chunk({ documentId: "other", text: "drum rudiments" }),
  ];

  it("returns the passages that match, best first, up to the requested number", () => {
    const hits = searchChunks(chunks, { ...query, query: "capo pitch", topK: 1 });
    expect(hits.map((hit) => hit.documentId)).toEqual(["open"]);
  });

  it("hides a passage restricted to a plan from every other plan and from no plan", () => {
    const asking = { ...query, query: "sweep picking" };
    expect(searchChunks(chunks, asking)).toEqual([]);
    expect(searchChunks(chunks, { ...asking, plan: "basic" })).toEqual([]);
    expect(searchChunks(chunks, { ...asking, plan: "pro" })[0]?.documentId).toBe("paid");
  });

  it("uses a vector only when it came from the same embedding model as the query", () => {
    const stored = [
      chunk({ documentId: "same", text: "zzz", model: "m1", vector: new Float32Array([1, 0]) }),
      chunk({ documentId: "stale", text: "yyy", model: "m0", vector: new Float32Array([1, 0]) }),
    ];
    const hits = searchChunks(stored, {
      ...query,
      query: "nothing",
      embeddingModel: "m1",
      queryVector: [1, 0],
    });
    expect(hits.map((hit) => hit.documentId)).toEqual(["same"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchChunks(chunks, { ...query, query: "saxophone" })).toEqual([]);
  });
});
