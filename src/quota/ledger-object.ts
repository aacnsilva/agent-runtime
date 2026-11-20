import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";
import type {
  BeginInput,
  BeginResult,
  LedgerState,
  PoolStatus,
  ReleaseInput,
  SettleInput,
  StatusInput,
  Step,
} from "./ledger";
import { begin, emptyState, release, settle, status } from "./ledger";

const STATE_KEY = "state";

export class Ledger extends DurableObject<Env> {
  private state: LedgerState | undefined;

  async begin(input: BeginInput): Promise<BeginResult> {
    return this.apply(input.now, (state) => begin(state, input));
  }

  async settle(input: SettleInput): Promise<void> {
    await this.apply(input.now, (state) => settle(state, input));
  }

  async release(input: ReleaseInput): Promise<void> {
    await this.apply(input.now, (state) => release(state, input));
  }

  async status(input: StatusInput): Promise<PoolStatus> {
    return this.apply(input.now, (state) => status(state, input));
  }

  private async apply<T>(now: number, transition: (state: LedgerState) => Step<T>): Promise<T> {
    this.state ??= (await this.ctx.storage.get<LedgerState>(STATE_KEY)) ?? emptyState(now);
    const step = transition(this.state);
    this.state = step.state;
    await this.ctx.storage.put(STATE_KEY, step.state);
    return step.result;
  }
}
