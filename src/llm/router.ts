import type { Breaker } from "./breaker";
import type { Candidates, ModelId } from "./catalog";
import type { ModelReply } from "./provider";

export interface Routed {
  reply: ModelReply;
  model: ModelId;
  attempts: number;
}

export interface RoutingFailureDetail {
  model: ModelId;
  attempts: number;
  billable: boolean;
}

export class RoutingFailure extends Error {
  readonly detail: RoutingFailureDetail;

  constructor(detail: RoutingFailureDetail) {
    super("routing_failed");
    this.detail = detail;
  }
}

export interface RouteOptions {
  candidates: Candidates;
  breaker: Breaker;
  call: (model: ModelId) => Promise<ModelReply>;
  isBillable: (error: unknown) => boolean;
}

export const routeWithFallback = async (options: RouteOptions): Promise<Routed> => {
  const { breaker } = options;
  const ordered = breaker.order(options.candidates, Date.now());
  let attempts = 0;
  let last: RoutingFailureDetail = { model: ordered[0], attempts, billable: false };
  for (const model of ordered) {
    attempts += 1;
    try {
      const reply = await options.call(model);
      breaker.succeeded(model);
      return { reply, model, attempts };
    } catch (cause) {
      breaker.failed(model, Date.now());
      last = { model, attempts, billable: options.isBillable(cause) };
      if (last.billable) {
        break;
      }
    }
  }
  throw new RoutingFailure(last);
};
