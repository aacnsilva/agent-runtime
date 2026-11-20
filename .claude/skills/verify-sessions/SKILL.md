---
name: verify-sessions
description: Verify stored sessions and the tool loop the runtime runs - conversation memory, ownership, fetch tools and their egress limits, the round limit. Use after changing src/sessions, src/agent/session-run.ts, src/tools/http-tool.ts or src/gateway/handle-session.ts.
---

# Verify sessions and runtime-run tools

## Run

```bash
npx vitest run tests/chat.test.ts
npx vitest run --config e2e/vitest.config.ts session
```

## What it proves

- The second turn of a session reaches the model with the first.
- A session is readable, continuable and deletable only by the subject who owns it. Anyone else
  gets 404, the same as a session that does not exist.
- A fetch tool is run by the runtime inside one request and one message, only against its own
  address: path tricks and other hosts are refused before any request is made.
- When a reply mixes runtime-run and client-run tools, the runtime waits for the client and
  refuses a new question until the results arrive.
- A model that keeps calling tools is stopped at the tenant's round limit.
- History is trimmed from the front in whole exchanges, so a tool result is never sent without the
  call it answers.

## Check by hand

- Two requests on one session at the same moment: one must answer and the other must get
  `session_busy`, never a merged history.
- After `DELETE`, the session's storage is empty in the local explorer that `wrangler dev` prints.
