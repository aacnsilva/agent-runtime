import { limitsOf } from "../agent/run";
import { corsHeaders, withHeaders } from "../http/cors";
import { json } from "../http/respond";
import { loadTenant } from "../tenants/registry";
import type { RequestContext } from "./context";

export const handleStatus = async (
  context: RequestContext,
  tenantId: string,
): Promise<Response> => {
  const tenant = await loadTenant(context.env, tenantId);
  if (tenant === null) {
    return json({ error: "not_found" }, 404);
  }
  const ledger = context.env.LEDGER.get(context.env.LEDGER.idFromName(`pool:${tenant.id}`));
  const pool = await ledger.status({ now: Date.now(), limits: limitsOf(tenant) });
  return withHeaders(
    json({ accepting: pool.accepting }, 200),
    corsHeaders(context.request, tenant.authn.allowedOrigins),
  );
};

export const handlePreflight = async (
  context: RequestContext,
  tenantId: string,
): Promise<Response> => {
  const tenant = await loadTenant(context.env, tenantId);
  return tenant === null
    ? json({ error: "not_found" }, 404)
    : new Response(null, {
        status: 204,
        headers: corsHeaders(context.request, tenant.authn.allowedOrigins),
      });
};
