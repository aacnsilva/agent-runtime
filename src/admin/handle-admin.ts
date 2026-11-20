import { z } from "zod";

import { limitsOf } from "../agent/spend";
import type { Env } from "../env";
import { json, Rejection } from "../http/respond";
import type { Window } from "../observability/aggregate";
import { summarize } from "../observability/aggregate";
import { listTenants, saveTenant } from "../tenants/registry";
import type { Tenant } from "../tenants/schema";
import { tenantSchema } from "../tenants/schema";
import { contractHash } from "../tools/contract-hash";
import { assertAdmin } from "./auth";
import { handleDocuments, isDocumentPath } from "./handle-documents";

const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURS = 24 * 31;
const TARGET_BUCKETS = 48;
const BUCKET_STEPS_MS = [60_000, 300_000, 900_000, HOUR_MS, 6 * HOUR_MS, 24 * HOUR_MS];
const MAX_TENANT_BYTES = 600_000;

const windowFor = (url: URL, now: number): Window => {
  const requested = Number(url.searchParams.get("hours") ?? "24");
  const hours = Number.isFinite(requested) ? Math.min(MAX_HOURS, Math.max(1, requested)) : 24;
  const span = hours * HOUR_MS;
  const bucketMs = BUCKET_STEPS_MS.find((step) => span / step <= TARGET_BUCKETS) ?? 24 * HOUR_MS;
  return { since: now - span, until: now, bucketMs };
};

const poolOf = async (env: Env, tenant: Tenant, now: number): Promise<Record<string, unknown>> => {
  const ledger = env.LEDGER.get(env.LEDGER.idFromName(`pool:${tenant.id}`));
  const pool = await ledger.status({ now, limits: limitsOf(tenant) });
  return { id: tenant.id, name: tenant.name, tier: tenant.agent.tier, pool };
};

const metrics = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  const now = Date.now();
  const window = windowFor(url, now);
  const tenantFilter = url.searchParams.get("tenant");
  const store = env.METRICS.get(env.METRICS.idFromName("global"));
  const [events, tenants] = await Promise.all([store.since(window.since), listTenants(env)]);
  const selected =
    tenantFilter === null ? events : events.filter((event) => event.tenant === tenantFilter);
  const pools = await Promise.all(tenants.map((tenant) => poolOf(env, tenant, now)));
  return json({ ...summarize(selected, window), tenants: pools }, 200);
};

const putTenant = async (request: Request, env: Env, id: string): Promise<Response> => {
  const raw = await request.text();
  if (raw.length > MAX_TENANT_BYTES) {
    throw new Rejection(400, "too_large");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Rejection(400, "bad_json");
  }
  const parsed = tenantSchema.safeParse(body);
  if (!parsed.success) {
    throw new Rejection(400, "bad_tenant", { message: z.prettifyError(parsed.error) });
  }
  if (parsed.data.id !== id) {
    throw new Rejection(400, "id_mismatch");
  }
  await saveTenant(env, parsed.data);
  return json({ ok: true, id, contracts: await contractHashes(parsed.data) }, 200);
};

const contractHashes = async (tenant: Tenant): Promise<{ version: number; hash: string }[]> => {
  const contracts = tenant.agent.kind === "chat" ? tenant.agent.contracts : [];
  return Promise.all(
    contracts.map(async (contract) => ({
      version: contract.version,
      hash: await contractHash(contract),
    })),
  );
};

const listSummaries = async (env: Env): Promise<Response> => {
  const tenants = await listTenants(env);
  return json(
    tenants.map((tenant) => ({ id: tenant.id, name: tenant.name, tier: tenant.agent.tier })),
    200,
  );
};

const TENANT_PATH = /^\/admin\/api\/tenants\/([a-z0-9-]+)$/;

export const handleAdminApi = async (request: Request, env: Env): Promise<Response> => {
  await assertAdmin(request, env);
  const { pathname } = new URL(request.url);
  if (isDocumentPath(pathname)) {
    return handleDocuments(request, env);
  }
  const tenantId = TENANT_PATH.exec(pathname)?.[1];
  if (tenantId !== undefined && request.method === "PUT") {
    return putTenant(request, env, tenantId);
  }
  if (pathname === "/admin/api/tenants" && request.method === "GET") {
    return listSummaries(env);
  }
  if (pathname === "/admin/api/metrics" && request.method === "GET") {
    return metrics(request, env);
  }
  throw new Rejection(404, "not_found");
};
