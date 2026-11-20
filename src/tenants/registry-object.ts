import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";

const KEY_PREFIX = "tenant:";

export class Registry extends DurableObject<Env> {
  async put(id: string, serialized: string): Promise<void> {
    await this.ctx.storage.put(`${KEY_PREFIX}${id}`, serialized);
  }

  async get(id: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(`${KEY_PREFIX}${id}`)) ?? null;
  }

  async list(): Promise<string[]> {
    const stored = await this.ctx.storage.list<string>({ prefix: KEY_PREFIX });
    return [...stored.values()];
  }
}
