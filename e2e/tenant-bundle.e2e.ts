import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { adminGet, askStream, poolOf, providerCalls, runtimeUrl } from "./support/client.ts";

interface Bundle {
  id: string;
  authn: { allowedOrigins: string[] };
  agent: {
    system: string;
    gate: {
      fallback: { refusal: string; unreadable: string };
      locales: { pattern: string; refusal: string }[];
    };
  };
}

const bundlePath = process.env["E2E_TENANT_BUNDLE"];

describe.skipIf(bundlePath === undefined)("a real tenant bundle", () => {
  let bundle: Bundle = {
    id: "",
    authn: { allowedOrigins: [] },
    agent: { system: "", gate: { fallback: { refusal: "", unreadable: "" }, locales: [] } },
  };

  const ask = async (question: string, origin?: string): Promise<Response> =>
    fetch(`${runtimeUrl()}/v1/tenants/${bundle.id}/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: origin ?? bundle.authn.allowedOrigins[0] ?? "",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
    });

  it("is accepted by the admin API as written", async () => {
    const raw = await readFile(bundlePath ?? "", "utf8");
    bundle = JSON.parse(raw) as Bundle;
    const response = await fetch(`${runtimeUrl()}/admin/api/tenants/${bundle.id}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${process.env["E2E_ADMIN_TOKEN"] ?? ""}`,
        "content-type": "application/json",
      },
      body: raw,
    });
    expect(await response.text()).toContain('"ok":true');
    expect((await adminGet("/admin/api/tenants")).status).toBe(200);
  });

  it("answers its own origin and sends the whole system prompt, cached", async () => {
    const response = await ask("BUNDLE probe question");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      bundle.authn.allowedOrigins[0],
    );
    const call = (await providerCalls()).find((entry) => entry.question.includes("BUNDLE probe"));
    expect(call?.systemChars).toBe(bundle.agent.system.length);
    expect(call?.cacheMarked).toBe(true);
  });

  it("refuses a foreign origin", async () => {
    expect((await ask("hello", "https://evil.example")).status).toBe(403);
  });

  it("replaces an off-topic reply with its own refusal text", async () => {
    const response = await ask("OFFTOPIC hello there");
    expect(await response.json()).toEqual({
      onTopic: false,
      answer: bundle.agent.gate.fallback.refusal,
    });
  });

  it("streams an answer and reports the pool as accepting", async () => {
    const events = await askStream(
      bundle.id,
      "Tell me about the product",
      bundle.authn.allowedOrigins[0],
    );
    expect(events.at(-1)?.type).toBe("done");
    const status = await fetch(`${runtimeUrl()}/v1/tenants/${bundle.id}/status`);
    expect(await status.json()).toEqual({ accepting: true });
    expect((await poolOf(bundle.id)).spentNanoEur).toBeGreaterThan(0);
  });
});
