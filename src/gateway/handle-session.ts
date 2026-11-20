import { authenticate } from "../authn/authenticate";
import { corsHeaders, withHeaders } from "../http/cors";
import { json, Rejection } from "../http/respond";
import { transcript } from "../sessions/session";
import { readSession, sessionStub } from "../sessions/session-port";
import { loadTenant } from "../tenants/registry";
import type { Tenant } from "../tenants/schema";
import type { RequestContext } from "./context";
import { rejected } from "./handle-run";

const respond = async (
  context: RequestContext,
  tenant: Tenant,
  sessionId: string,
): Promise<Response> => {
  const { env, request } = context;
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const principal = await authenticate(context, tenant, rawBody);
  const store = sessionStub(env, tenant.id, sessionId);
  const state = await readSession(store);
  if (state === null) {
    throw new Rejection(404, "not_found");
  }
  if (state.owner !== principal.subjectId) {
    throw new Rejection(404, "not_found");
  }
  if (request.method === "DELETE") {
    await store.clear();
    return json({ ok: true }, 200);
  }
  return json(
    {
      sessionId,
      updatedAt: state.updatedAt,
      awaitingToolResults: state.pending !== null,
      messages: transcript(state.messages),
    },
    200,
  );
};

export const handleSession = async (
  context: RequestContext,
  tenantId: string,
  sessionId: string,
): Promise<Response> => {
  const tenant = await loadTenant(context.env, tenantId);
  if (tenant === null) {
    return json({ error: "not_found" }, 404);
  }
  try {
    const response = await respond(context, tenant, sessionId);
    return withHeaders(response, corsHeaders(context.request, tenant.authn.allowedOrigins));
  } catch (error) {
    if (error instanceof Rejection) {
      return rejected(context, tenant, error);
    }
    throw error;
  }
};
