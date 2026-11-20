import type { Env } from "../env";
import type { Breaker, BreakerState } from "./breaker";
import { hasHistory, isOpen, orderCandidates, recordFailure, recordSuccess } from "./breaker";
import type { HealthReport } from "./health-object";

const REFRESH_MS = 5000;

interface Known {
  state: BreakerState;
  fetchedAt: number;
}

export interface HealthPort {
  snapshot: () => Promise<BreakerState>;
  report: (input: HealthReport) => Promise<BreakerState>;
}

export interface SharedBreakerOptions {
  health: HealthPort;
  defer: (work: Promise<unknown>) => void;
  now: number;
}

let known: Known | null = null;

const adopt = (state: BreakerState): void => {
  known = { state, fetchedAt: Date.now() };
};

const refresh = async (health: HealthPort): Promise<void> => {
  adopt(await health.snapshot().catch(() => known?.state ?? {}));
};

const stateNow = (): BreakerState => known?.state ?? {};

export const forgetSharedBreaker = (): void => {
  known = null;
};

export const sharedBreaker = async (options: SharedBreakerOptions): Promise<Breaker> => {
  const { health, defer } = options;
  if (known === null) {
    await refresh(health);
  } else if (options.now - known.fetchedAt > REFRESH_MS) {
    defer(refresh(health));
  }
  const tell = (report: HealthReport): void => {
    defer(
      health
        .report(report)
        .then(adopt)
        .catch(() => undefined),
    );
  };
  return {
    order: (candidates, now) => orderCandidates(stateNow(), candidates, now),
    isOpen: (model, now) => isOpen(stateNow(), model, now),
    failed: (model, now) => {
      adopt(recordFailure(stateNow(), model, now));
      tell({ model, ok: false, now });
    },
    succeeded: (model) => {
      if (!hasHistory(stateNow(), model)) {
        return;
      }
      adopt(recordSuccess(stateNow(), model));
      tell({ model, ok: true, now: Date.now() });
    },
  };
};

export const breakerFor = async (env: Env, ctx: ExecutionContext): Promise<Breaker> =>
  sharedBreaker({
    health: env.MODEL_HEALTH.get(env.MODEL_HEALTH.idFromName("global")),
    defer: (work) => {
      ctx.waitUntil(work);
    },
    now: Date.now(),
  });
