import type { Candidates, ModelId } from "./catalog";

export const FAILURES_TO_OPEN = 3;
export const FAILURE_WINDOW_MS = 60_000;
export const OPEN_MS = 30_000;

export interface Circuit {
  failures: number[];
  openedAt: number | null;
}

export type BreakerState = Record<string, Circuit>;

export interface Breaker {
  order: (candidates: Candidates, now: number) => Candidates;
  succeeded: (model: ModelId) => void;
  failed: (model: ModelId, now: number) => void;
  isOpen: (model: ModelId, now: number) => boolean;
}

const isOnTrial = (circuit: Circuit, now: number): boolean =>
  circuit.openedAt !== null && now - circuit.openedAt < OPEN_MS + FAILURE_WINDOW_MS;

export const isOpen = (state: BreakerState, model: ModelId, now: number): boolean => {
  const openedAt = state[model]?.openedAt ?? null;
  return openedAt !== null && now - openedAt < OPEN_MS;
};

export const hasHistory = (state: BreakerState, model: ModelId): boolean =>
  state[model] !== undefined;

export const recordFailure = (state: BreakerState, model: ModelId, now: number): BreakerState => {
  const circuit = state[model] ?? { failures: [], openedAt: null };
  const failures = [...circuit.failures.filter((at) => now - at < FAILURE_WINDOW_MS), now].slice(
    -FAILURES_TO_OPEN,
  );
  const opens = failures.length >= FAILURES_TO_OPEN || isOnTrial(circuit, now);
  return { ...state, [model]: { failures, openedAt: opens ? now : null } };
};

export const recordSuccess = (state: BreakerState, model: ModelId): BreakerState =>
  Object.fromEntries(Object.entries(state).filter(([name]) => name !== model));

export const orderCandidates = (
  state: BreakerState,
  candidates: Candidates,
  now: number,
): Candidates => {
  const [first, ...rest] = candidates.filter((model) => !isOpen(state, model, now));
  return first === undefined ? [candidates[0]] : [first, ...rest];
};

export const createBreaker = (): Breaker => {
  let state: BreakerState = {};
  return {
    order: (candidates, now) => orderCandidates(state, candidates, now),
    isOpen: (model, now) => isOpen(state, model, now),
    succeeded: (model) => {
      state = recordSuccess(state, model);
    },
    failed: (model, now) => {
      state = recordFailure(state, model, now);
    },
  };
};
