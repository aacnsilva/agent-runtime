---
name: verify-toolchain
description: Verify the compiler options, lint rules and the ban on code comments. Use after changing tsconfig, eslint.config.js, the no-comments rule, or package scripts.
---

# Verify the toolchain

## Run

```bash
npm run format:check && npm run lint && npm run typecheck
```

All three must exit 0 with no warnings.

## Prove the comment ban still bites

The rule is only worth having if it fails. Add a comment to a scratch file, lint it, then delete it:

```bash
printf '// a comment\nexport const probe = 1;\n' > src/comment-probe.ts
npx eslint src/comment-probe.ts; echo "exit $?"
rm src/comment-probe.ts
```

Expected: `local/no-comments` reported and exit 1. Inline `eslint-disable` and `@ts-` directives are
comments too, so they fail the same way.

## What must stay true

- `tsconfig.json` extends `@tsconfig/strictest` and nothing in it loosens a strict option.
- `eslint.config.js` keeps `strictTypeChecked`, `noInlineConfig`, and `local/no-comments` at `error`.
- Limits stay at complexity 10, depth 3, 3 parameters, 60 lines per function in `src/`.
- No rule is weakened to make code pass. Fix the code.
