import type { ModelId } from "../llm/catalog";
import type { Usage } from "../llm/cost";
import { NO_USAGE } from "../llm/cost";
import type { RunEvent } from "../observability/events";
import { recordRun } from "../observability/record";
import type { RequestContext } from "./context";

export interface Finished {
  status: number;
  outcome: string;
  body: Record<string, unknown>;
  model: ModelId | null;
  attempts: number;
  usage: Usage;
  costNanoEur: number;
}

export interface Delivery {
  streamed: boolean;
  ttftMs: number | null;
}

const baseEvent = (context: RequestContext, tenantId: string): RunEvent => ({
  at: context.startedAt,
  tenant: tenantId,
  requestId: context.requestId,
  outcome: "",
  status: 0,
  streamed: false,
  model: null,
  attempts: 0,
  latencyMs: Date.now() - context.startedAt,
  ttftMs: null,
  inputTokens: NO_USAGE.input,
  outputTokens: NO_USAGE.output,
  cacheReadTokens: NO_USAGE.cacheRead,
  cacheWriteTokens: NO_USAGE.cacheWrite,
  costNanoEur: 0,
});

export interface Recorded {
  context: RequestContext;
  tenantId: string;
  run: Finished;
  delivery: Delivery;
}

export const recordFinished = ({ context, tenantId, run, delivery }: Recorded): void => {
  recordRun(context.env, context.ctx, {
    ...baseEvent(context, tenantId),
    outcome: run.outcome,
    status: run.status,
    streamed: delivery.streamed,
    model: run.model,
    attempts: run.attempts,
    ttftMs: delivery.ttftMs,
    inputTokens: run.usage.input,
    outputTokens: run.usage.output,
    cacheReadTokens: run.usage.cacheRead,
    cacheWriteTokens: run.usage.cacheWrite,
    costNanoEur: run.costNanoEur,
  });
};

export const recordRejected = (
  context: RequestContext,
  tenantId: string,
  rejection: { code: string; status: number },
): void => {
  recordRun(context.env, context.ctx, {
    ...baseEvent(context, tenantId),
    outcome: rejection.code,
    status: rejection.status,
  });
};
