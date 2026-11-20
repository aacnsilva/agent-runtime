const KEY_SHAPE = /^[\x21-\x7e]{1,128}$/;
const UUID_GROUPS = [8, 4, 4, 4, 12] as const;

export type KeyReading = { ok: true; key: string | null } | { ok: false };

export const readIdempotencyKey = (header: string | null): KeyReading => {
  if (header === null) {
    return { ok: true, key: null };
  }
  const key = header.trim();
  return KEY_SHAPE.test(key) ? { ok: true, key } : { ok: false };
};

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const fingerprintOf = async (body: string): Promise<string> => sha256Hex(body);

export const sessionIdFor = async (subjectId: string, key: string): Promise<string> => {
  const hex = await sha256Hex(`${subjectId}\n${key}`);
  let offset = 0;
  return UUID_GROUPS.map((length) => {
    const group = hex.slice(offset, offset + length);
    offset += length;
    return group;
  }).join("-");
};
