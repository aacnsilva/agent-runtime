import { describe, expect, it } from "vitest";

import demo from "../examples/tenants/demo.tenant.json" with { type: "json" };
import { tenantSchema } from "../src/tenants/schema";

describe("tenant schema", () => {
  it("accepts the example tenant", () => {
    expect(tenantSchema.safeParse(demo).success).toBe(true);
  });

  it.each([
    ["an id with capitals", { id: "Demo" }],
    ["a pool above the hard ceiling", { limits: { ...demo.limits, poolEurPerMonth: 5001 } }],
    ["a network limit of zero", { limits: { ...demo.limits, ipPerHour: 0 } }],
    ["an origin that is not a URL", { authn: { kind: "anonymous", allowedOrigins: ["nope"] } }],
    ["an unknown authenticator", { authn: { kind: "magic", allowedOrigins: [] } }],
  ])("refuses %s", (_name, overrides) => {
    expect(tenantSchema.safeParse({ ...demo, ...overrides }).success).toBe(false);
  });

  it("refuses a locale pattern that is not a regular expression", () => {
    const gate = { ...demo.agent.gate, locales: [{ pattern: "(", refusal: "x", unreadable: "y" }] };
    const broken = { ...demo, agent: { ...demo.agent, gate } };
    expect(tenantSchema.safeParse(broken).success).toBe(false);
  });
});
