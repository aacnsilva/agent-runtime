import { Rejection } from "../http/respond";
import type { Tenant } from "../tenants/schema";
import type { Principal } from "./principal";

const RUN_ID = /^[A-Za-z0-9._-]{1,80}$/;
const MIN_SECRET_CHARS = 32;

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (text: string): Promise<ArrayBuffer> =>
  crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

const matches = async (shown: string, expectedSha256: string): Promise<boolean> => {
  if (shown.length < MIN_SECRET_CHARS) {
    return false;
  }
  const presented = await sha256(hex(await sha256(shown)));
  return crypto.subtle.timingSafeEqual(presented, await sha256(expectedSha256));
};

const chosen = <T extends string>(allowed: readonly T[], requested: string | null): T | null =>
  allowed.find((option) => option === requested) ?? null;

type Evals = NonNullable<Tenant["evals"]>;

const runOf = async (request: Request, evals: Evals, shown: string): Promise<string> => {
  if (!(await matches(shown, evals.secretSha256))) {
    throw new Rejection(401, "bad_eval_secret");
  }
  const run = request.headers.get("X-Eval-Run") ?? "";
  if (!RUN_ID.test(run)) {
    throw new Rejection(400, "missing_eval_run");
  }
  return run;
};

export const evalPrincipal = async (
  request: Request,
  tenant: Tenant,
): Promise<Principal | null> => {
  const shown = request.headers.get("X-Eval-Secret");
  const { evals } = tenant;
  if (shown === null || evals === undefined) {
    return null;
  }
  const run = await runOf(request, evals, shown);
  const plan = evals.plan === undefined ? undefined : tenant.plans[evals.plan];
  const tier = chosen(evals.tiers, request.headers.get("X-Eval-Tier"));
  return {
    subjectId: `eval-${run}`,
    planId: evals.plan ?? null,
    messagesPerMonth: plan?.messagesPerMonth ?? null,
    tier: tier ?? plan?.tier ?? tenant.agent.tier,
    authenticated: true,
    evaluated: true,
    effortOverride: chosen(evals.efforts, request.headers.get("X-Eval-Effort")),
  };
};
