---
name: verify-observability
description: Verify metrics and the dashboard - what is recorded per request, the aggregates, tenant separation, and the dashboard page. Use after changing src/observability, src/admin/handle-admin.ts or src/admin/dashboard.html.
---

# Verify observability

## Run

```bash
npx vitest run tests/aggregate.test.ts
npx vitest run --config e2e/vitest.config.ts observability
```

## What it proves

- Every request is counted once by how it ended, with cost, tokens, cache share and timings.
- Only codes and measurements are stored. The test asks a question with a marker word and checks
  the marker is nowhere in the stored data.
- A tenant filter never shows another tenant's numbers.
- The dashboard page is served without data, with a strict content security policy, and metrics
  need the admin token.

## Look at the dashboard

Tests cannot judge a chart. After changing the page, look at it:

```bash
npm run demo
```

Open the printed dashboard URL, enter the printed token, and check:

- Light and dark themes, and a phone-width window with no sideways page scroll.
- Hovering a bar or the line chart shows a tooltip with every series.
- Each time range relabels the time axis sensibly.
- An empty window shows the empty message, not a broken chart.
- The browser console is clean.

## Rules for new charts

One axis per chart. Series colours come from the page's `--s1` to `--s5` tokens in fixed order;
text stays in the ink colours. Every number in a chart is also in a table on the page.
