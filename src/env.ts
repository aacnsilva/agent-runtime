import type { Metrics } from "./observability/metrics-object";
import type { Ledger } from "./quota/ledger-object";
import type { Registry } from "./tenants/registry-object";

export interface Env {
  LEDGER: DurableObjectNamespace<Ledger>;
  REGISTRY: DurableObjectNamespace<Registry>;
  METRICS: DurableObjectNamespace<Metrics>;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  ADMIN_TOKEN?: string;
}
