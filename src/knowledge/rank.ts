const K1 = 1.2;
const B = 0.75;
const RRF_K = 60;
const DIACRITICS = /\p{Diacritic}/gu;
const WORD = /[\p{L}\p{N}]+/gu;

export const tokenize = (text: string): string[] =>
  text.normalize("NFD").replace(DIACRITICS, "").toLowerCase().match(WORD) ?? [];

const termCounts = (tokens: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
};

const documentFrequency = (documents: readonly Map<string, number>[]): Map<string, number> => {
  const frequency = new Map<string, number>();
  for (const counts of documents) {
    for (const term of counts.keys()) {
      frequency.set(term, (frequency.get(term) ?? 0) + 1);
    }
  }
  return frequency;
};

export const bm25 = (
  query: readonly string[],
  documents: readonly (readonly string[])[],
): number[] => {
  const counted = documents.map(termCounts);
  const frequency = documentFrequency(counted);
  const averageLength =
    documents.reduce((total, tokens) => total + tokens.length, 0) / Math.max(1, documents.length);
  const terms = [...new Set(query)];
  return counted.map((counts, index) => {
    const length = documents[index]?.length ?? 0;
    return terms.reduce((score, term) => {
      const occurrences = counts.get(term) ?? 0;
      const containing = frequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5));
      const saturation =
        (occurrences * (K1 + 1)) / (occurrences + K1 * (1 - B + (B * length) / averageLength));
      return score + (occurrences === 0 ? 0 : idf * saturation);
    }, 0);
  });
};

export const cosine = (left: ArrayLike<number>, right: ArrayLike<number>): number => {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const norm = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return norm === 0 ? 0 : dot / norm;
};

export const rankedIndexes = (scores: readonly number[]): number[] =>
  scores
    .map((score, index) => ({ score, index }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.index);

export const fuse = (rankings: readonly (readonly number[])[]): number[] => {
  const fused = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((index, position) => {
      fused.set(index, (fused.get(index) ?? 0) + 1 / (RRF_K + position + 1));
    });
  }
  return [...fused.entries()].sort((left, right) => right[1] - left[1]).map(([index]) => index);
};
