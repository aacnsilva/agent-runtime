import { describe, expect, it } from "vitest";

import {
  verifyAppTransaction,
  verifyAssertion,
  verifyAttestation,
  verifyTransaction,
} from "../../src/authn/apple";
import { Buffer } from "../../src/authn/apple/buffer";
import { createFakeDevice, createFakeStore } from "./device-fixture";

const TEAM = "ABCDE12345";
const BUNDLE = "com.example.app";
const ENVIRONMENTS = ["Production", "Sandbox"];

const attested = (development: boolean) => {
  const device = createFakeDevice({ teamId: TEAM, bundleId: BUNDLE, development });
  const challenge = Buffer.from("fixture-challenge");
  const result = verifyAttestation({
    attestation: Buffer.from(device.attest(challenge), "base64"),
    challenge,
    keyId: Buffer.from(device.keyId, "base64"),
    teamId: TEAM,
    bundleId: BUNDLE,
    roots: [device.rootPem],
  });
  if (!result.ok) {
    throw new Error(`attestation rejected: ${result.error}`);
  }
  return { device, result };
};

describe("fake device", () => {
  it("attests, then asserts with a counter that rises by one from 1", () => {
    const { device, result } = attested(false);
    expect(result.environment).toBe("production");
    expect(Buffer.from(device.keyId, "base64")).toHaveLength(32);

    const common = { publicKey: result.publicKey, teamId: TEAM, bundleId: BUNDLE };
    const firstBody = Buffer.from("first request");
    const first = verifyAssertion({
      ...common,
      assertion: Buffer.from(device.assert(firstBody), "base64"),
      clientData: firstBody,
      counter: result.counter,
    });
    expect(first).toEqual({ ok: true, counter: 1 });

    const secondBody = Buffer.from("second request");
    const secondAssertion = Buffer.from(device.assert(secondBody), "base64");
    const second = verifyAssertion({
      ...common,
      assertion: secondAssertion,
      clientData: secondBody,
      counter: first.ok ? first.counter : -1,
    });
    expect(second).toEqual({ ok: true, counter: 2 });
    expect(
      verifyAssertion({
        ...common,
        assertion: secondAssertion,
        clientData: secondBody,
        counter: 2,
      }),
    ).toEqual({ ok: false, error: "replay" });
  });

  it("a development device is marked development and can attest twice", () => {
    const { device, result } = attested(true);
    expect(result.environment).toBe("development");
    const challenge = Buffer.from("another-challenge");
    const again = verifyAttestation({
      attestation: Buffer.from(device.attest(challenge), "base64"),
      challenge,
      keyId: Buffer.from(device.keyId, "base64"),
      teamId: TEAM,
      bundleId: BUNDLE,
      roots: [device.rootPem],
    });
    expect(again).toMatchObject({ ok: true, publicKey: result.publicKey });
  });

  it("is rejected for another app or another device's root", () => {
    const device = createFakeDevice({ teamId: TEAM, bundleId: BUNDLE });
    const challenge = Buffer.from("fixture-challenge");
    const input = {
      attestation: Buffer.from(device.attest(challenge), "base64"),
      challenge,
      keyId: Buffer.from(device.keyId, "base64"),
      teamId: TEAM,
      bundleId: BUNDLE,
      roots: [device.rootPem],
    };
    expect(verifyAttestation({ ...input, bundleId: "com.example.other" })).toEqual({
      ok: false,
      error: "bad_app",
    });
    const other = createFakeDevice({ teamId: TEAM, bundleId: BUNDLE });
    expect(verifyAttestation({ ...input, roots: [other.rootPem] })).toEqual({
      ok: false,
      error: "bad_attestation",
    });
  });
});

describe("fake store", () => {
  it("signs an active subscription transaction", () => {
    const store = createFakeStore({ bundleId: BUNDLE });
    const input = {
      bundleId: BUNDLE,
      productIds: ["example.plan.monthly"],
      environments: ENVIRONMENTS,
      roots: [store.rootPem],
    };
    const first = verifyTransaction({ ...input, jws: store.transaction() });
    expect(first).toMatchObject({ ok: true, environment: "Production" });
    const second = verifyTransaction({ ...input, jws: store.transaction() });
    expect(second).toEqual(expect.objectContaining({ ok: true }));
    expect(first.ok && second.ok && first.originalTransactionId).toBe(
      second.ok && second.originalTransactionId,
    );
    const otherStore = createFakeStore({ bundleId: BUNDLE });
    const other = verifyTransaction({
      ...input,
      roots: [otherStore.rootPem],
      jws: otherStore.transaction(),
    });
    expect(
      other.ok && first.ok && other.originalTransactionId !== first.originalTransactionId,
    ).toBe(true);
  });

  it("applies overrides to a transaction", () => {
    const store = createFakeStore({ bundleId: BUNDLE });
    const input = {
      bundleId: BUNDLE,
      productIds: ["example.plan.monthly"],
      environments: ENVIRONMENTS,
      roots: [store.rootPem],
    };
    const expired = store.transaction({ expiresDate: Date.now() - 60_000 });
    expect(verifyTransaction({ ...input, jws: expired })).toMatchObject({
      ok: false,
      error: "entitlement_inactive",
    });
    const sandbox = store.transaction({ environment: "Sandbox", originalTransactionId: "42" });
    expect(verifyTransaction({ ...input, jws: sandbox })).toMatchObject({
      ok: true,
      environment: "Sandbox",
      originalTransactionId: "42",
    });
  });

  it("signs an AppTransaction", () => {
    const store = createFakeStore({ bundleId: BUNDLE });
    const input = { bundleId: BUNDLE, environments: ENVIRONMENTS, roots: [store.rootPem] };
    const result = verifyAppTransaction({ ...input, jws: store.appTransaction() });
    expect(result).toMatchObject({ ok: true, environment: "Sandbox" });
    expect(result.ok && result.appTransactionId).toMatch(/^[0-9]{14}$/);
    const unnamed = store.appTransaction({ appTransactionId: undefined });
    expect(verifyAppTransaction({ ...input, jws: unnamed })).toEqual({
      ok: true,
      appTransactionId: null,
      environment: "Sandbox",
    });
  });
});
