import type { Env } from "../env";
import type { Registry } from "./registry-object";
import type { Tenant } from "./schema";
import { tenantSchema } from "./schema";

const FRESH_MS = 30_000;
const MISSING_FRESH_MS = 5000;

interface Cached {
  at: number;
  tenant: Tenant | null;
}

const cache = new Map<string, Cached>();

const registryOf = (env: Env): DurableObjectStub<Registry> =>
  env.REGISTRY.get(env.REGISTRY.idFromName("global"));

const isFresh = (cached: Cached, now: number): boolean =>
  now - cached.at < (cached.tenant === null ? MISSING_FRESH_MS : FRESH_MS);

const parseTenant = (serialized: string): Tenant | null => {
  const parsed = tenantSchema.safeParse(JSON.parse(serialized));
  return parsed.success ? parsed.data : null;
};

export const loadTenant = async (env: Env, id: string): Promise<Tenant | null> => {
  const now = Date.now();
  const cached = cache.get(id);
  if (cached !== undefined && isFresh(cached, now)) {
    return cached.tenant;
  }
  const serialized = await registryOf(env).get(id);
  const tenant = serialized === null ? null : parseTenant(serialized);
  cache.set(id, { at: now, tenant });
  return tenant;
};

export const saveTenant = async (env: Env, tenant: Tenant): Promise<void> => {
  await registryOf(env).put(tenant.id, JSON.stringify(tenant));
  cache.set(tenant.id, { at: Date.now(), tenant });
};

export const listTenants = async (env: Env): Promise<Tenant[]> => {
  const stored = await registryOf(env).list();
  return stored.flatMap((serialized) => {
    const tenant = parseTenant(serialized);
    return tenant === null ? [] : [tenant];
  });
};
