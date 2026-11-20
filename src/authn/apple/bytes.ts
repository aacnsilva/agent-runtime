import { createHash } from "node:crypto";

import { Buffer } from "./buffer";

const MAX_BASE64_LENGTH = 16_384;

export const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

export const bytesToBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");

export const decodeBase64 = (value: unknown): Buffer | null => {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_BASE64_LENGTH) {
    return null;
  }
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 0 ? null : bytes;
};

export const sha256 = (bytes: Uint8Array | string): Buffer =>
  createHash("sha256").update(bytes).digest();
