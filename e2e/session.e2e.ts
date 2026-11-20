import { beforeAll, describe, expect, it } from "vitest";

import type { CreatedTenant } from "./support/chat.ts";
import {
  createChatTenant,
  post,
  serverTools,
  stream,
  textOf,
  tokenFor,
  turn,
} from "./support/chat.ts";
import { ALLOWED_ORIGIN, providerCalls, runtimeUrl } from "./support/client.ts";

interface SessionCall {
  sessionId: string;
  token: string;
  method?: string;
}

const sessionRequest = async (tenant: CreatedTenant, call: SessionCall): Promise<Response> =>
  fetch(`${runtimeUrl()}/v1/tenants/${tenant.id}/sessions/${call.sessionId}`, {
    method: call.method ?? "GET",
    headers: { authorization: `Bearer ${call.token}`, origin: ALLOWED_ORIGIN },
  });

describe("stored sessions with tools the runtime runs", () => {
  let tenant: CreatedTenant;

  beforeAll(async () => {
    tenant = await createChatTenant({
      state: "stored",
      tools: serverTools(),
      agent: { maxRounds: 3 },
    });
  });

  it("keeps the conversation: the second turn reaches the model with the first", async () => {
    const token = await tokenFor(tenant, "s-memory", "pro");
    const first = await post(tenant.id, token, turn("MEMORY first question"));
    expect(first.status).toBe(200);
    const sessionId = first.body.sessionId ?? "";
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const second = await post(tenant.id, token, turn("MEMORY second question", sessionId));
    expect(second.body.sessionId).toBe(sessionId);
    const calls = (await providerCalls()).filter((call) => call.question.startsWith("MEMORY"));
    expect(calls.map((call) => call.messageCount)).toEqual([1, 3]);
  });

  it("runs a fetch tool itself and answers in one request, for one message", async () => {
    const token = await tokenFor(tenant, "s-fetch", "pro");
    const reply = await post(tenant.id, token, turn("TOOLCALL get_lesson slug=intro"));
    expect(reply.body.stopReason).toBe("end_turn");
    expect(textOf(reply)).toContain("MARKER-LESSON-INTRO");
    expect(reply.body.quota).toEqual({ used: 1, limit: 50 });
  });

  it("will not fetch outside the tool's own address", async () => {
    const token = await tokenFor(tenant, "s-escape", "pro");
    const reply = await post(tenant.id, token, turn("TOOLCALL get_lesson slug=../../admin"));
    expect(textOf(reply)).toContain("do not name something this tool can fetch");
    const missing = await post(tenant.id, token, turn("TOOLCALL get_lesson slug=nothing-here"));
    expect(textOf(missing)).toContain("The source answered 404");
  });

  it("shows a session only to the subject who owns it, and deletes it on request", async () => {
    const owner = await tokenFor(tenant, "s-owner", "pro");
    const stranger = await tokenFor(tenant, "s-stranger", "pro");
    const sessionId =
      (await post(tenant.id, owner, turn("My private question"))).body.sessionId ?? "";
    expect((await sessionRequest(tenant, { sessionId, token: stranger })).status).toBe(404);
    expect((await post(tenant.id, stranger, turn("let me in", sessionId))).status).toBe(404);
    const transcript = (await (
      await sessionRequest(tenant, { sessionId, token: owner })
    ).json()) as {
      messages: { role: string; text: string }[];
    };
    expect(transcript.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(transcript.messages[0]?.text).toBe("My private question");
    expect(
      (await sessionRequest(tenant, { sessionId, token: owner, method: "DELETE" })).status,
    ).toBe(200);
    expect((await sessionRequest(tenant, { sessionId, token: owner })).status).toBe(404);
  });

  it("waits for the client when a tool runs there, and refuses a new question meanwhile", async () => {
    const token = await tokenFor(tenant, "s-client", "pro");
    const asked = await post(tenant.id, token, turn("TOOLCALL show_card title=Hello"));
    const sessionId = asked.body.sessionId ?? "";
    const call = asked.body.content?.[0];
    expect(asked.body.stopReason).toBe("tool_use");
    expect(call?.name).toBe("show_card");
    const impatient = await post(tenant.id, token, turn("another question", sessionId));
    expect(impatient.status).toBe(409);
    expect(impatient.body.error).toBe("awaiting_tool_results");
    const finished = await post(tenant.id, token, {
      contractVersion: 1,
      context: { locale: "en" },
      sessionId,
      toolResults: [{ type: "tool_result", tool_use_id: call?.id, content: "CARD-SHOWN" }],
    });
    expect(finished.body.stopReason).toBe("end_turn");
    expect(textOf(finished)).toContain("CARD-SHOWN");
  });

  it("stops a model that keeps calling tools", async () => {
    const reply = await post(
      tenant.id,
      await tokenFor(tenant, "s-loop", "pro"),
      turn("LOOP get_lesson slug=intro"),
    );
    expect(reply.status).toBe(502);
    expect(reply.body.error).toBe("too_many_rounds");
  });

  it("streams only the final answer of a tool loop", async () => {
    const token = await tokenFor(tenant, "s-stream", "pro");
    const events = await stream(tenant.id, token, turn("TOOLCALL get_lesson slug=intro"));
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", stopReason: "end_turn" });
    expect(done?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const streamed = events
      .filter((event) => event.type === "delta")
      .map((event) => event.text)
      .join("");
    expect(streamed).not.toContain("Let me look that up");
    expect(done?.content?.[0]?.text).toContain("MARKER-LESSON-INTRO");
  });
});
