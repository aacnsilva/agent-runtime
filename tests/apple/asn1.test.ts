import { describe, expect, it } from "vitest";

import { AppleFormatError } from "../../src/authn/apple";
import {
  derContainsOid,
  extensionValue,
  octetStringInsideSequence,
  readDer,
} from "../../src/authn/apple/asn1";
import { Buffer } from "../../src/authn/apple/buffer";

const OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);
const NONCE = Buffer.alloc(32, 0xab);

const tlv = (tag: number, body: Buffer): Buffer =>
  Buffer.concat([Buffer.from([tag, body.length]), body]);

const tagged = tlv(0x30, tlv(0xa1, tlv(0x04, NONCE)));
const bare = tlv(0x30, tlv(0x04, NONCE));

const extension = (critical: boolean, value: Buffer): Buffer =>
  tlv(
    0x30,
    Buffer.concat([
      tlv(0x06, OID),
      critical ? Buffer.from([0x01, 0x01, 0xff]) : Buffer.alloc(0),
      tlv(0x04, value),
    ]),
  );

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof AppleFormatError ? error.code : "other";
  }
  return "none";
};

describe("asn1", () => {
  it("reads the nonce from the [1]-tagged field a real device sends", () => {
    expect(octetStringInsideSequence(tagged)).toEqual(NONCE);
  });

  it("reads the bare SEQUENCE { OCTET STRING } form too", () => {
    expect(octetStringInsideSequence(bare)).toEqual(NONCE);
  });

  it("returns null when the nonce is not an octet string inside a sequence", () => {
    expect(octetStringInsideSequence(tlv(0x04, NONCE))).toBeNull();
    expect(octetStringInsideSequence(tlv(0x30, tlv(0x02, NONCE)))).toBeNull();
    expect(octetStringInsideSequence(tlv(0x30, tlv(0xa1, tlv(0x02, NONCE))))).toBeNull();
  });

  it("finds an extension value with and without the critical flag", () => {
    const padding = Buffer.from([0x30, 0x03, 0x02, 0x01, 0x05]);
    expect(extensionValue(Buffer.concat([padding, extension(true, tagged)]), OID)).toEqual(tagged);
    expect(extensionValue(Buffer.concat([padding, extension(false, tagged)]), OID)).toEqual(tagged);
    expect(extensionValue(padding, OID)).toBeNull();
    expect(derContainsOid(extension(true, tagged), OID)).toBe(true);
    expect(derContainsOid(padding, OID)).toBe(false);
  });

  it("skips an occurrence of the OID that no octet string follows", () => {
    const decoy = Buffer.concat([tlv(0x06, OID), Buffer.from([0x05, 0x00])]);
    expect(extensionValue(Buffer.concat([decoy, extension(true, bare)]), OID)).toEqual(bare);
    expect(extensionValue(decoy, OID)).toBeNull();
  });

  it("reads long-form lengths and rejects truncated input with a stable code", () => {
    const body = Buffer.alloc(300, 1);
    const long = Buffer.concat([Buffer.from([0x04, 0x82, 0x01, 0x2c]), body]);
    expect(readDer(long, 0)).toEqual({ tag: 0x04, value: body, offset: 304 });
    expect(codeOf(() => readDer(long.subarray(0, 100), 0))).toBe("der_truncated");
    expect(codeOf(() => readDer(Buffer.from([0x04]), 0))).toBe("der_truncated");
    expect(codeOf(() => readDer(Buffer.from([0x04, 0x80]), 0))).toBe("der_length");
    expect(codeOf(() => readDer(Buffer.from([0x04, 0x84, 0, 0, 0, 1, 0]), 0))).toBe("der_length");
  });
});
