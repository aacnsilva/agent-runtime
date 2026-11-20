---
name: verify-knowledge
description: Verify retrieval - chunking, keyword and vector ranking, per-plan visibility, tenant separation, document management. Use after changing src/knowledge, src/admin/handle-documents.ts or the knowledge tool in src/tools.
---

# Verify knowledge retrieval

## Run

```bash
npx vitest run tests/knowledge.test.ts
npx vitest run --config e2e/vitest.config.ts knowledge
```

The end-to-end spec uses a fake embeddings endpoint that hashes words into a vector. It proves the
wiring, not the quality of a real embedding model.

## What it proves

- A document is chunked and embedded once; an unchanged document is skipped.
- A search returns the matching passage with the document it came from.
- A document restricted to a plan is visible only to subjects on that plan.
- A tenant never sees another tenant's documents: each tenant has its own store.
- A deleted document stops matching at once.
- A tenant with no embedding model still searches by keyword.
- A stored vector is used only when it came from the same embedding model as the query.

## Judge retrieval quality by hand

With a real corpus loaded, ask ten questions you know the answer to and check the passage that
comes back for each. Look for: the right document but the wrong passage (chunks too large), exact
terms such as codes or names being missed (keyword side), and paraphrased questions being missed
(vector side, or no embedding model configured).

## Known limits

- Every chunk of a tenant is scored on each search. That suits thousands of chunks, not millions.
- Embedding calls are not counted against the tenant's monthly pool.
