---
name: verify-admin
description: Verify the admin pages and their API - creating, editing, validating and deleting tenants, the tool registry view, knowledge documents. Use after changing src/admin/tenants.html, src/admin/handle-tenants.ts, src/admin/templates.ts or the tenant schema.
---

# Verify the admin pages

## Run

```bash
npx vitest run --config e2e/vitest.config.ts admin
```

## What it proves

- Every starting template is a valid tenant as it stands.
- Validate checks a document without saving it and says what is wrong.
- A saved tenant reads back with its defaults filled in and a hash per tool contract, appears in
  the list, and stops answering the moment it is deleted.
- A document cannot be saved under another tenant's address.
- The page itself carries no data, and every admin route needs the admin token.

## Walk through the page

The tests cover the API. The page needs a person, or a browser script, after any change to it:

```bash
npm run demo
```

Open the printed address with `/admin/tenants` and sign in with the printed token. Then:

1. New tenant, pick "Chat for signed-in accounts", give it an id.
2. Tools: add a fetch tool to a host that is not listed. Save must refuse and name the allowed
   hosts. Add the host, replace the placeholder key in the Document tab, validate, save.
3. The contract shows a hash. Change the tool's description and save: the hash must change.
4. Knowledge: store a document, see it listed, delete it.
5. Plans and limits: add a plan, remove it, save.
6. Wording: add a message for `message_cap`, save, reload, and find it still there.
7. Switch tenants with unsaved changes: the page must ask first.
8. Delete the tenant: the page must ask for its id, and the list must drop it.
9. A phone-width window has no sideways page scroll, and the browser console is clean apart from
   the refused save in step 2.

## Rules

- The page edits one working copy of the tenant document. Nothing is applied until Save, and the
  server's validation is the only validation that counts.
- Templates are generic starting points with placeholder values. No real product's settings go in
  `src/admin/templates.ts`.
- Deleting a tenant removes its document only. Its sessions, documents, counters and metrics stay
  in their stores.
