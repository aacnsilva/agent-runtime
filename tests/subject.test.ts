import { describe, expect, it } from "vitest";

import type { Counting, QuotaState } from "../src/quota/subject";
import { beginQuota, emptyQuota, refundQuota } from "../src/quota/subject";

const NOW = Date.UTC(2026, 10, 20);
const DECEMBER = Date.UTC(2026, 11, 2);

const FIRST_FREE = { counting: "first_round_free" as const };

const play = (
  rounds: number[],
  limit = 300,
  counting: Counting = "first_round_free",
): { state: QuotaState; spent: number[] } => {
  let state = emptyQuota();
  const spent: number[] = [];
  for (const toolRounds of rounds) {
    const step = beginQuota(state, { now: NOW, limit, toolRounds, counting });
    state = step.state;
    spent.push(step.result.ok ? step.result.spent : -1);
  }
  return { state, spent };
};

describe("message quota", () => {
  it("counts a question and its first tool round as one message", () => {
    expect(play([0, 1]).spent).toEqual([1, 0]);
    expect(play([0, 1]).state.count).toBe(1);
  });

  it("counts every tool round after the first as one more message", () => {
    expect(play([0, 1, 2, 3, 4]).spent).toEqual([1, 0, 1, 1, 1]);
    expect(play([0, 1, 2, 3, 4]).state.count).toBe(4);
  });

  it("gives one free first round per counted message and no more", () => {
    expect(play([0, 1, 1, 1]).spent).toEqual([1, 0, 1, 0]);
    expect(play([1, 1]).spent).toEqual([1, 0]);
  });

  it("refuses at the cap with the wait until next month, but still lets a free round through", () => {
    const { state } = play([0, 0], 2);
    const refused = beginQuota(state, { now: NOW, limit: 2, toolRounds: 0, ...FIRST_FREE });
    expect(refused.result).toEqual({
      ok: false,
      error: "message_cap",
      retryAfterSeconds: (Date.UTC(2026, 11, 1) - NOW) / 1000,
    });
    const freeRound = beginQuota(state, { now: NOW, limit: 2, toolRounds: 1, ...FIRST_FREE });
    expect(freeRound.result).toMatchObject({ ok: true, spent: 0, used: 2 });
  });

  it("starts again on the first of the month", () => {
    const { state } = play([0, 0], 2);
    const next = beginQuota(state, { now: DECEMBER, limit: 2, toolRounds: 0, ...FIRST_FREE });
    expect(next.result).toMatchObject({ ok: true, used: 1 });
  });

  it("gives back exactly what a failed call spent", () => {
    const message = beginQuota(emptyQuota(), { now: NOW, limit: 5, toolRounds: 0, ...FIRST_FREE });
    const round = beginQuota(message.state, { now: NOW, limit: 5, toolRounds: 1, ...FIRST_FREE });
    const afterRound = refundQuota(round.state, { now: NOW, spent: 0, usedFreeRound: true }).state;
    expect(afterRound).toMatchObject({ count: 1, free: 0 });
    const afterMessage = refundQuota(afterRound, {
      now: NOW,
      spent: 1,
      usedFreeRound: false,
    }).state;
    expect(afterMessage.count).toBe(0);
    expect(refundQuota(afterMessage, { now: DECEMBER, spent: 1, usedFreeRound: false }).state).toBe(
      afterMessage,
    );
  });

  it("can count every model call, or only the questions, when the tenant says so", () => {
    expect(play([0, 1, 2, 0, 1], 300, "every_call").spent).toEqual([1, 1, 1, 1, 1]);
    expect(play([0, 1, 2, 0, 1], 300, "questions_only").spent).toEqual([1, 0, 0, 1, 0]);
    expect(play([0, 1, 2, 0, 1], 300, "first_round_free").spent).toEqual([1, 0, 1, 1, 0]);
  });
});
