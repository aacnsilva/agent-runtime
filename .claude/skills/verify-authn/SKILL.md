---
name: verify-authn
description: Verify the authenticators - signed account tokens, attested devices with store purchases, plans and entitlement. Use after changing src/authn, the authn or plans parts of src/tenants/schema.ts, or src/gateway/handle-attest.ts.
---

# Verify authentication

## Run

```bash
npx vitest run tests/account-token.test.ts tests/device.test.ts tests/apple
npx vitest run --config e2e/vitest.config.ts chat device
```

The device spec needs the `openssl` command: it builds a synthetic certificate chain, device and
store for each run.

## What it proves

- An account token is accepted only when the tenant's own key signed it, for this audience, and it
  has not expired. The subject and the plan come from the token, never from the request body.
- A plan the tenant does not define is refused with `entitlement_inactive`.
- A device key is attested once against a one-time challenge, and an app with another identity is
  refused.
- Every request from a device carries an assertion over the exact bytes of the body and the
  purchase. A replayed request and a body changed after signing are both refused.
- A lapsed purchase, a purchase for another product, a purchase from the other store environment
  and a purchase signed by anyone but the store are each refused with their own code.
- A test-environment tenant can accept a test install's receipt or a development key; a production
  tenant accepts neither.

## What the tests cannot prove

The synthetic chain mirrors the real formats, but it is not signed by Apple. After any change
under `src/authn/apple`, or to how the assertion's signed bytes are assembled in
`src/authn/device-authn.ts`, deploy to a development worker and send one request from a real
device build before shipping. The Workers runtime and Node differ in how they accept keys and
signatures, and unit tests run in Node.

## Rules

- No bypass headers, debug subjects or shared secrets that stand in for a credential.
- App identifiers, product identifiers and store environment are tenant configuration. Nothing
  app-specific is a constant in `src/`.
