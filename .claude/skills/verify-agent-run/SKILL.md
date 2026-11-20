---
name: verify-agent-run
description: Verify model routing and the gated answer - provider request shape, fallback, the topic gate, canned refusals and streaming. Use after changing src/agent, src/llm or the streaming path in src/gateway/handle-run.ts.
---

# Verify the agent run

## Run

```bash
npx vitest run tests/gate.test.ts tests/run.test.ts
npx vitest run --config e2e/vitest.config.ts run performance
```

## What it proves

- The provider receives the cached system prompt, the reply schema, and the reminder as the last
  message.
- An off-topic reply, a provider safety refusal, and an unreadable reply are each replaced by the
  tenant's own text, in the language of the question.
- Streaming never emits a word of an off-topic reply, the deltas add up to the final answer, and
  every stream ends on exactly one `done` or `error` event.
- The router falls back to the next model only when nothing was written and nothing can have been
  billed; it never retries silently after text has streamed.
- A model that fails three times in a row is skipped for thirty seconds, unless it is the only
  candidate. The circuit lives in each worker instance's memory, so it is per instance.

## Performance budgets (local worker, fake provider)

- Under 60 ms added to a complete answer at the median.
- First streamed text within 60 ms of the provider's first token.

If a budget fails, look for a new awaited call on the request path before raising the number.
Metrics and logs must stay off the request path (`ctx.waitUntil`).

## With a real model

The suite uses a fake provider. Before shipping a prompt or model change, run the worker with a
real key and ask a few questions by hand:

```bash
cp .dev.vars.example .dev.vars
npm run dev
```
