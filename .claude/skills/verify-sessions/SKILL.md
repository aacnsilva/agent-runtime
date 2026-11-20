---
name: verify-sessions
description: Verify stored sessions and the tool loop the runtime runs - conversation memory, the turn lock, idempotent retries, the append-only log, ownership, fetch tools and their egress limits, the round limit. Use after changing src/sessions, src/agent/session-run.ts, src/tools/http-tool.ts or src/gateway/handle-session.ts.
---

# Verify sessions and runtime-run tools

## Run

```bash
npx vitest run tests/chat.test.ts tests/turn.test.ts tests/session-run.test.ts
npx vitest run --config e2e/vitest.config.ts session turns
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
- A turn takes the session's lock before any model call. Of two requests at the same moment, one
  answers and the other gets `409 session_busy` with `Retry-After`, and the provider is called once.
- The lock is given up when the turn fails, and a new session whose first turn fails leaves nothing
  stored.
- A turn repeated with the same `Idempotency-Key` returns the stored reply with
  `Idempotent-Replay: true`: one provider call, one message counted, one exchange in the transcript.
  A first turn's retry lands on the same session. The key with another body is refused with 422.
- The stored conversation only grows. With a small `input.maxConversationTokens` the model is sent
  one message per turn while the transcript still lists every turn.
- What the model is sent is trimmed from the front in whole exchanges and always starts at a
  question, so a tool result is never sent without the call it answers.
- A turn waiting on a client tool is held outside the log, photo included, and is appended without
  the photo when it ends.
- A session stored in the old single-value layout is read as a log of the same messages
  (`fromLegacy` in `tests/turn.test.ts`).

## Check by hand

- After `DELETE`, the session's storage is empty in the local explorer that `wrangler dev` prints.
- In that explorer, a session has one `record` entry and one `message:<number>` entry per message;
  earlier entries do not change when a new turn is added.
- Before deploying over existing sessions: continue one that was stored by the previous version and
  read its transcript. The migration runs on first use and is covered only by a unit test.
- A worker killed mid-turn leaves the lock held until its two-minute lease runs out. On a deployed
  worker, close a non-streaming request mid-answer and check the session accepts a turn again; the
  local dev proxy does not pass that disconnect on, so no spec covers it.
