import { describe, expect, it } from "vitest";

import { ask, createTenant, poolOf, providerCalls, runtimeUrl } from "./support/client.ts";

const ANSWER_COST_NANO_EUR = Math.round((40 * 100 + 25 * 500 + 5000 * 10) / 1.08);

describe("quota", () => {
  it("settles an answered run at the real token cost", async () => {
    const tenant = await createTenant();
    expect((await ask(tenant, "What does Lumen export?")).status).toBe(200);
    const pool = await poolOf(tenant);
    expect(pool.spentNanoEur).toBe(ANSWER_COST_NANO_EUR);
    expect(pool.reservedNanoEur).toBe(0);
  });

  it("stops a network at its hourly limit without calling the provider", async () => {
    const tenant = await createTenant({ limits: { ipPerHour: 2 } });
    expect((await ask(tenant, "LIMIT one")).status).toBe(200);
    expect((await ask(tenant, "LIMIT two")).status).toBe(200);
    const refused = await ask(tenant, "LIMIT three");
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as {
      error: string;
      message: string;
      retryAfterSeconds: number;
    };
    expect(body.error).toBe("ip_hour");
    expect(body.message).toContain("Try again later");
    expect(Number(refused.headers.get("retry-after"))).toBe(body.retryAfterSeconds);
    expect(body.retryAfterSeconds).toBeGreaterThan(3500);
    const calls = (await providerCalls()).filter((call) => call.question.startsWith("LIMIT"));
    expect(calls.map((call) => call.question)).toEqual(["LIMIT one", "LIMIT two"]);
  });

  it("pauses a tenant whose monthly pool cannot cover the next run", async () => {
    const tenant = await createTenant({ limits: { poolEurPerMonth: 0.000001 } });
    const refused = await ask(tenant, "POOL question");
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: string }).error).toBe("budget");
    const status = await fetch(`${runtimeUrl()}/v1/tenants/${tenant}/status`);
    expect(await status.json()).toEqual({ accepting: true });
    expect((await providerCalls()).some((call) => call.question.startsWith("POOL"))).toBe(false);
  });

  it("reports a tenant as accepting while its pool has room", async () => {
    const tenant = await createTenant();
    const status = await fetch(`${runtimeUrl()}/v1/tenants/${tenant}/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ accepting: true });
  });

  it("keeps tenants apart: one tenant's limit never touches another", async () => {
    const tight = await createTenant({ limits: { ipPerHour: 1 } });
    const roomy = await createTenant();
    expect((await ask(tight, "first")).status).toBe(200);
    expect((await ask(tight, "second")).status).toBe(429);
    expect((await ask(roomy, "first")).status).toBe(200);
  });
});
