import type { EvalCase, Suite } from "./cases.ts";
import type { Observation } from "./grade.ts";

export interface Target {
  runtime: string;
  tenant: string;
  secret: string;
  runId: string;
  tier: string | undefined;
  effort: string | undefined;
}

export interface Played extends Observation {
  costNanoEur: number;
}

type Json = Record<string, unknown>;

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
}

interface Reply {
  answer?: string;
  onTopic?: boolean;
  stopReason?: string;
  sessionId?: string;
  content?: Block[];
  error?: string;
  eval?: { modelCalls: number; tools: string[]; costNanoEur: number };
}

interface Progress {
  played: Played;
  history: Json[];
  sessionId: string | undefined;
}

const MAX_ROUNDS = 12;
const DEFAULT_TOOL_RESULT = "ok";

const headersFor = (target: Target, caseId: string): Record<string, string> => ({
  "content-type": "application/json",
  "x-eval-secret": target.secret,
  "x-eval-run": `${target.runId}-${caseId}`,
  ...(target.tier === undefined ? {} : { "x-eval-tier": target.tier }),
  ...(target.effort === undefined ? {} : { "x-eval-effort": target.effort }),
});

const send = async (target: Target, caseId: string, body: Json): Promise<Reply> => {
  const response = await fetch(`${target.runtime}/v1/tenants/${target.tenant}/runs`, {
    method: "POST",
    headers: headersFor(target, caseId),
    body: JSON.stringify(body),
  });
  const reply = (await response.json()) as Reply;
  if (!response.ok) {
    throw new Error(`the runtime answered ${String(response.status)} ${reply.error ?? ""}`.trim());
  }
  return reply;
};

const recordText = (played: Played, reply: Reply): void => {
  const texts = (reply.content ?? []).flatMap((block) =>
    block.text === undefined ? [] : [block.text],
  );
  const written = reply.answer === undefined ? texts : [reply.answer];
  played.written.push(...written);
  played.answer = written.length === 0 ? played.answer : written.join("\n");
};

const record = (progress: Progress, reply: Reply): void => {
  const { played } = progress;
  recordText(played, reply);
  played.onTopic = reply.onTopic ?? played.onTopic;
  played.stopReason = reply.stopReason ?? played.stopReason;
  if (reply.eval !== undefined) {
    played.modelCalls += reply.eval.modelCalls;
    played.costNanoEur += reply.eval.costNanoEur;
    played.tools.push(...reply.eval.tools);
  }
};

const resultsFor = (suite: Suite, entry: EvalCase, reply: Reply): Json[] =>
  (reply.content ?? [])
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      type: "tool_result",
      tool_use_id: block.id,
      content:
        entry.toolResults?.[block.name ?? ""] ??
        suite.toolResults[block.name ?? ""] ??
        DEFAULT_TOOL_RESULT,
    }));

type Ask = (question: string) => Promise<void>;

interface Play {
  suite: Suite;
  entry: EvalCase;
  target: Target;
  progress: Progress;
}

const frame = (play: Play): Json => ({
  contractVersion: play.suite.contractVersion,
  context: { ...play.suite.context, ...play.entry.context },
});

const askGated =
  (play: Play): Ask =>
  async (question) => {
    const { progress } = play;
    progress.history.push({ role: "user", content: question });
    const reply = await send(play.target, play.entry.id, { messages: progress.history });
    record(progress, reply);
    progress.history.push({ role: "assistant", content: reply.answer ?? "" });
  };

const untilAnswered = async (
  play: Play,
  first: Reply,
  next: (reply: Reply) => Promise<Reply>,
): Promise<Reply> => {
  let reply = first;
  for (let round = 0; reply.stopReason === "tool_use"; round += 1) {
    if (round >= MAX_ROUNDS) {
      throw new Error("the conversation did not finish");
    }
    record(play.progress, reply);
    reply = await next(reply);
  }
  record(play.progress, reply);
  return reply;
};

const askStored =
  (play: Play): Ask =>
  async (question) => {
    const { progress, target, entry, suite } = play;
    const post = async (body: Json): Promise<Reply> => {
      const reply = await send(target, entry.id, {
        ...frame(play),
        sessionId: progress.sessionId,
        ...body,
      });
      progress.sessionId = reply.sessionId ?? progress.sessionId;
      return reply;
    };
    await untilAnswered(play, await post({ message: question }), async (reply) =>
      post({ toolResults: resultsFor(suite, entry, reply) }),
    );
  };

const askStateless =
  (play: Play): Ask =>
  async (question) => {
    const { progress, target, entry, suite } = play;
    const post = async (): Promise<Reply> =>
      send(target, entry.id, { ...frame(play), messages: progress.history });
    progress.history.push({ role: "user", content: question });
    const last = await untilAnswered(play, await post(), async (reply) => {
      progress.history.push({ role: "assistant", content: reply.content ?? [] });
      progress.history.push({ role: "user", content: resultsFor(suite, entry, reply) });
      return post();
    });
    progress.history.push({ role: "assistant", content: last.content ?? [] });
  };

const ASKERS = { gated: askGated, stored: askStored, stateless: askStateless };

export const playCase = async (suite: Suite, entry: EvalCase, target: Target): Promise<Played> => {
  const startedAt = performance.now();
  const progress: Progress = {
    history: [],
    sessionId: undefined,
    played: {
      answer: "",
      written: [],
      tools: [],
      onTopic: null,
      stopReason: null,
      modelCalls: 0,
      seconds: 0,
      costNanoEur: 0,
    },
  };
  const ask = ASKERS[suite.agent]({ suite, entry, target, progress });
  for (const question of entry.questions) {
    await ask(question);
  }
  return { ...progress.played, seconds: (performance.now() - startedAt) / 1000 };
};
