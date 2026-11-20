import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";
import type { RunEvent } from "./events";

const RETENTION_MS = 35 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY = 500;
const MAX_ROWS = 50_000;

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS events (
    at INTEGER NOT NULL,
    tenant TEXT NOT NULL,
    request_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    status INTEGER NOT NULL,
    streamed INTEGER NOT NULL,
    model TEXT,
    attempts INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    ttft_ms INTEGER,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL,
    cost_nano_eur INTEGER NOT NULL,
    evaluated INTEGER NOT NULL DEFAULT 0
  )`;
const CREATE_INDEX = "CREATE INDEX IF NOT EXISTS events_at ON events (at)";
const ADD_EVALUATED = "ALTER TABLE events ADD COLUMN evaluated INTEGER NOT NULL DEFAULT 0";
const HAS_EVALUATED = "SELECT 1 FROM pragma_table_info('events') WHERE name = 'evaluated'";
const INSERT = `INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SELECT = `SELECT * FROM events WHERE at >= ? ORDER BY at ASC LIMIT ?`;

type Row = Record<string, SqlStorageValue>;

const numberOf = (value: SqlStorageValue | undefined): number =>
  typeof value === "number" ? value : 0;

const textOf = (value: SqlStorageValue | undefined): string =>
  typeof value === "string" ? value : "";

const eventOf = (row: Row): RunEvent => ({
  at: numberOf(row["at"]),
  tenant: textOf(row["tenant"]),
  requestId: textOf(row["request_id"]),
  outcome: textOf(row["outcome"]),
  status: numberOf(row["status"]),
  streamed: numberOf(row["streamed"]) === 1,
  evaluated: numberOf(row["evaluated"]) === 1,
  model: typeof row["model"] === "string" ? row["model"] : null,
  attempts: numberOf(row["attempts"]),
  latencyMs: numberOf(row["latency_ms"]),
  ttftMs: typeof row["ttft_ms"] === "number" ? row["ttft_ms"] : null,
  inputTokens: numberOf(row["input_tokens"]),
  outputTokens: numberOf(row["output_tokens"]),
  cacheReadTokens: numberOf(row["cache_read_tokens"]),
  cacheWriteTokens: numberOf(row["cache_write_tokens"]),
  costNanoEur: numberOf(row["cost_nano_eur"]),
});

export class Metrics extends DurableObject<Env> {
  private recorded = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(CREATE_TABLE);
    ctx.storage.sql.exec(CREATE_INDEX);
    if (ctx.storage.sql.exec(HAS_EVALUATED).toArray().length === 0) {
      ctx.storage.sql.exec(ADD_EVALUATED);
    }
  }

  record(event: RunEvent): void {
    this.ctx.storage.sql.exec(
      INSERT,
      event.at,
      event.tenant,
      event.requestId,
      event.outcome,
      event.status,
      event.streamed ? 1 : 0,
      event.model,
      event.attempts,
      event.latencyMs,
      event.ttftMs,
      event.inputTokens,
      event.outputTokens,
      event.cacheReadTokens,
      event.cacheWriteTokens,
      event.costNanoEur,
      event.evaluated ? 1 : 0,
    );
    this.recorded += 1;
    if (this.recorded % PRUNE_EVERY === 0) {
      this.ctx.storage.sql.exec("DELETE FROM events WHERE at < ?", event.at - RETENTION_MS);
    }
  }

  since(since: number): RunEvent[] {
    return this.ctx.storage.sql.exec<Row>(SELECT, since, MAX_ROWS).toArray().map(eventOf);
  }
}
