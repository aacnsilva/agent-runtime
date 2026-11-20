import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";
import type { BeginInput, Refusal, Replay, SessionRecord } from "./turn";
import { beginTurn, commitTurn, fromLegacy, releaseTurn, renewTurn } from "./turn";

const RECORD_KEY = "record";
const MESSAGE_PREFIX = "message:";
const LEGACY_KEY = "session";
const INDEX_DIGITS = 10;
const KEYS_PER_PUT = 100;

export type Begun =
  | { kind: "started"; history: string[]; pending: string | null; tokensPerChar: number | null }
  | { kind: "replay"; body: string }
  | { kind: "refused"; code: Refusal };

export interface BeginCall extends BeginInput {
  tail: number;
}

export interface LeaseCall {
  leaseId: string;
  now: number;
}

export interface CommitCall extends LeaseCall {
  messages: string[];
  pending: string | null;
  replay: Replay | null;
  tokensPerChar: number | null;
}

export interface StoredSession {
  owner: string;
  updatedAt: number;
  pending: string | null;
  messages: string[];
}

const messageKey = (index: number): string =>
  `${MESSAGE_PREFIX}${String(index).padStart(INDEX_DIGITS, "0")}`;

export class Session extends DurableObject<Env> {
  async begin(input: BeginCall): Promise<Begun> {
    const decision = beginTurn(await this.record(), input);
    if (decision.kind !== "started") {
      return decision;
    }
    await this.ctx.storage.put(RECORD_KEY, decision.record);
    return {
      kind: "started",
      history: await this.messages(input.tail),
      pending: decision.record.pending,
      tokensPerChar: decision.record.tokensPerChar,
    };
  }

  async renew(input: LeaseCall): Promise<boolean> {
    const renewed = renewTurn(await this.record(), input.leaseId, input.now);
    if (renewed !== null) {
      await this.ctx.storage.put(RECORD_KEY, renewed);
    }
    return renewed !== null;
  }

  async commit(input: CommitCall): Promise<boolean> {
    const record = await this.record();
    const committed = commitTurn(record, { ...input, appended: input.messages.length });
    if (committed === null) {
      return false;
    }
    await this.write(committed, record?.count ?? 0, input.messages);
    return true;
  }

  async release(input: LeaseCall): Promise<void> {
    const released = releaseTurn(await this.record(), input.leaseId);
    if (released.kind === "kept") {
      await this.ctx.storage.put(RECORD_KEY, released.record);
    }
    if (released.kind === "emptied") {
      await this.ctx.storage.deleteAll();
    }
  }

  async read(): Promise<StoredSession | null> {
    const record = await this.record();
    return record === null
      ? null
      : {
          owner: record.owner,
          updatedAt: record.updatedAt,
          pending: record.pending,
          messages: await this.messages(record.count),
        };
  }

  async clear(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  private async record(): Promise<SessionRecord | null> {
    return (await this.ctx.storage.get<SessionRecord>(RECORD_KEY)) ?? this.migrate();
  }

  private async migrate(): Promise<SessionRecord | null> {
    const legacy = await this.ctx.storage.get<string>(LEGACY_KEY);
    const migrated = legacy === undefined ? null : fromLegacy(legacy, Date.now());
    if (migrated === null) {
      return null;
    }
    await this.ctx.storage.deleteAll();
    await this.write(migrated.record, 0, migrated.messages);
    return migrated.record;
  }

  private async messages(limit: number): Promise<string[]> {
    if (limit <= 0) {
      return [];
    }
    const found = await this.ctx.storage.list<string>({
      prefix: MESSAGE_PREFIX,
      reverse: true,
      limit,
    });
    return [...found.values()].reverse();
  }

  private async write(record: SessionRecord, from: number, messages: string[]): Promise<void> {
    const entries = messages.map((message, index) => [messageKey(from + index), message] as const);
    const puts: Promise<void>[] = [this.ctx.storage.put(RECORD_KEY, record)];
    for (let start = 0; start < entries.length; start += KEYS_PER_PUT) {
      puts.push(
        this.ctx.storage.put(Object.fromEntries(entries.slice(start, start + KEYS_PER_PUT))),
      );
    }
    await Promise.all(puts);
  }
}
