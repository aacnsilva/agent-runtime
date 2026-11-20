import { GateStream } from "../agent/gate-stream";
import type { RunInput, RunResult } from "../agent/run";
import { answer, reserve } from "../agent/run";
import { corsHeaders, withHeaders } from "../http/cors";
import { json, Rejection, rejectionResponse } from "../http/respond";
import { createAnthropicProvider } from "../llm/anthropic";
import { NO_USAGE } from "../llm/cost";
import type { RunEvent } from "../observability/events";
import { recordRun } from "../observability/record";
import { loadTenant } from "../tenants/registry";
import type { Tenant } from "../tenants/schema";
import type { RequestContext } from "./context";
import { parseConversation } from "./conversation";

const UNCONFIGURED_MESSAGE = "The answer service is not configured yet.";

interface Delivery {
  streamed: boolean;
  ttftMs: number | null;
}

const baseEvent = (context: RequestContext, tenantId: string, streamed: boolean): RunEvent => ({
  at: context.startedAt,
  tenant: tenantId,
  requestId: context.requestId,
  outcome: "",
  status: 0,
  streamed,
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

const recordResult = (context: RequestContext, run: RunResult, delivery: Delivery): void => {
  recordRun(context.env, context.ctx, {
    ...baseEvent(context, run.tenantId, delivery.streamed),
    outcome: run.outcome,
    status: run.status,
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

const wantsStream = (request: Request): boolean =>
  (request.headers.get("Accept") ?? "").includes("text/event-stream");

const assertOrigin = (request: Request, tenant: Tenant): void => {
  const origin = request.headers.get("Origin");
  if (origin !== null && !tenant.authn.allowedOrigins.includes(origin)) {
    throw new Rejection(403, "origin");
  }
};

const prepare = async (context: RequestContext, tenant: Tenant): Promise<RunInput> => {
  const { request, env } = context;
  assertOrigin(request, tenant);
  if (env.ANTHROPIC_API_KEY === undefined || env.ANTHROPIC_API_KEY === "") {
    throw new Rejection(503, "unconfigured", { message: UNCONFIGURED_MESSAGE });
  }
  const messages = parseConversation(await request.text(), tenant.agent.input);
  return {
    tenant,
    messages,
    ip: request.headers.get("CF-Connecting-IP") ?? "unknown",
    provider: createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: env.ANTHROPIC_BASE_URL,
    }),
    ledger: env.LEDGER.get(env.LEDGER.idFromName(`pool:${tenant.id}`)),
  };
};

const sseHeaders = (): Headers => {
  const headers = new Headers();
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-store");
  return headers;
};

const streamAnswer = (
  context: RequestContext,
  input: RunInput,
  reservation: Awaited<ReturnType<typeof reserve>>,
): Response => {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const gate = new GateStream();
  const delivery: Delivery = { streamed: true, ttftMs: null };
  const send = async (event: Record<string, unknown>): Promise<void> => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => undefined);
  };
  const onText = (text: string): void => {
    const piece = gate.push(text);
    if (piece === "") {
      return;
    }
    delivery.ttftMs ??= Date.now() - context.startedAt;
    void send({ type: "delta", text: piece });
  };
  const work = async (): Promise<void> => {
    const run = await answer(input, reservation, onText);
    await send({ type: run.status === 200 ? "done" : "error", ...run.body });
    await writer.close().catch(() => undefined);
    recordResult(context, run, delivery);
  };
  context.ctx.waitUntil(work());
  return new Response(readable, { status: 200, headers: sseHeaders() });
};

const respond = async (context: RequestContext, tenant: Tenant): Promise<Response> => {
  const input = await prepare(context, tenant);
  const reservation = await reserve(input);
  if (wantsStream(context.request)) {
    return streamAnswer(context, input, reservation);
  }
  const run = await answer(input, reservation, undefined);
  recordResult(context, run, { streamed: false, ttftMs: null });
  return json(run.body, run.status);
};

const rejected = (context: RequestContext, tenant: Tenant, rejection: Rejection): Response => {
  recordRun(context.env, context.ctx, {
    ...baseEvent(context, tenant.id, false),
    outcome: rejection.code,
    status: rejection.status,
  });
  const response = rejectionResponse(rejection);
  return rejection.code === "origin"
    ? response
    : withHeaders(response, corsHeaders(context.request, tenant.authn.allowedOrigins));
};

export const handleRun = async (context: RequestContext, tenantId: string): Promise<Response> => {
  const tenant = await loadTenant(context.env, tenantId);
  if (tenant === null) {
    return json({ error: "not_found" }, 404);
  }
  try {
    const response = await respond(context, tenant);
    return withHeaders(response, corsHeaders(context.request, tenant.authn.allowedOrigins));
  } catch (error) {
    if (error instanceof Rejection) {
      return rejected(context, tenant, error);
    }
    throw error;
  }
};
