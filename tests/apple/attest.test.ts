import { createHash, createSign } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AttestationInput, CborValue } from "../../src/authn/apple";
import {
  appIdHash,
  decodeCbor,
  encodeCbor,
  parseAuthenticatorData,
  sha256,
  verifyAssertion,
  verifyAttestation,
} from "../../src/authn/apple";
import { Buffer } from "../../src/authn/apple/buffer";
import type { TestChain, TestKey } from "./cert-fixture";
import { derToRaw, makeChain, makeP256 } from "./cert-fixture";

const TEAM = "ABCDE12345";
const BUNDLE = "com.example.app";
const PROD_AAGUID = Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)]);
const DEV_AAGUID = Buffer.from("appattestdevelop");
const CHALLENGE = Buffer.from("test-challenge-for-the-device-001");

interface AuthDataOptions {
  readonly counter: number;
  readonly key: TestKey;
  readonly attested: boolean;
  readonly aaguid?: Buffer | undefined;
  readonly flags?: number | undefined;
}

interface AttestOptions {
  readonly key: TestKey;
  readonly challenge: Buffer;
  readonly counter?: number;
  readonly aaguid?: Buffer;
  readonly nonceForm?: "tagged" | "bare";
}

interface Attested {
  readonly attestation: Buffer;
  readonly chain: TestChain;
  readonly credentialId: Buffer;
}

const coords = (key: TestKey): { x: Buffer; y: Buffer } => ({
  x: Buffer.from(key.jwk.x, "base64url"),
  y: Buffer.from(key.jwk.y, "base64url"),
});

const point = (key: TestKey): Buffer =>
  Buffer.concat([Buffer.from([0x04]), coords(key).x, coords(key).y]);

const coseKey = (key: TestKey): Buffer => {
  const { x, y } = coords(key);
  return encodeCbor(
    new Map<CborValue, CborValue>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, x],
      [-3, y],
    ]),
  );
};

const authData = (options: AuthDataOptions): Buffer => {
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(options.counter);
  const flags = options.flags ?? (options.attested ? 0x40 : 0x00);
  const head = Buffer.concat([appIdHash(TEAM, BUNDLE), Buffer.from([flags]), counterBuf]);
  if (!options.attested) {
    return head;
  }
  const credentialId = sha256(point(options.key));
  const length = Buffer.alloc(2);
  length.writeUInt16BE(credentialId.length);
  return Buffer.concat([
    head,
    options.aaguid ?? PROD_AAGUID,
    length,
    credentialId,
    coseKey(options.key),
  ]);
};

const nonceExtension = (nonce: Buffer, form: "tagged" | "bare"): string[] => [
  "1.2.840.113635.100.8.2=critical,ASN1:SEQUENCE:nonce_seq",
  "",
  "[nonce_seq]",
  `nonce=${form === "tagged" ? "EXPLICIT:1," : ""}FORMAT:HEX,OCTETSTRING:${nonce.toString("hex")}`,
];

const attestObject = (options: AttestOptions): Attested => {
  const { key, challenge, counter = 0, aaguid, nonceForm = "tagged" } = options;
  const authenticatorData = authData({ counter, key, attested: true, aaguid });
  const nonce = sha256(Buffer.concat([authenticatorData, sha256(challenge)]));
  const chain = makeChain({
    leafKeyPem: key.pem,
    leafExt: ["basicConstraints=CA:FALSE", ...nonceExtension(nonce, nonceForm)],
    intermediateExt: ["basicConstraints=critical,CA:TRUE"],
  });
  const attestation = encodeCbor(
    new Map<CborValue, CborValue>([
      ["fmt", "apple-appattest"],
      [
        "attStmt",
        new Map<CborValue, CborValue>([
          ["x5c", [chain.leafDer, chain.intermediateDer]],
          ["receipt", Buffer.from([0x30])],
        ]),
      ],
      ["authData", authenticatorData],
    ]),
  );
  return { attestation, chain, credentialId: sha256(point(key)) };
};

const inputFor = (attested: Attested, challenge: Buffer): AttestationInput => ({
  attestation: attested.attestation,
  challenge,
  keyId: attested.credentialId,
  teamId: TEAM,
  bundleId: BUNDLE,
  roots: [attested.chain.rootPem],
  now: Date.now(),
});

const unrelatedRoot = (): string =>
  makeChain({
    leafKeyPem: makeP256().pem,
    leafExt: ["basicConstraints=CA:FALSE"],
    intermediateExt: ["basicConstraints=critical,CA:TRUE"],
  }).rootPem;

describe("app attest attestation", () => {
  it("an attestation with the nonce and the app id is accepted", () => {
    const key = makeP256();
    const result = verifyAttestation(
      inputFor(attestObject({ key, challenge: CHALLENGE }), CHALLENGE),
    );
    expect(result).toEqual({
      ok: true,
      publicKey: { x: key.jwk.x, y: key.jwk.y },
      environment: "production",
      counter: 0,
    });
  });

  it("an attestation whose nonce is not [1]-tagged is accepted too", () => {
    const key = makeP256();
    const attested = attestObject({ key, challenge: CHALLENGE, nonceForm: "bare" });
    expect(verifyAttestation(inputFor(attested, CHALLENGE)).ok).toBe(true);
  });

  it("an attestation from an Xcode build is marked development", () => {
    const key = makeP256();
    const attested = attestObject({ key, challenge: CHALLENGE, aaguid: DEV_AAGUID });
    const result = verifyAttestation(inputFor(attested, CHALLENGE));
    expect(result).toMatchObject({ ok: true, environment: "development" });
  });

  it("a different challenge, app id, or key id is rejected", () => {
    const key = makeP256();
    const common = inputFor(attestObject({ key, challenge: CHALLENGE }), CHALLENGE);
    expect(verifyAttestation({ ...common, challenge: Buffer.from("other-challenge") })).toEqual({
      ok: false,
      error: "bad_challenge",
    });
    expect(verifyAttestation({ ...common, bundleId: "com.example.other" })).toEqual({
      ok: false,
      error: "bad_app",
    });
    expect(verifyAttestation({ ...common, teamId: "ZZZZZ99999" })).toEqual({
      ok: false,
      error: "bad_app",
    });
    expect(verifyAttestation({ ...common, keyId: Buffer.alloc(32, 9) })).toEqual({
      ok: false,
      error: "bad_key",
    });
    expect(verifyAttestation({ ...common, roots: [unrelatedRoot()] })).toEqual({
      ok: false,
      error: "bad_attestation",
    });
  });

  it("an attestation counter other than zero is rejected", () => {
    const key = makeP256();
    const attested = attestObject({ key, challenge: CHALLENGE, counter: 4 });
    expect(verifyAttestation(inputFor(attested, CHALLENGE))).toEqual({
      ok: false,
      error: "bad_attestation",
    });
  });

  it("an unknown aaguid is rejected", () => {
    const key = makeP256();
    const attested = attestObject({ key, challenge: CHALLENGE, aaguid: Buffer.alloc(16, 1) });
    expect(verifyAttestation(inputFor(attested, CHALLENGE))).toEqual({
      ok: false,
      error: "bad_attestation",
    });
  });

  it("missing roots are unconfigured and an empty list trusts nothing", () => {
    const key = makeP256();
    const common = inputFor(attestObject({ key, challenge: CHALLENGE }), CHALLENGE);
    expect(verifyAttestation({ ...common, roots: null })).toEqual({
      ok: false,
      error: "unconfigured",
    });
    expect(verifyAttestation({ ...common, roots: [] })).toEqual({
      ok: false,
      error: "bad_attestation",
    });
  });

  it("an expired certificate chain is rejected", () => {
    const key = makeP256();
    const common = inputFor(attestObject({ key, challenge: CHALLENGE }), CHALLENGE);
    const later = Date.now() + 60 * 24 * 60 * 60 * 1000;
    expect(verifyAttestation({ ...common, now: later })).toEqual({
      ok: false,
      error: "bad_attestation",
    });
  });

  it("bytes that are not an attestation object are rejected", () => {
    const key = makeP256();
    const common = inputFor(attestObject({ key, challenge: CHALLENGE }), CHALLENGE);
    const wrongFormat = encodeCbor(new Map<CborValue, CborValue>([["fmt", "packed"]]));
    for (const attestation of [Buffer.from("not cbor"), encodeCbor([1, 2]), wrongFormat]) {
      expect(verifyAttestation({ ...common, attestation })).toEqual({
        ok: false,
        error: "bad_attestation",
      });
    }
  });

  it("authenticator data is parsed with and without an attested credential", () => {
    const key = makeP256();
    const plain = parseAuthenticatorData(authData({ counter: 7, key, attested: false }));
    expect(plain).toEqual({ rpIdHash: appIdHash(TEAM, BUNDLE), flags: 0, counter: 7 });
    const attested = parseAuthenticatorData(authData({ counter: 0, key, attested: true }));
    expect(attested?.credentialId).toEqual(sha256(point(key)));
    expect(attested?.aaguid).toEqual(PROD_AAGUID);
    expect(attested?.cose?.get(-2)).toEqual(coords(key).x);
    expect(parseAuthenticatorData(Buffer.alloc(36))).toBeNull();
  });
});

interface AssertionOptions {
  readonly counter: number;
  readonly clientData: Buffer;
  readonly authenticatorData?: Buffer;
}

const assertionFor = (key: TestKey, options: AssertionOptions): Buffer => {
  const authenticatorData =
    options.authenticatorData ?? authData({ counter: options.counter, key, attested: false });
  const signer = createSign("SHA256");
  signer.update(sha256(Buffer.concat([authenticatorData, sha256(options.clientData)])));
  signer.end();
  return encodeCbor(
    new Map<CborValue, CborValue>([
      ["signature", signer.sign(key.privateKey)],
      ["authenticatorData", authenticatorData],
    ]),
  );
};

const signatureOf = (assertion: Buffer): Buffer => {
  const decoded = decodeCbor(assertion);
  const signature = decoded instanceof Map ? decoded.get("signature") : undefined;
  if (!Buffer.isBuffer(signature)) {
    throw new Error("assertion has no signature");
  }
  return signature;
};

describe("app attest assertion", () => {
  it("an assertion is accepted once and a replay or a different body is rejected", () => {
    const key = makeP256();
    const clientData = Buffer.from('{"contractVersion":1}\na.b.c');
    const assertion = assertionFor(key, { counter: 1, clientData });
    const common = { assertion, publicKey: key.jwk, teamId: TEAM, bundleId: BUNDLE };

    expect(verifyAssertion({ ...common, clientData, counter: 0 })).toEqual({
      ok: true,
      counter: 1,
    });
    expect(verifyAssertion({ ...common, clientData, counter: 1 })).toEqual({
      ok: false,
      error: "replay",
    });
    const other = Buffer.from('{"contractVersion":1}\nother.jws');
    expect(verifyAssertion({ ...common, clientData: other, counter: 0 })).toEqual({
      ok: false,
      error: "bad_signature",
    });
    expect(
      verifyAssertion({ ...common, clientData, counter: 0, bundleId: "com.example.other" }),
    ).toEqual({ ok: false, error: "bad_app" });
  });

  it("an assertion verifies from the hash of the client data alone", () => {
    const key = makeP256();
    const clientData = Buffer.from("body");
    const assertion = assertionFor(key, { counter: 3, clientData });
    const common = { assertion, publicKey: key.jwk, counter: 2, teamId: TEAM, bundleId: BUNDLE };
    expect(verifyAssertion({ ...common, clientDataHash: sha256(clientData) })).toEqual({
      ok: true,
      counter: 3,
    });
    expect(verifyAssertion({ ...common, clientDataHash: Buffer.alloc(32) })).toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  it("a real device's longer authenticator data (flags 0xc0) is covered by the signature", () => {
    const key = makeP256();
    const clientData = Buffer.from("body");
    const head = authData({ counter: 5, key, attested: false, flags: 0xc0 });
    const authenticatorData = Buffer.concat([head, Buffer.from("extension bytes after counter")]);
    const assertion = assertionFor(key, { counter: 5, clientData, authenticatorData });
    const common = { publicKey: key.jwk, counter: 4, teamId: TEAM, bundleId: BUNDLE, clientData };
    expect(verifyAssertion({ ...common, assertion })).toEqual({ ok: true, counter: 5 });

    const shortened = encodeCbor(
      new Map<CborValue, CborValue>([
        ["signature", signatureOf(assertion)],
        ["authenticatorData", head],
      ]),
    );
    expect(verifyAssertion({ ...common, assertion: shortened })).toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  it("a signature over the wrong hash does not verify", () => {
    const key = makeP256();
    const authenticatorData = authData({ counter: 2, key, attested: false });
    const signer = createSign("SHA256");
    signer.update(createHash("sha256").update(Buffer.from("not-the-body")).digest());
    signer.end();
    const assertion = encodeCbor(
      new Map<CborValue, CborValue>([
        ["signature", signer.sign(key.privateKey)],
        ["authenticatorData", authenticatorData],
      ]),
    );
    const result = verifyAssertion({
      assertion,
      clientData: Buffer.from("body"),
      publicKey: key.jwk,
      counter: 0,
      teamId: TEAM,
      bundleId: BUNDLE,
    });
    expect(result).toEqual({ ok: false, error: "bad_signature" });
  });

  it("a signature made directly over the nonce digest does not verify", () => {
    const key = makeP256();
    const clientData = Buffer.from("body");
    const authenticatorData = authData({ counter: 2, key, attested: false });
    const signer = createSign("SHA256");
    signer.update(Buffer.concat([authenticatorData, sha256(clientData)]));
    signer.end();
    const assertion = encodeCbor(
      new Map<CborValue, CborValue>([
        ["signature", signer.sign(key.privateKey)],
        ["authenticatorData", authenticatorData],
      ]),
    );
    const common = { clientData, publicKey: key.jwk, counter: 0, teamId: TEAM, bundleId: BUNDLE };
    expect(verifyAssertion({ ...common, assertion })).toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  it("another key, a bad counter, a bad key and malformed bytes are rejected", () => {
    const key = makeP256();
    const clientData = Buffer.from("body");
    const assertion = assertionFor(key, { counter: 1, clientData });
    const common = { assertion, clientData, teamId: TEAM, bundleId: BUNDLE };
    expect(verifyAssertion({ ...common, publicKey: makeP256().jwk, counter: 0 })).toEqual({
      ok: false,
      error: "bad_signature",
    });
    expect(verifyAssertion({ ...common, publicKey: key.jwk, counter: -1 })).toEqual({
      ok: false,
      error: "bad_assertion",
    });
    expect(verifyAssertion({ ...common, publicKey: key.jwk, counter: 0.5 })).toEqual({
      ok: false,
      error: "bad_assertion",
    });
    expect(verifyAssertion({ ...common, publicKey: { x: "AA", y: "AA" }, counter: 0 })).toEqual({
      ok: false,
      error: "bad_key",
    });
    const garbage = Buffer.from("not cbor");
    expect(
      verifyAssertion({ ...common, assertion: garbage, publicKey: key.jwk, counter: 0 }),
    ).toEqual({ ok: false, error: "bad_assertion" });
  });

  it("der signatures convert to the 64-byte form StoreKit uses", () => {
    const key = makeP256();
    const signer = createSign("SHA256");
    signer.update("header.payload");
    signer.end();
    expect(derToRaw(signer.sign(key.privateKey))).toHaveLength(64);
  });
});
