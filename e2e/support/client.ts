import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { RecordedCall } from "./mock-provider.ts";

export const ALLOWED_ORIGIN = "http://localhost:8080";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set; run through npm run e2e`);
  }
  return value;
};

export const runtimeUrl = (): string => required("E2E_RUNTIME_URL");

const adminHeaders = (): Record<string, string> => ({
  authorization: `Bearer ${required("E2E_ADMIN_TOKEN")}`,
  "content-type": "application/json",
});

type Json = Record<string, unknown>;

interface TenantOverrides {
  limits?: Json;
  agent?: Json;
}

const demoTenant = async (): Promise<Json> =>
  JSON.parse(
    await readFile(join(import.meta.dirname, "../../examples/tenants/demo.tenant.json"), "utf8"),
  ) as Json;

export const createTenant = async (overrides: TenantOverrides = {}): Promise<string> => {
  const base = await demoTenant();
  const id = `t-${randomBytes(6).toString("hex")}`;
  const tenant = {
    ...base,
    id,
    limits: { ...(base["limits"] as Json), ...overrides.limits },
    agent: { ...(base["agent"] as Json), ...overrides.agent },
  };
  const response = await fetch(`${runtimeUrl()}/admin/api/tenants/${id}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify(tenant),
  });
  if (!response.ok) {
    throw new Error(`could not create tenant: ${await response.text()}`);
  }
  return id;
};

export const runsUrl = (tenant: string): string => `${runtimeUrl()}/v1/tenants/${tenant}/runs`;

export const postRun = async (
  tenant: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> =>
  fetch(runsUrl(tenant), {
    method: "POST",
    headers: { "content-type": "application/json", origin: ALLOWED_ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

export const ask = async (tenant: string, question: string): Promise<Response> =>
  postRun(tenant, { messages: [{ role: "user", content: question }] });

export interface StreamEvent {
  type: string;
  text?: string;
  answer?: string;
  onTopic?: boolean;
  error?: string;
  atMs: number;
}

export const askStream = async (
  tenant: string,
  question: string,
  origin: string = ALLOWED_ORIGIN,
): Promise<StreamEvent[]> => {
  const startedAt = performance.now();
  const response = await postRun(
    tenant,
    { messages: [{ role: "user", content: question }] },
    { accept: "text/event-stream", origin },
  );
  if (response.body === null) {
    throw new Error("stream has no body");
  }
  const events: StreamEvent[] = [];
  let buffer = "";
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const parsed = JSON.parse(frame.replace(/^data: /, "")) as Omit<StreamEvent, "atMs">;
      events.push({ ...parsed, atMs: performance.now() - startedAt });
    }
  }
  return events;
};

export const providerCalls = async (): Promise<RecordedCall[]> =>
  (await (await fetch(`${required("E2E_PROVIDER_URL")}/__calls`)).json()) as RecordedCall[];

export interface PoolView {
  accepting: boolean;
  spentNanoEur: number;
  reservedNanoEur: number;
  poolNanoEur: number;
}

export interface MetricsView {
  totals: {
    requests: number;
    counts: Record<string, number>;
    costNanoEur: number;
    cacheHitRatio: number | null;
    latencyP50: number | null;
    ttftP50: number | null;
  };
  buckets: unknown[];
  outcomes: { outcome: string; count: number }[];
  recent: Json[];
  tenants: { id: string; pool: PoolView }[];
}

export const adminGet = async (path: string, token?: string): Promise<Response> =>
  fetch(`${runtimeUrl()}${path}`, {
    headers: token === undefined ? adminHeaders() : { authorization: `Bearer ${token}` },
  });

export const metricsFor = async (tenant: string): Promise<MetricsView> =>
  (await (await adminGet(`/admin/api/metrics?hours=1&tenant=${tenant}`)).json()) as MetricsView;

export const poolOf = async (tenant: string): Promise<PoolView> => {
  const view = await metricsFor(tenant);
  const found = view.tenants.find((entry) => entry.id === tenant);
  if (found === undefined) {
    throw new Error(`no pool for ${tenant}`);
  }
  return found.pool;
};

export const eventually = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> => {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
