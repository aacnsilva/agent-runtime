import type { Candidates, ModelId } from "./catalog";

const FAILURES_TO_OPEN = 3;
const OPEN_MS = 30_000;

interface Circuit {
  failures: number;
  openedAt: number | null;
}

export interface Breaker {
  order: (candidates: Candidates, now: number) => Candidates;
  succeeded: (model: ModelId) => void;
  failed: (model: ModelId, now: number) => void;
  isOpen: (model: ModelId, now: number) => boolean;
}

export const createBreaker = (): Breaker => {
  const circuits = new Map<ModelId, Circuit>();

  const isOpen = (model: ModelId, now: number): boolean => {
    const openedAt = circuits.get(model)?.openedAt ?? null;
    return openedAt !== null && now - openedAt < OPEN_MS;
  };

  const order = (candidates: Candidates, now: number): Candidates => {
    const closed = candidates.filter((model) => !isOpen(model, now));
    const [first, ...rest] = closed;
    return first === undefined ? [candidates[0]] : [first, ...rest];
  };

  const succeeded = (model: ModelId): void => {
    circuits.delete(model);
  };

  const failed = (model: ModelId, now: number): void => {
    const failures = (circuits.get(model)?.failures ?? 0) + 1;
    circuits.set(model, { failures, openedAt: failures >= FAILURES_TO_OPEN ? now : null });
  };

  return { order, succeeded, failed, isOpen };
};

export const sharedBreaker = createBreaker();
