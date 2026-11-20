export class Rejection extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, code: string, detail: RejectionDetail = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.publicMessage = detail.message;
    this.retryAfterSeconds = detail.retryAfterSeconds;
  }
}

export interface RejectionDetail {
  message?: string;
  retryAfterSeconds?: number;
}

export const json = (body: unknown, status: number, extra?: Headers): Response => {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
};

export const rejectionResponse = (rejection: Rejection): Response => {
  const headers = new Headers();
  if (rejection.retryAfterSeconds !== undefined) {
    headers.set("retry-after", String(rejection.retryAfterSeconds));
  }
  const body = {
    error: rejection.code,
    ...(rejection.publicMessage === undefined ? {} : { message: rejection.publicMessage }),
    ...(rejection.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: rejection.retryAfterSeconds }),
  };
  return json(body, rejection.status, headers);
};
