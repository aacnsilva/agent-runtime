import type { Env } from "../env";

export interface RequestContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  abort: AbortController;
  requestId: string;
  startedAt: number;
}
