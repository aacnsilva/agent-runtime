import type { SessionPort } from "../agent/session-run";
import type { Env } from "../env";
import type { SessionState } from "./session";
import type { Session } from "./session-object";

export const sessionStub = (
  env: Env,
  tenantId: string,
  sessionId: string,
): DurableObjectStub<Session> =>
  env.SESSION.get(env.SESSION.idFromName(`session:${tenantId}:${sessionId}`));

const isState = (value: unknown): value is SessionState =>
  typeof value === "object" && value !== null && "owner" in value && "messages" in value;

export const readSession = async (
  stub: DurableObjectStub<Session>,
): Promise<SessionState | null> => {
  const serialized = await stub.load();
  const parsed: unknown = serialized === null ? null : JSON.parse(serialized);
  return isState(parsed) ? parsed : null;
};

export const sessionPort = (stub: DurableObjectStub<Session>): SessionPort => ({
  load: async () => readSession(stub),
  save: async (state, expectedVersion) =>
    stub.save(JSON.stringify({ ...state, version: expectedVersion + 1 }), expectedVersion),
});
