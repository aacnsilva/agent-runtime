import { conversationChars, latestQuestion } from "../gateway/conversation";
import { Rejection } from "../http/respond";
import type { ModelId } from "../llm/catalog";
import { candidatesFor } from "../llm/catalog";
import type { Usage } from "../llm/cost";
import { costNanoEur, euroToNano, NO_USAGE, reserveNanoEur } from "../llm/cost";
import type { ChatMessage, Completion, Provider, TextListener } from "../llm/provider";
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
import { parseReply, REPLY_SCHEMA, textsFor } from "./gate";

export interface LedgerPort {
  begin: (input: BeginInput) => Promise<BeginResult>;
  settle: (input: SettleInput) => Promise<void>;
  release: (input: ReleaseInput) => Promise<void>;
}

export interface RunInput {
  tenant: Tenant;
  messages: readonly ChatMessage[];
  ip: string;
  provider: Provider;
  ledger: LedgerPort;
}

export interface Reservation {
  id: string;
  nanoEur: number;
}

export interface RunResult {
  tenantId: string;
  status: number;
  outcome: string;
  body: Record<string, unknown>;
  model: ModelId | null;
  attempts: number;
  usage: Usage;
  costNanoEur: number;
}

const LIMIT_MESSAGES: Record<RefusalCode, string> = {
  ip_hour: "This network has asked enough for the moment. Try again later.",
  ip_day: "This network has reached today's limit.",
  budget: "Answers are paused until next month.",
  bad_reserve: "That question could not be priced.",
};

const UPSTREAM_MESSAGE = "The answer service did not reply. Try again in a moment.";

export const limitsOf = (tenant: Tenant): Limits => ({
  perHour: tenant.limits.ipPerHour,
  perDay: tenant.limits.ipPerDay,
  poolNanoEur: euroToNano(tenant.limits.poolEurPerMonth),
});

export const reserve = async (input: RunInput): Promise<Reservation> => {
  const { tenant } = input;
  const promptChars =
    conversationChars(input.messages) +
    tenant.agent.system.length +
    (tenant.agent.reminder?.length ?? 0);
  const reservation = {
    id: crypto.randomUUID(),
    nanoEur: reserveNanoEur(
      { promptChars, maxOutputTokens: tenant.agent.maxOutputTokens },
      candidatesFor(tenant.agent.tier),
      tenant.limits.usdPerEur,
    ),
  };
  const begun = await input.ledger.begin({
    now: Date.now(),
    ip: input.ip,
    reserveNanoEur: reservation.nanoEur,
    reservationId: reservation.id,
    limits: limitsOf(tenant),
  });
  if (!begun.ok) {
    throw new Rejection(429, begun.error, {
      message: LIMIT_MESSAGES[begun.error],
      retryAfterSeconds: begun.retryAfterSeconds,
    });
  }
  return reservation;
};

const verdict = (input: RunInput, completion: Completion): Pick<RunResult, "outcome" | "body"> => {
  const texts = textsFor(input.tenant.agent.gate, latestQuestion(input.messages));
  if (completion.stopReason === "refusal") {
    return { outcome: "refusal", body: { onTopic: false, answer: texts.refusal } };
  }
  const reply = parseReply(completion.text);
  if (reply === null) {
    return { outcome: "unreadable", body: { onTopic: false, answer: texts.unreadable } };
  }
  return reply.onTopic
    ? { outcome: "answered", body: { onTopic: true, answer: reply.answer } }
    : { outcome: "off_topic", body: { onTopic: false, answer: texts.refusal } };
};

const failed = async (
  input: RunInput,
  reservation: Reservation,
  failure: RoutingFailure,
): Promise<RunResult> => {
  const { billable, model, attempts } = failure.detail;
  const now = Date.now();
  if (billable) {
    await input.ledger.settle({
      now,
      reservationId: reservation.id,
      actualNanoEur: reservation.nanoEur,
    });
  } else {
    await input.ledger.release({ now, reservationId: reservation.id });
  }
  return {
    tenantId: input.tenant.id,
    status: 502,
    outcome: billable ? "upstream_billed" : "upstream",
    body: { error: "upstream", message: UPSTREAM_MESSAGE },
    model,
    attempts,
    usage: NO_USAGE,
    costNanoEur: billable ? reservation.nanoEur : 0,
  };
};

export const answer = async (
  input: RunInput,
  reservation: Reservation,
  onText: TextListener | undefined,
): Promise<RunResult> => {
  const { tenant, provider } = input;
  let started = false;
  const heard =
    onText === undefined
      ? undefined
      : (text: string): void => {
          started = true;
          onText(text);
        };
  const request = {
    maxOutputTokens: tenant.agent.maxOutputTokens,
    effort: tenant.agent.effort,
    system: tenant.agent.system,
    messages: input.messages,
    reminder: tenant.agent.reminder,
    replySchema: REPLY_SCHEMA,
  };
  try {
    const routed = await routeWithFallback({
      candidates: candidatesFor(tenant.agent.tier),
      call: (model) => provider.complete(model, request, heard),
      isBillable: (error) => started || provider.isTimeout(error),
    });
    const { usage } = routed.completion;
    const cost = costNanoEur(usage, { model: routed.model, usdPerEur: tenant.limits.usdPerEur });
    await input.ledger.settle({
      now: Date.now(),
      reservationId: reservation.id,
      actualNanoEur: cost,
    });
    return {
      tenantId: tenant.id,
      status: 200,
      ...verdict(input, routed.completion),
      model: routed.model,
      attempts: routed.attempts,
      usage,
      costNanoEur: cost,
    };
  } catch (error) {
    if (error instanceof RoutingFailure) {
      return failed(input, reservation, error);
    }
    throw error;
  }
};
