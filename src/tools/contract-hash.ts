import type { Contract } from "../tenants/schema";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
};

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const hashes = new WeakMap<Contract, Promise<string>>();

const compute = async (contract: Contract): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(contract))));

export const contractHash = async (contract: Contract): Promise<string> => {
  const known = hashes.get(contract);
  if (known !== undefined) {
    return known;
  }
  const computed = compute(contract);
  hashes.set(contract, computed);
  return computed;
};
