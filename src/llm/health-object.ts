import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";
import type { BreakerState } from "./breaker";
import { recordFailure, recordSuccess } from "./breaker";
import type { ModelId } from "./catalog";

const STATE_KEY = "circuits";

export interface HealthReport {
  model: ModelId;
  ok: boolean;
  now: number;
}

export class ModelHealth extends DurableObject<Env> {
  async snapshot(): Promise<BreakerState> {
    return (await this.ctx.storage.get<BreakerState>(STATE_KEY)) ?? {};
  }

  async report(input: HealthReport): Promise<BreakerState> {
    const state = await this.snapshot();
    const next = input.ok
      ? recordSuccess(state, input.model)
      : recordFailure(state, input.model, input.now);
    await this.ctx.storage.put(STATE_KEY, next);
    return next;
  }
}
