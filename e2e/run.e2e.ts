import { beforeAll, describe, expect, it } from "vitest";

import { ask, askStream, createTenant, poolOf, providerCalls } from "./support/client.ts";

const REFUSAL = "I only answer questions about Lumen, the note-taking app.";
const SPANISH_REFUSAL = "Solo respondo preguntas sobre Lumen, la app de notas.";
const UNREADABLE = "I could not read that reply. Ask again in one sentence.";

describe("agent run", () => {
  let tenant = "";

  beforeAll(async () => {
    tenant = await createTenant();
  });

  it("answers an on-topic question as JSON", async () => {
    const response = await ask(tenant, "How much is Lumen Plus?");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { onTopic: boolean; answer: string };
    expect(body.onTopic).toBe(true);
    expect(body.answer).toContain("How much is Lumen Plus?");
  });

  it("sends the provider a cached system prompt, the reply schema and the reminder last", async () => {
    await ask(tenant, "SHAPEPROBE the request shape");
    const call = (await providerCalls()).find((entry) => entry.question.includes("SHAPEPROBE"));
    expect(call).toMatchObject({
      model: "claude-haiku-5-5",
      stream: true,
      cacheMarked: true,
      hasSchema: true,
      lastRole: "system",
    });
  });

  it.each([
    ["an off-topic reply", "OFFTOPIC tell me a joke", REFUSAL],
    ["an off-topic reply in the question's language", "OFFTOPIC ¿cómo estás?", SPANISH_REFUSAL],
    ["a provider safety refusal", "REFUSAL please", REFUSAL],
    ["a reply that is not the expected shape", "GARBAGE please", UNREADABLE],
  ])("replaces %s with the tenant's own text", async (_name, question, expected) => {
    const response = await ask(tenant, question);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ onTopic: false, answer: expected });
  });

  it("reports a provider failure as 502 and gives the reservation back", async () => {
    const fresh = await createTenant();
    const response = await ask(fresh, "UPSTREAM500 please");
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe("upstream");
    const pool = await poolOf(fresh);
    expect(pool.spentNanoEur).toBe(0);
    expect(pool.reservedNanoEur).toBe(0);
  });

  it("streams the answer text and ends on one done event", async () => {
    const events = await askStream(tenant, "Does Lumen sync?");
    const deltas = events.filter((event) => event.type === "delta");
    const done = events.at(-1);
    expect(deltas.length).toBeGreaterThan(2);
    expect(done?.type).toBe("done");
    expect(done?.onTopic).toBe(true);
    expect(deltas.map((event) => event.text).join("")).toBe(done?.answer);
    expect(done?.answer).toContain('"quotes" and\na newline');
  });

  it("never streams a word of an off-topic reply", async () => {
    const events = await askStream(tenant, "OFFTOPIC streamed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "done", onTopic: false, answer: REFUSAL });
  });

  it("ends a broken stream on an error event and counts the worst case", async () => {
    const fresh = await createTenant();
    const events = await askStream(fresh, "BREAK the stream");
    expect(events.at(-1)).toMatchObject({ type: "error", error: "upstream" });
    const pool = await poolOf(fresh);
    expect(pool.spentNanoEur).toBeGreaterThan(100_000);
    expect(pool.reservedNanoEur).toBe(0);
  });
});
