---
name: verify-agent-run
description: Verify model routing and the gated answer - provider request shape, fallback, the topic gate, canned refusals and streaming. Use after changing src/agent, src/llm or the streaming path in src/gateway/handle-run.ts.
---

# Verify the agent run

## Run

```bash
npx vitest run tests/gate.test.ts tests/run.test.ts tests/anthropic.test.ts tests/stream.test.ts
npx vitest run --config e2e/vitest.config.ts run performance turns
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
- A model that fails three times within a minute is skipped for thirty seconds, unless it is the
  only candidate. Older failures are forgotten, the first failure after the pause opens the circuit
  again, and a success closes it.
- Only the provider being unavailable opens a circuit: 5xx, 429, a lost connection, a timeout. A
  request the provider refuses with another 4xx, or a caller who left, does not.
- Circuit state is shared: a worker instance that has seen nothing learns an open circuit from the
  `ModelHealth` object, and reports go through `waitUntil`.
- The provider is always called with `stream: true`. An answer may run far past the twenty-second
  first-byte limit while it keeps arriving; a stream silent for the idle limit is ended and counted
  as a timeout.
- A stream ends on an `error` event and closes when the work throws something unexpected, and the
  thrown message is not sent to the client.
- When the client hangs up mid-stream the provider call is cancelled, is not retried on another
  model, and does not count against the model.

## Performance budgets (local worker, fake provider)

- Under 60 ms added to a complete answer at the median, on top of the time the fake provider took
  to stream it.
- First streamed text within 60 ms of the provider's first token.

If a budget fails, look for a new awaited call on the request path before raising the number.
Metrics and logs must stay off the request path (`ctx.waitUntil`).

## Check by hand

- The shared circuit across instances is proved against a fake `ModelHealth` port in
  `tests/run.test.ts`. On a deployed worker, the `ModelHealth` object's `circuits` entry should
  list a model after its provider errors and be empty again after it answers.
- `enable_request_signal` in `wrangler.jsonc` is what tells a non-streaming request that its client
  left. The local dev proxy does not pass that on, so only the streaming case has a spec.

## With a real model

The suite uses a fake provider. Before shipping a prompt or model change, run the worker with a
real key and ask a few questions by hand:

```bash
cp .dev.vars.example .dev.vars
npm run dev
```
