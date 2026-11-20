import type { ModelId } from "./catalog";
import type { Completion } from "./provider";

export interface Routed {
  completion: Completion;
  model: ModelId;
  attempts: number;
}

export interface RoutingFailureDetail {
  model: ModelId;
  attempts: number;
  billable: boolean;
  cause: unknown;
}

export class RoutingFailure extends Error {
  readonly detail: RoutingFailureDetail;

  constructor(detail: RoutingFailureDetail) {
    super("routing_failed");
    this.detail = detail;
  }
}

export interface RouteOptions {
  candidates: readonly [ModelId, ...ModelId[]];
  call: (model: ModelId) => Promise<Completion>;
  isBillable: (error: unknown) => boolean;
}

export const routeWithFallback = async (options: RouteOptions): Promise<Routed> => {
  let attempts = 0;
  let last: RoutingFailureDetail | undefined;
  for (const model of options.candidates) {
    attempts += 1;
    try {
      return { completion: await options.call(model), model, attempts };
    } catch (cause) {
      last = { model, attempts, billable: options.isBillable(cause), cause };
      if (last.billable) {
        break;
      }
    }
  }
  throw new RoutingFailure(
    last ?? { model: options.candidates[0], attempts, billable: false, cause: undefined },
  );
};
