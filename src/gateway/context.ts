import type { Env } from "../env";

export interface RequestContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  requestId: string;
  startedAt: number;
}
