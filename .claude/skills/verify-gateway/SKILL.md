---
name: verify-gateway
description: Verify the gateway end to end - tenant routing, origin checks, CORS, request validation, error shapes and the admin token. Use after changing src/gateway, src/http, src/index.ts or src/admin/auth.ts.
---

# Verify the gateway

## Run

```bash
npx vitest run --config e2e/vitest.config.ts gateway
npx vitest run tests/conversation.test.ts tests/tenant-schema.test.ts
```

The first command boots a local worker with `wrangler dev` and a fake model provider, so it needs
no API key.

## What it proves

- An unknown tenant answers exactly like an unknown path (404 `not_found`).
- A foreign origin is refused with 403 before the body is read, and gets no CORS header.
- Each malformed body gets its own error code, with CORS headers so a browser can read it.
- Every response carries `x-request-id` and `server-timing`.
- The admin API refuses a wrong token and explains what is wrong with an invalid tenant.

## Check by hand when the error surface changes

Every error body is `{ "error": "<code>" }` plus, where a person will read it, a plain `message`
and `retryAfterSeconds`. A new error needs a stable code, and a message only if a person can act
on it.

## Performance budget

`npx vitest run --config e2e/vitest.config.ts performance` must pass: a rejected request under
25 ms at the median on a local worker.
