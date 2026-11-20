# Ground rules

These rules apply to everyone working in this repo, human or AI. `npm run check` enforces most of
them and must pass before a commit is pushed.

## Code

- **No comments in code.** `local/no-comments` fails any comment in `.ts` and `.js`, including
  `eslint-disable` and `@ts-` directives. Say it with names, types and small functions; put the
  why in `README.md` or a skill.
- **TypeScript only**, on `@tsconfig/strictest`. No `any`, no non-null assertions.
- **Never weaken a lint rule or compiler option to make code pass.** Fix the code.
- Functions stay small: complexity 10, depth 3, 3 parameters, 60 lines.
- Pure logic lives apart from Durable Objects and has unit tests in `tests/`. A Durable Object
  class only loads state, calls a pure function, and stores the result.
- Nothing that is not needed for the response may be awaited on the request path. Metrics and
  logs go through `ctx.waitUntil`.

## Tenants and privacy

- This repository is public. Real tenant configurations, product names, prompts, prices and
  limits never go in it. Only the fictional example tenant does.
- The runtime stores codes and measurements, never what was asked or answered.

## Every feature ships with its verification

- A feature is done when it has unit tests for its pure logic, an end-to-end spec in `e2e/` that
  runs against a local worker, and a skill in `.claude/skills/verify-<feature>/` that says how to
  verify it and what to look at by hand.
- End-to-end specs use the fake provider in `e2e/support/mock-provider.ts`. They never call a
  real model.

## Commands

| Command         | What it does                                                |
| --------------- | ----------------------------------------------------------- |
| `npm run demo`  | Local worker, fake provider, example tenant, sample traffic |
| `npm run dev`   | Local worker with the real provider (needs `.dev.vars`)     |
| `npm run check` | Format, lint, types, unit tests and end-to-end tests        |
| `npm run test`  | Unit tests                                                  |
| `npm run e2e`   | End-to-end tests against a local worker                     |
