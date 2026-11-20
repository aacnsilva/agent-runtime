import type { Knowledge } from "./knowledge/knowledge-object";
import type { ModelHealth } from "./llm/health-object";
import type { Metrics } from "./observability/metrics-object";
import type { Ledger } from "./quota/ledger-object";
import type { Subject } from "./quota/subject-object";
import type { Session } from "./sessions/session-object";
import type { Registry } from "./tenants/registry-object";

export interface Env {
  LEDGER: DurableObjectNamespace<Ledger>;
  REGISTRY: DurableObjectNamespace<Registry>;
  METRICS: DurableObjectNamespace<Metrics>;
  SUBJECT: DurableObjectNamespace<Subject>;
  SESSION: DurableObjectNamespace<Session>;
  KNOWLEDGE: DurableObjectNamespace<Knowledge>;
  MODEL_HEALTH: DurableObjectNamespace<ModelHealth>;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  ADMIN_TOKEN?: string;
  EMBEDDINGS_BASE_URL?: string;
  EMBEDDINGS_API_KEY?: string;
}
