# agent-runtime

A multi-tenant agent runtime, built to learn how each module works and to reuse across projects.

This repository currently holds the system design only. No code has been written yet.

## System design

A request enters through the gateway, which authenticates the caller and attaches a tenant context.
The agent core runs the plan, act, observe loop and calls the three other modules: LLM routing, the tools registry, and multi-tenant RAG.

![System overview](docs/design/00-overview.png)

Each diagram has an editable source in [`docs/design`](docs/design). Open the `.excalidraw` file at [excalidraw.com](https://excalidraw.com) or with the Excalidraw editor extension.

| Module | Diagram | Source |
|---|---|---|
| Overview | [PNG](docs/design/00-overview.png) | [`00-overview.excalidraw`](docs/design/00-overview.excalidraw) |
| Gateway | [PNG](docs/design/01-gateway.png) | [`01-gateway.excalidraw`](docs/design/01-gateway.excalidraw) |
| Tools registry | [PNG](docs/design/02-tools-registry.png) | [`02-tools-registry.excalidraw`](docs/design/02-tools-registry.excalidraw) |
| LLM routing | [PNG](docs/design/03-llm-routing.png) | [`03-llm-routing.excalidraw`](docs/design/03-llm-routing.excalidraw) |
| Multi-tenant RAG | [PNG](docs/design/04-multi-tenant-rag.png) | [`04-multi-tenant-rag.excalidraw`](docs/design/04-multi-tenant-rag.excalidraw) |

## Gateway

The single entry point. A request passes through a pipeline where every stage can reject early, and the response comes back as a separate event stream.

![Gateway](docs/design/01-gateway.png)

- **AuthN** verifies the API key or JWT (401).
- **Tenant resolver** turns the credential into a tenant context that travels with the request.
- **AuthZ** checks the caller's roles and scopes for the action (403).
- **Rate limit and quotas** apply a per-tenant token bucket and a token budget (429).
- **Validate and idempotency** checks the body and replays the earlier run for a repeated idempotency key (400).
- **Session manager** loads the session and checks that the caller owns it (404, so ids in other tenants cannot be probed).
- **Dispatcher** hands the run and tenant context to the agent core.
- **Stream hub** logs events and fans them out over SSE, so a client can reconnect with `Last-Event-ID`.

## Tools registry

Tools are registered once, shown to the model per tenant, and invoked through a pipeline that enforces policy in code.

![Tools registry](docs/design/02-tools-registry.png)

- **Identity:** every tool has an owner and is addressed as `namespace/name@version#hash`, so names never collide.
- **Pinned by hash:** registration computes a sha256 over the definition, and invoke rejects any call whose hash no longer matches.
- **Discovery is read-only:** it decides which tools the model sees and never prompts.
- **One policy gate, at invoke time:** reads pass automatically; only write, external and irreversible calls ask for human approval.
- **Secrets** are injected by the credential broker at execution and never enter the model context.
- **Sandbox tiers:** remote calls go through an egress allowlist proxy; model-written JavaScript runs in an isolate (QuickJS in WASM first, V8 isolates such as Cloudflare Dynamic Workers later); shell and file work runs in a microVM.

## LLM routing

Callers ask for a capability tier, never a model name. The router selects a model and then calls it inside a resilience loop.

![LLM routing](docs/design/03-llm-routing.png)

- **Select:** normalize the request, drop models that cannot do the job (422), score the rest by cost, latency and tier, and reserve budget (429).
- **Call:** try the primary, respect circuit breakers and provider rate limits, and fall back down the ranked list on error or timeout.
- **Provider adapters** are the only place provider-specific code lives. Provider API keys are read from the secrets vault.
- **Sticky per run:** a run stays on one model so the provider's prompt cache stays warm.
- **Usage meter** records real token counts and cost and settles the budget reservation.
- **No silent retry** once tokens have streamed; the error goes back to the agent loop.

## Multi-tenant RAG

A write path that ingests documents and a read path that retrieves them, with four stores in between where every row carries a tenant id.

![Multi-tenant RAG](docs/design/04-multi-tenant-rag.png)

- **Ingest** runs in the background: stamp tenant and ACL, dedupe by content hash, parse, chunk, embed, and write to all stores.
- **Stores:** raw documents, metadata (the source of truth), a vector index with a namespace per tenant, and a keyword index.
- **Scope guard** forces the tenant and ACL filter onto every search in code. A query without a tenant fails.
- **Retrieve:** hybrid vector and keyword search, rerank, then pack chunks into a token budget with citations.
- **Retrieved text is untrusted data**, because documents can carry prompt injection.
- **Each chunk records its embedding model version**, and one search never mixes versions.

## Open decisions

- Implementation language. The QuickJS sandbox recommendation assumes a runtime that can host WASM.
- Tenant isolation in RAG: a shared index with a namespace per tenant (drawn) or a separate index per tenant.
- Whether retrieval is called by the agent core directly (drawn) or exposed as a read-effect tool in the registry.
- Whether the dispatcher calls the agent core directly (drawn) or through a queue.
