import { Rejection } from "../http/respond";
import { sharedBreaker } from "../llm/breaker";
import type { ModelId, Tier } from "../llm/catalog";
import { candidatesFor } from "../llm/catalog";
import type { Usage } from "../llm/cost";
import { costNanoEur, euroToNano, NO_USAGE, reserveNanoEur } from "../llm/cost";
import type { Listeners, ModelReply, ModelRequest, Provider } from "../llm/provider";
import { routeWithFallback, RoutingFailure } from "../llm/router";
import type {
  BeginInput,
  BeginResult,
  Limits,
  RefusalCode,
  ReleaseInput,
  SettleInput,
} from "../quota/ledger";
import type { Tenant } from "../tenants/schema";

export interface LedgerPort {
  begin: (input: BeginInput) => Promise<BeginResult>;
  settle: (input: SettleInput) => Promise<void>;
  release: (input: ReleaseInput) => Promise<void>;
}

export interface Spend {
  tenant: Tenant;
  tier: Tier;
  effortOverride: "low" | "medium" | "high" | null;
  ip: string;
  skipNetworkLimit: boolean;
  provider: Provider;
  ledger: LedgerPort;
}

export interface Reservation {
  id: string;
  nanoEur: number;
}

export interface ModelSuccess {
  ok: true;
  reply: ModelReply;
  model: ModelId;
  attempts: number;
  usage: Usage;
  costNanoEur: number;
}

export interface ModelFailure {
  ok: false;
  billable: boolean;
  model: ModelId;
  attempts: number;
  usage: Usage;
  costNanoEur: number;
}

export type ModelOutcome = ModelSuccess | ModelFailure;

const LIMIT_MESSAGES: Record<RefusalCode, string> = {
  ip_hour: "This network has asked enough for the moment. Try again later.",
  ip_day: "This network has reached today's limit.",
  budget: "Answers are paused until next month.",
  bad_reserve: "That question could not be priced.",
};

export const UPSTREAM_BODY = {
  error: "upstream",
  message: "The answer service did not reply. Try again in a moment.",
};

export const limitsOf = (tenant: Tenant): Limits => ({
  perHour: tenant.limits.ipPerHour,
  perDay: tenant.limits.ipPerDay,
  poolNanoEur: euroToNano(tenant.limits.poolEurPerMonth),
});

export const reservePool = async (
  spend: Spend,
  promptChars: number,
  maxOutputTokens: number,
): Promise<Reservation> => {
  const reservation = {
    id: crypto.randomUUID(),
    nanoEur: reserveNanoEur(
      { promptChars, maxOutputTokens },
      candidatesFor(spend.tier),
      spend.tenant.limits.usdPerEur,
    ),
  };
  const begun = await spend.ledger.begin({
    now: Date.now(),
    ip: spend.ip,
    skipNetworkLimit: spend.skipNetworkLimit,
    reserveNanoEur: reservation.nanoEur,
    reservationId: reservation.id,
    limits: limitsOf(spend.tenant),
  });
  if (!begun.ok) {
    throw new Rejection(429, begun.error, {
      message: LIMIT_MESSAGES[begun.error],
      retryAfterSeconds: begun.retryAfterSeconds,
    });
  }
  return reservation;
};

export const releasePool = async (spend: Spend, reservation: Reservation): Promise<void> => {
  await spend.ledger.release({ now: Date.now(), reservationId: reservation.id });
};

const failed = async (
  spend: Spend,
  reservation: Reservation,
  failure: RoutingFailure,
): Promise<ModelFailure> => {
  const { billable, model, attempts } = failure.detail;
  if (billable) {
    await spend.ledger.settle({
      now: Date.now(),
      reservationId: reservation.id,
      actualNanoEur: reservation.nanoEur,
    });
  } else {
    await releasePool(spend, reservation);
  }
  return {
    ok: false,
    billable,
    model,
    attempts,
    usage: NO_USAGE,
    costNanoEur: billable ? reservation.nanoEur : 0,
  };
};

export interface ModelCall {
  spend: Spend;
  reservation: Reservation;
  request: ModelRequest;
  listeners: Listeners;
}

const tracking = (listeners: Listeners, onStart: () => void): Listeners => ({
  ...(listeners.onText === undefined
    ? {}
    : {
        onText: (text: string): void => {
          onStart();
          listeners.onText?.(text);
        },
      }),
  onTool: (): void => {
    onStart();
    listeners.onTool?.();
  },
});

export const callModel = async (call: ModelCall): Promise<ModelOutcome> => {
  const { spend, reservation } = call;
  let started = false;
  const listeners = tracking(call.listeners, () => {
    started = true;
  });
  try {
    const routed = await routeWithFallback({
      candidates: candidatesFor(spend.tier),
      breaker: sharedBreaker,
      call: (model) => spend.provider.complete(model, call.request, listeners),
      isBillable: (error) => started || spend.provider.isTimeout(error),
    });
    const { usage } = routed.reply;
    const cost = costNanoEur(usage, {
      model: routed.model,
      usdPerEur: spend.tenant.limits.usdPerEur,
    });
    await spend.ledger.settle({
      now: Date.now(),
      reservationId: reservation.id,
      actualNanoEur: cost,
    });
    return { ok: true, ...routed, usage, costNanoEur: cost };
  } catch (error) {
    if (error instanceof RoutingFailure) {
      return failed(spend, reservation, error);
    }
    throw error;
  }
};
