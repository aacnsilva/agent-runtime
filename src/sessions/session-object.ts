import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";

const STATE_KEY = "session";
const VERSION_KEY = "version";

export class Session extends DurableObject<Env> {
  async load(): Promise<string | null> {
    return (await this.ctx.storage.get<string>(STATE_KEY)) ?? null;
  }

  async save(serialized: string, expectedVersion: number): Promise<boolean> {
    const version = (await this.ctx.storage.get<number>(VERSION_KEY)) ?? 0;
    if (version !== expectedVersion) {
      return false;
    }
    await this.ctx.storage.put({ [STATE_KEY]: serialized, [VERSION_KEY]: expectedVersion + 1 });
    return true;
  }

  async clear(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
