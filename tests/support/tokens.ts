const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

export interface Issuer {
  kid: string;
  jwk: { kty: "EC"; crv: "P-256"; x: string; y: string };
  sign: (claims: Record<string, unknown>, header?: Record<string, unknown>) => Promise<string>;
}

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const encode = (value: unknown): string =>
  base64Url(new TextEncoder().encode(JSON.stringify(value)));

export const createIssuer = async (kid = "key-1"): Promise<Issuer> => {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  if (!("privateKey" in pair)) {
    throw new Error("expected a key pair");
  }
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  if (exported instanceof ArrayBuffer) {
    throw new Error("expected a JSON web key");
  }
  const sign = async (claims: Record<string, unknown>, header = {}): Promise<string> => {
    const signingInput = `${encode({ alg: "ES256", kid, ...header })}.${encode(claims)}`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
  };
  return { kid, jwk: { kty: "EC", crv: "P-256", x: exported.x ?? "", y: exported.y ?? "" }, sign };
};
