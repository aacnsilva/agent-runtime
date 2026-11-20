---
name: verify-chat-tools
description: Verify the chat agent and its tools - request validation, message counting per subject, tools pinned by hash, tools that run on the client, the held-back stream. Use after changing src/agent/chat*.ts, src/gateway/chat-body.ts, src/quota/subject*.ts or src/tools.
---

# Verify chat and tools

## Run

```bash
npx vitest run tests/chat.test.ts tests/subject.test.ts
npx vitest run --config e2e/vitest.config.ts chat
```

## What it proves

- A question and its first tool round count as one message; every later round counts as one more.
  A call that fails gives back exactly what it spent.
- A subject at its plan's monthly messages is refused before the provider is called, and another
  subject is unaffected.
- A tool call is handed to the client with only the call, never the model's lead-in text, and the
  conversation finishes when the result comes back.
- A model reply that names a tool outside the contract, or is cut off mid-call, never reaches the
  client.
- A client that sends a contract hash is refused when the tenant's tools have changed since.
- The stream holds the opening back until it is clearly an answer, and goes quiet once a tool call
  begins.
- Unsafe tenant shapes are refused when the tenant is saved: a chat agent for anonymous callers, a
  runtime-run tool that is not read-only, a fetch tool whose host is not on the egress list.

## Check by hand when the contract format changes

Save a tenant twice with its tools in a different key order and confirm the hash returned by the
admin API is the same; change one description and confirm it differs.

## Not built

Approval prompts issued by the runtime itself. Tools with a write, external or irreversible effect
can only run on the client, which owns the confirmation.
