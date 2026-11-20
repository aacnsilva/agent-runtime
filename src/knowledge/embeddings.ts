import type { Env } from "../env";

const BATCH = 64;
const TIMEOUT_MS = 15_000;

export interface Embedder {
  model: string;
  embed: (texts: readonly string[]) => Promise<number[][]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isVector = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "number");

const vectorsOf = (body: unknown, expected: number): number[][] => {
  const data = isRecord(body) ? body["data"] : undefined;
  const vectors = Array.isArray(data)
    ? data.map((entry: unknown) => (isRecord(entry) ? entry["embedding"] : undefined))
    : [];
  if (vectors.length !== expected || !vectors.every(isVector)) {
    throw new Error("The embeddings service returned an unexpected reply.");
  }
  return vectors;
};

const embedBatch = async (
  env: Env,
  model: string,
  input: readonly string[],
): Promise<number[][]> => {
  const response = await fetch(`${env.EMBEDDINGS_BASE_URL ?? ""}/embeddings`, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.EMBEDDINGS_API_KEY ?? ""}`,
    },
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) {
    throw new Error(`The embeddings service answered ${String(response.status)}.`);
  }
  return vectorsOf(await response.json(), input.length);
};

export const embedderFor = (env: Env, model: string | undefined): Embedder | null => {
  const configured = env.EMBEDDINGS_BASE_URL !== undefined && env.EMBEDDINGS_BASE_URL !== "";
  if (model === undefined || !configured) {
    return null;
  }
  return {
    model,
    embed: async (texts) => {
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += BATCH) {
        vectors.push(...(await embedBatch(env, model, texts.slice(start, start + BATCH))));
      }
      return vectors;
    },
  };
};
