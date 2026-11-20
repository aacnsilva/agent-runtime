export const corsHeaders = (request: Request, allowedOrigins: readonly string[]): Headers => {
  const headers = new Headers();
  headers.set("vary", "Origin");
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type, Authorization, Idempotency-Key");
  headers.set("access-control-expose-headers", "X-Request-Id, Retry-After, Idempotent-Replay");
  headers.set("access-control-max-age", "86400");
  const origin = request.headers.get("Origin");
  if (origin !== null && allowedOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
};

export const withHeaders = (response: Response, extra: Headers): Response => {
  const merged = new Response(response.body, response);
  extra.forEach((value, key) => {
    merged.headers.set(key, value);
  });
  return merged;
};
