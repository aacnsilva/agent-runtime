import { monthKey, secondsUntilNextUtcMonth } from "./ledger";

export interface QuotaState {
  month: string;
  count: number;
  free: number;
}

export type Counting = "first_round_free" | "every_call" | "questions_only";

export interface QuotaBegin {
  now: number;
  limit: number;
  toolRounds: number;
  counting: Counting;
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

interface Charge {
  spent: 0 | 1;
  usedFreeRound: boolean;
}

const chargeFor = (state: QuotaState, input: QuotaBegin): Charge => {
  if (input.counting === "every_call") {
    return { spent: 1, usedFreeRound: false };
  }
  if (input.counting === "questions_only") {
    return { spent: input.toolRounds === 0 ? 1 : 0, usedFreeRound: false };
  }
  const usedFreeRound = input.toolRounds === FIRST_ROUND && state.free < state.count;
  return { spent: usedFreeRound ? 0 : 1, usedFreeRound };
};

export const beginQuota = (
  previous: QuotaState,
  input: QuotaBegin,
): QuotaStep<QuotaGrant | QuotaRefusal> => {
  const state = current(previous, input.now);
  const { spent, usedFreeRound } = chargeFor(state, input);
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
