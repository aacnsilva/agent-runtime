import { beforeAll, describe, expect, it } from "vitest";

import type { CreatedTenant } from "./support/chat.ts";
import { createChatTenant, post, serverTools, textOf, tokenFor, turn } from "./support/chat.ts";
import { runtimeUrl } from "./support/client.ts";

type Json = Record<string, unknown>;

const documents = async (
  tenant: CreatedTenant,
  path: string,
  init: RequestInit = {},
): Promise<Response> =>
  fetch(`${runtimeUrl()}/admin/api/tenants/${tenant.id}/documents${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env["E2E_ADMIN_TOKEN"] ?? ""}`,
      "content-type": "application/json",
    },
  });

const putDocument = async (tenant: CreatedTenant, id: string, document: Json): Promise<Json> =>
  (await (
    await documents(tenant, `/${id}`, { method: "PUT", body: JSON.stringify(document) })
  ).json()) as Json;

interface Asker {
  subject: string;
  plan: string;
}

const search = async (tenant: CreatedTenant, asker: Asker, query: string): Promise<string> =>
  textOf(
    await post(
      tenant.id,
      await tokenFor(tenant, asker.subject, asker.plan),
      turn(`TOOLCALL search_knowledge query=${query}`),
    ),
  );

const CHORDS = {
  title: "Barre chords",
  text: "# Barre chords\n\nKeep the thumb behind the neck. MARKER-CHORDS\n\nPress close to the fret.",
};
const ADVANCED = {
  title: "Sweep picking",
  text: "Sweep picking plays arpeggios in one motion. MARKER-ADVANCED",
  plans: ["pro"],
};

describe("knowledge retrieval per tenant", () => {
  let tenant: CreatedTenant;

  beforeAll(async () => {
    tenant = await createChatTenant({
      state: "stored",
      tools: serverTools(),
      extra: { knowledge: { embeddingModel: "mock-embed", topK: 3 } },
    });
    await putDocument(tenant, "barre-chords", CHORDS);
    await putDocument(tenant, "sweep-picking", ADVANCED);
  });

  it("chunks and embeds a document once, and skips an unchanged one", async () => {
    const stored = await putDocument(tenant, "tuning", {
      title: "Tuning",
      text: "Standard tuning is EADGBE.",
    });
    expect(stored).toMatchObject({ ok: true, chunks: 1, embedded: true });
    const again = await putDocument(tenant, "tuning", {
      title: "Tuning",
      text: "Standard tuning is EADGBE.",
    });
    expect(again).toMatchObject({ ok: true, unchanged: true });
    const list = (await (await documents(tenant, "")).json()) as { id: string }[];
    expect(list.map((entry) => entry.id)).toEqual(["barre-chords", "sweep-picking", "tuning"]);
  });

  it("finds a passage and cites the document it came from", async () => {
    const answer = await search(
      tenant,
      { subject: "k-basic", plan: "basic" },
      "thumb behind the neck",
    );
    expect(answer).toContain("MARKER-CHORDS");
    expect(answer).toContain("Barre chords (barre-chords)");
  });

  it("shows a document restricted to a plan only to subjects on that plan", async () => {
    expect(
      await search(tenant, { subject: "k-basic-2", plan: "basic" }, "sweep picking arpeggios"),
    ).not.toContain("MARKER-ADVANCED");
    expect(
      await search(tenant, { subject: "k-pro", plan: "pro" }, "sweep picking arpeggios"),
    ).toContain("MARKER-ADVANCED");
  });

  it("never returns another tenant's documents", async () => {
    const other = await createChatTenant({ state: "stored", tools: serverTools() });
    const answer = await search(
      other,
      { subject: "k-other", plan: "pro" },
      "thumb behind the neck",
    );
    expect(answer).toContain("Nothing in the knowledge base matched");
  });

  it("forgets a deleted document", async () => {
    await putDocument(tenant, "capo", {
      title: "Capo",
      text: "A capo raises the pitch. MARKER-CAPO",
    });
    expect(
      await search(tenant, { subject: "k-del", plan: "basic" }, "capo raises pitch"),
    ).toContain("MARKER-CAPO");
    expect(await (await documents(tenant, "/capo", { method: "DELETE" })).json()).toEqual({
      ok: true,
      removed: true,
    });
    expect(
      await search(tenant, { subject: "k-del-2", plan: "basic" }, "capo raises pitch"),
    ).not.toContain("MARKER-CAPO");
  });

  it("falls back to keyword search for a tenant with no embedding model", async () => {
    const keywordOnly = await createChatTenant({ state: "stored", tools: serverTools() });
    const stored = await putDocument(keywordOnly, "strumming", {
      title: "Strumming",
      text: "Strumming patterns use down and up strokes. MARKER-STRUM",
    });
    expect(stored).toMatchObject({ chunks: 1, embedded: false });
    expect(
      await search(keywordOnly, { subject: "k-kw", plan: "basic" }, "strumming patterns"),
    ).toContain("MARKER-STRUM");
  });

  it("keeps document management behind the admin token and validates what it is given", async () => {
    const anonymous = await fetch(`${runtimeUrl()}/admin/api/tenants/${tenant.id}/documents`);
    expect(anonymous.status).toBe(401);
    const invalid = await documents(tenant, "/empty", {
      method: "PUT",
      body: JSON.stringify({ title: "x" }),
    });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as Json)["error"]).toBe("bad_document");
  });
});
