import { readToolResults } from "../gateway/chat-body";
import { Rejection } from "../http/respond";
import type { Usage } from "../llm/cost";
import { NO_USAGE } from "../llm/cost";
import type { Listeners, MessageBlock, ModelMessage, ToolUseBlock } from "../llm/provider";
import type { Pending, SessionState } from "../sessions/session";
import { newSession, orderedResults, trimHistory, withoutImages } from "../sessions/session";
import type { ToolRuntime } from "../tools/execute";
import { executeServerCall, runsOnClient } from "../tools/execute";
import type { ChatTurn, RoundResult } from "./chat";
import { chatRound } from "./chat";

export interface SessionPort {
  load: () => Promise<SessionState | null>;
  save: (state: SessionState, expectedVersion: number) => Promise<boolean>;
}

export type TurnInput =
  { kind: "message"; content: string | MessageBlock[] } | { kind: "tool_results"; raw: unknown };

export interface SessionTurn {
  base: Omit<ChatTurn, "messages" | "toolRounds">;
  store: SessionPort;
  input: TurnInput;
  tools: ToolRuntime;
  listenersForRound: () => Listeners;
}

interface Progress {
  messages: ModelMessage[];
  toolRounds: number;
}

const addUsage = (left: Usage, right: Usage): Usage => ({
  input: left.input + right.input,
  output: left.output + right.output,
  cacheWrite: left.cacheWrite + right.cacheWrite,
  cacheRead: left.cacheRead + right.cacheRead,
});

const combine = (total: RoundResult | null, round: RoundResult): RoundResult =>
  total === null
    ? round
    : {
        ...round,
        attempts: total.attempts + round.attempts,
        usage: addUsage(total.usage, round.usage),
        costNanoEur: total.costNanoEur + round.costNanoEur,
      };

const openSession = async (turn: SessionTurn): Promise<SessionState> => {
  const owner = turn.base.principal.subjectId;
  const stored = await turn.store.load();
  if (stored === null) {
    return newSession(owner, Date.now());
  }
  if (stored.owner !== owner) {
    throw new Rejection(404, "not_found");
  }
  return stored;
};

const startFrom = (turn: SessionTurn, state: SessionState): Progress => {
  const { input } = turn;
  if (input.kind === "message") {
    if (state.pending !== null) {
      throw new Rejection(409, "awaiting_tool_results");
    }
    return {
      messages: [...state.messages, { role: "user", content: input.content }],
      toolRounds: 0,
    };
  }
  if (state.pending === null) {
    throw new Rejection(400, "bad_tool_result");
  }
  const results = readToolResults(input.raw, state.pending.clientIds, turn.base.agent.input);
  const content = orderedResults(state.pending, results);
  return {
    messages: [...state.messages, { role: "user", content }],
    toolRounds: state.pending.toolRounds,
  };
};

const persist = async (
  turn: SessionTurn,
  state: SessionState,
  next: Pick<SessionState, "messages" | "pending">,
): Promise<void> => {
  const { input } = turn.base.agent;
  const messages = trimHistory(
    next.pending === null ? withoutImages(next.messages) : next.messages,
    {
      maxChars: input.maxConversationChars,
      maxMessages: input.maxMessages,
      imageChars: input.imageChars,
    },
  );
  const saved = await turn.store.save(
    { ...state, messages, pending: next.pending, updatedAt: Date.now() },
    state.version,
  );
  if (!saved) {
    throw new Rejection(409, "session_busy");
  }
};

const handBack = (round: RoundResult, clientCalls: ToolUseBlock[]): RoundResult => ({
  ...round,
  content: clientCalls,
  calls: clientCalls,
  body: { ...round.body, content: clientCalls },
});

const afterToolCalls = async (
  turn: SessionTurn,
  progress: Progress,
  round: RoundResult,
): Promise<{ pending: Pending | null; messages: ModelMessage[] }> => {
  const { contract } = turn.base;
  const messages: ModelMessage[] = [
    ...progress.messages,
    { role: "assistant", content: round.content },
  ];
  const clientCalls = round.calls.filter((call) => runsOnClient(contract, call));
  const serverCalls = round.calls.filter((call) => !runsOnClient(contract, call));
  const serverResults = await Promise.all(
    serverCalls.map((call) => executeServerCall(turn.tools, contract, call)),
  );
  if (clientCalls.length === 0) {
    return { pending: null, messages: [...messages, { role: "user", content: serverResults }] };
  }
  const pending = {
    orderedIds: round.calls.map((call) => call.id),
    clientIds: clientCalls.map((call) => call.id),
    serverResults,
    toolRounds: progress.toolRounds + 1,
  };
  return { pending, messages };
};

const TOO_MANY_ROUNDS = {
  status: 502,
  outcome: "too_many_rounds",
  body: { error: "too_many_rounds", message: "That took too many steps. Ask again more simply." },
  content: [],
  calls: [],
  quota: null,
  model: null,
  attempts: 0,
  usage: NO_USAGE,
  costNanoEur: 0,
} satisfies RoundResult;

export const runSessionTurn = async (turn: SessionTurn): Promise<RoundResult> => {
  const state = await openSession(turn);
  let progress = startFrom(turn, state);
  let total: RoundResult | null = null;
  const historyLimits = {
    maxChars: turn.base.agent.input.maxConversationChars,
    maxMessages: turn.base.agent.input.maxMessages,
    imageChars: turn.base.agent.input.imageChars,
  };
  for (let round = 0; round < turn.base.agent.maxRounds; round += 1) {
    const result = await chatRound(
      {
        ...turn.base,
        messages: trimHistory(progress.messages, historyLimits),
        toolRounds: progress.toolRounds,
      },
      turn.listenersForRound(),
    );
    total = combine(total, result);
    if (result.status !== 200) {
      return total;
    }
    if (result.calls.length === 0) {
      const messages: ModelMessage[] = [
        ...progress.messages,
        { role: "assistant", content: result.content },
      ];
      await persist(turn, state, { messages, pending: null });
      return total;
    }
    const next = await afterToolCalls(turn, progress, result);
    if (next.pending !== null) {
      const { clientIds } = next.pending;
      await persist(turn, state, next);
      return handBack(
        total,
        result.calls.filter((call) => clientIds.includes(call.id)),
      );
    }
    progress = { messages: next.messages, toolRounds: progress.toolRounds + 1 };
  }
  return total === null ? TOO_MANY_ROUNDS : { ...TOO_MANY_ROUNDS, ...measuredOf(total) };
};

const measuredOf = (
  result: RoundResult,
): Pick<RoundResult, "model" | "attempts" | "usage" | "costNanoEur"> => ({
  model: result.model,
  attempts: result.attempts,
  usage: result.usage,
  costNanoEur: result.costNanoEur,
});
