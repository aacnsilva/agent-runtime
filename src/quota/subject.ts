import { monthKey, secondsUntilNextUtcMonth } from "./ledger";

export interface QuotaState {
  month: string;
  count: number;
  free: number;
}

export interface QuotaBegin {
  now: number;
  limit: number;
  toolRounds: number;
}

export interface QuotaGrant {
  ok: true;
  used: number;
  limit: number;
  spent: 0 | 1;
  usedFreeRound: boolean;
}

export interface QuotaRefusal {
  ok: false;
  error: "message_cap";
  retryAfterSeconds: number;
}

export interface QuotaRefund {
  now: number;
  spent: 0 | 1;
  usedFreeRound: boolean;
}

export interface QuotaStep<T> {
  state: QuotaState;
  result: T;
}

export const emptyQuota = (): QuotaState => ({ month: "", count: 0, free: 0 });

const FIRST_ROUND = 1;

const current = (state: QuotaState, now: number): QuotaState => {
  const month = monthKey(now);
  return state.month === month ? state : { month, count: 0, free: 0 };
};

export const beginQuota = (
  previous: QuotaState,
  input: QuotaBegin,
): QuotaStep<QuotaGrant | QuotaRefusal> => {
  const state = current(previous, input.now);
  const usedFreeRound = input.toolRounds === FIRST_ROUND && state.free < state.count;
  const spent = usedFreeRound ? 0 : 1;
  if (spent === 1 && state.count >= input.limit) {
    return {
      state,
      result: {
        ok: false,
        error: "message_cap",
        retryAfterSeconds: secondsUntilNextUtcMonth(input.now),
      },
    };
  }
  const count = state.count + spent;
  return {
    state: { ...state, count, free: usedFreeRound ? state.free + 1 : state.free },
    result: { ok: true, used: count, limit: input.limit, spent, usedFreeRound },
  };
};

export const refundQuota = (previous: QuotaState, input: QuotaRefund): QuotaStep<null> => {
  if (previous.month !== monthKey(input.now)) {
    return { state: previous, result: null };
  }
  if (input.usedFreeRound) {
    return { state: { ...previous, free: Math.max(0, previous.free - 1) }, result: null };
  }
  return {
    state: { ...previous, count: Math.max(0, previous.count - input.spent) },
    result: null,
  };
};

export const usedThisMonth = (state: QuotaState, now: number): number => current(state, now).count;
