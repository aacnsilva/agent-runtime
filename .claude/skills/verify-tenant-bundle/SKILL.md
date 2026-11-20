---
name: verify-tenant-bundle
description: Verify that a real tenant's configuration works in the runtime before pointing a product at it. Use when onboarding a tenant, changing the tenant schema, or before a cutover.
---

# Verify a tenant bundle

A tenant bundle is one JSON file that matches `src/tenants/schema.ts`. Real bundles describe real
products, so they live with the product, not in this repository. `examples/tenants/demo.tenant.json`
is the shape to copy.

## Run

```bash
E2E_TENANT_BUNDLE=/absolute/path/to/product.tenant.json \
  npx vitest run --config e2e/vitest.config.ts tenant-bundle
```

Without `E2E_TENANT_BUNDLE` the spec is skipped.

## What it proves

- The admin API accepts the bundle exactly as written.
- The tenant's own origin is answered and a foreign one refused.
- The whole system prompt reaches the provider, marked for caching.
- An off-topic reply is replaced with the bundle's own refusal text.
- Streaming works and the pool reports as accepting.

## Before a cutover

1. Run this spec with the product's bundle.
2. Run the worker with a real key (`npm run dev`), push the bundle to it, and ask real questions
   in each language the product supports.
3. Compare the limits in the bundle with the limits the product enforces today.
4. Point the product's client at `/v1/tenants/<id>/runs` and `/v1/tenants/<id>/status`.
5. Watch the dashboard for the first hour: outcomes, response time, and cost against the pool.
