---
name: verify-evals
description: Verify eval support - the eval pass that lets a runner in without a device or account, the per-call trace it returns, and the eval runner and its grading. Use after changing src/authn/eval-pass.ts, the evals block of src/tenants/schema.ts, or anything under evals/.
---

# Verify evals

## Run

```bash
npx vitest run tests/evals.test.ts
npx vitest run --config e2e/vitest.config.ts evals
```

The end-to-end spec runs the real runner as a child process against a local worker and the fake
provider, so it proves the mechanics, not any model's answers.

## What it proves

- A runner holding the tenant's eval secret is let in without an origin, a device or an account,
  skips the per-network limit, and gets its own subject per run and case, so no case spends
  another's monthly messages.
- A wrong secret and a run without a name are refused. The header is ignored on a tenant with no
  `evals` block.
- Eval replies carry a trace: the model, the model calls, the tools called and the cost. Ordinary
  callers never get it.
- Another model tier or effort can be graded only when the tenant lists it for evals.
- A tenant that serves production purchases cannot have an `evals` block at all.
- Eval traffic is marked in the metrics and can be left out of, or isolated on, the dashboard.
- The runner grades gated, stateless and stored tenants, answers client-run tools from the suite,
  names each failed check, compares against a baseline, and exits non-zero on a failure.

## Checks a suite can use

`tools`, `anyTool`, `noTools`, `noAnyTool`; `calls` and `noCalls` (a tool, how many times, and a
partial match on its input at any depth); `contains`, `containsAny`, `excludes`; `amounts`,
`excludesAmounts`; `grounded` (every amount of money in the answer appears in a tool result or a
question, as written or rounded); `language`; `onTopic`; `stopReason`; `maxModelCalls`;
`maxSeconds`. A case may attach one JPEG with `image`, a path beside the suite file.

A check that needs something only a product's own code can observe, such as the state of an app
after a tool ran, belongs in that product's runner, which uses the same eval pass.

## Running real evals

Real evals call the real model and cost money, so they are never part of `npm run check`.

```bash
EVAL_SECRET=... npm run evals -- --runtime <url> --tenant <id> --cases <file>
```

Add `--runs 3` for a baseline, because the same question does not always get the same answer,
and `--save-baseline` to keep it. `results/latest.json` next to the cases file holds every answer.

Run them before shipping a change to a tenant's prompt, tools, knowledge, model tier or effort.
Push the tenant first: evals test what the runtime has, not what is on disk.

## Rules

- Every check is code. Nothing is judged by a model.
- The tenant stores the SHA-256 of the eval secret, never the secret. The secret must be at least
  32 characters. Whoever holds it can spend from the tenant's monthly pool, so treat it like a key
  and keep it off production tenants.
- Suites for real products live with the product, like tenants. Only the fictional example suite
  lives here.
