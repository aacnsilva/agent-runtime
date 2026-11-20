import type { Env } from "../env";
import { Rejection } from "../http/respond";

const MIN_TOKEN_CHARS = 16;
const BEARER = "Bearer ";

const digest = async (text: string): Promise<ArrayBuffer> =>
  crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

const sameSecret = async (left: string, right: string): Promise<boolean> =>
  crypto.subtle.timingSafeEqual(await digest(left), await digest(right));

export const assertAdmin = async (request: Request, env: Env): Promise<void> => {
  const expected = env.ADMIN_TOKEN ?? "";
  if (expected.length < MIN_TOKEN_CHARS) {
    throw new Rejection(503, "admin_unconfigured", {
      message: "Set ADMIN_TOKEN to at least 16 characters.",
    });
  }
  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith(BEARER) ? header.slice(BEARER.length) : "";
  if (!(await sameSecret(presented, expected))) {
    throw new Rejection(401, "unauthorized");
  }
};
