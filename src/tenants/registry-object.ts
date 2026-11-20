import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";
import type { Tenant } from "./schema";

const KEY_PREFIX = "tenant:";

export class Registry extends DurableObject<Env> {
  async put(tenant: Tenant): Promise<void> {
    await this.ctx.storage.put(`${KEY_PREFIX}${tenant.id}`, tenant);
  }

  async get(id: string): Promise<Tenant | null> {
    return (await this.ctx.storage.get<Tenant>(`${KEY_PREFIX}${id}`)) ?? null;
  }

  async list(): Promise<Tenant[]> {
    const stored = await this.ctx.storage.list<Tenant>({ prefix: KEY_PREFIX });
    return [...stored.values()];
  }
}
