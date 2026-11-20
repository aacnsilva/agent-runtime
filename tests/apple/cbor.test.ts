import { describe, expect, it } from "vitest";

import { AppleFormatError, decodeCbor, encodeCbor } from "../../src/authn/apple";
import { Buffer } from "../../src/authn/apple/buffer";
import type { CborValue } from "../../src/authn/apple/cbor";

const asMap = (value: CborValue | undefined): Map<CborValue, CborValue> => {
  if (!(value instanceof Map)) {
    throw new Error("expected a map");
  }
  return value;
};

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof AppleFormatError ? error.code : "other";
  }
  return "none";
};

describe("cbor", () => {
  it("round-trips the attestation map and a COSE key", () => {
    const x = Buffer.alloc(32, 4);
    const value = new Map<CborValue, CborValue>([
      ["fmt", "apple-appattest"],
      ["attStmt", new Map<CborValue, CborValue>([["x5c", [Buffer.from([0x30, 0x00])]]])],
      ["authData", Buffer.from([1, 2, 3])],
    ]);
    const decoded = asMap(decodeCbor(encodeCbor(value)));
    expect(decoded.get("fmt")).toBe("apple-appattest");
    expect(asMap(decoded.get("attStmt")).get("x5c")).toEqual([Buffer.from([0x30, 0x00])]);
    const cose = asMap(
      decodeCbor(
        encodeCbor(
          new Map<CborValue, CborValue>([
            [1, 2],
            [3, -7],
            [-1, 1],
            [-2, x],
            [-3, x],
          ]),
        ),
      ),
    );
    expect(cose.get(1)).toBe(2);
    expect(cose.get(3)).toBe(-7);
    expect(cose.get(-1)).toBe(1);
    expect(cose.get(-2)).toEqual(x);
  });

  it("round-trips lengths that need one, two and four bytes", () => {
    for (const size of [23, 24, 255, 256, 65_535, 65_536]) {
      const bytes = Buffer.alloc(size, 7);
      expect(decodeCbor(encodeCbor(bytes))).toEqual(bytes);
    }
    expect(decodeCbor(encodeCbor([0, 23, 24, 255, 256, 65_536, -1, -25, -70_000]))).toEqual([
      0, 23, 24, 255, 256, 65_536, -1, -25, -70_000,
    ]);
  });

  it("rejects truncated, trailing, indefinite and floating input with a stable code", () => {
    expect(codeOf(() => decodeCbor(Buffer.from([0x42, 0x01])))).toBe("cbor_truncated");
    expect(codeOf(() => decodeCbor(Buffer.from([])))).toBe("cbor_truncated");
    expect(codeOf(() => decodeCbor(Buffer.from([0x01, 0x01])))).toBe("cbor_trailing");
    expect(codeOf(() => decodeCbor(Buffer.from([0x5f, 0xff])))).toBe("cbor_unsupported");
    expect(codeOf(() => decodeCbor(Buffer.from([0xf9, 0x00, 0x00])))).toBe("cbor_unsupported");
    expect(codeOf(() => decodeCbor(Buffer.from([0xf5])))).toBe("cbor_unsupported");
    expect(codeOf(() => encodeCbor(1.5))).toBe("cbor_int");
  });
});
