import { X509Certificate } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  APP_ATTEST_ROOT_FINGERPRINTS,
  APP_ATTEST_ROOT_PEMS,
  APP_ATTEST_ROOT_SHA256,
  APPLE_APP_ATTEST_ROOT_PEM,
  APPLE_ROOT_CA_G2_PEM,
  APPLE_ROOT_CA_G3_PEM,
  APPLE_ROOT_G2_SHA256,
  APPLE_ROOT_G3_SHA256,
  certificateFromPem,
  pinnedRoots,
  STOREKIT_ROOT_FINGERPRINTS,
  STOREKIT_ROOT_PEMS,
} from "../../src/authn/apple";

describe("apple roots", () => {
  it("the embedded Apple roots match their pinned fingerprints", () => {
    expect(new X509Certificate(APPLE_APP_ATTEST_ROOT_PEM).fingerprint256).toBe(
      APP_ATTEST_ROOT_SHA256,
    );
    expect(new X509Certificate(APPLE_ROOT_CA_G3_PEM).fingerprint256).toBe(APPLE_ROOT_G3_SHA256);
    expect(new X509Certificate(APPLE_ROOT_CA_G2_PEM).fingerprint256).toBe(APPLE_ROOT_G2_SHA256);
  });

  it("the embedded roots are Apple's self-signed certificate authorities", () => {
    expect(certificateFromPem(APPLE_APP_ATTEST_ROOT_PEM).subject).toContain(
      "Apple App Attestation Root CA",
    );
    expect(certificateFromPem(APPLE_ROOT_CA_G3_PEM).subject).toContain("Apple Root CA - G3");
    expect(certificateFromPem(APPLE_ROOT_CA_G2_PEM).subject).toContain("Apple Root CA - G2");
    for (const pem of [...APP_ATTEST_ROOT_PEMS, ...STOREKIT_ROOT_PEMS]) {
      const root = certificateFromPem(pem);
      expect(root.issuer).toBe(root.subject);
      expect(root.verify(root.publicKey)).toBe(true);
    }
  });

  it("pins roots to the allowed fingerprints", () => {
    expect(pinnedRoots(APP_ATTEST_ROOT_PEMS, APP_ATTEST_ROOT_FINGERPRINTS)).toHaveLength(1);
    expect(pinnedRoots(STOREKIT_ROOT_PEMS, STOREKIT_ROOT_FINGERPRINTS)).toHaveLength(2);
    expect(pinnedRoots(STOREKIT_ROOT_PEMS, APP_ATTEST_ROOT_FINGERPRINTS)).toBeNull();
    expect(pinnedRoots([], APP_ATTEST_ROOT_FINGERPRINTS)).toBeNull();
    expect(pinnedRoots(null, APP_ATTEST_ROOT_FINGERPRINTS)).toBeNull();
  });
});
