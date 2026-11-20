import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { EvalCase, Suite } from "./cases.ts";
import { loadSuite, selectCases } from "./cases.ts";
import type { Played, Target } from "./drive.ts";
import { playCase } from "./drive.ts";
import type { CaseResult } from "./grade.ts";
import { byGroup, compareToBaseline, grade } from "./grade.ts";

interface Outcome extends CaseResult {
  runs: number;
  passes: number;
  failures: string[];
  error: string | null;
  answer: string;
  tools: string[];
  modelCalls: number;
  seconds: number;
  costEur: number;
}

interface Options {
  suite: Suite;
  target: Target;
  runs: number;
  parallel: number;
}

const USAGE = `Usage: EVAL_SECRET=... npm run evals -- --runtime <url> --tenant <id> --cases <file>
  --only <group or case id>   run part of the suite
  --runs <n>                  play each case n times; it passes only if every run does
  --tier <tier>               grade another model tier the tenant allows for evals
  --effort <effort>           grade another effort the tenant allows for evals
  --parallel <n>              cases at once (default 4)
  --save-baseline             keep this run as results/baseline.json next to the cases file`;

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const once = async (options: Options, entry: EvalCase, repeat: number): Promise<Played> => {
  const target = { ...options.target, runId: `${options.target.runId}-r${String(repeat)}` };
  try {
    return await playCase(options.suite, entry, target);
  } catch {
    return playCase(options.suite, entry, { ...target, runId: `${target.runId}-retry` });
  }
};

const emptyOutcome = (entry: EvalCase, runs: number): Outcome => ({
  id: entry.id,
  group: entry.group,
  passed: false,
  runs,
  passes: 0,
  failures: [],
  error: null,
  answer: "",
  tools: [],
  modelCalls: 0,
  seconds: 0,
  costEur: 0,
});

const runCase = async (options: Options, entry: EvalCase): Promise<Outcome> => {
  const outcome = emptyOutcome(entry, options.runs);
  for (let repeat = 1; repeat <= options.runs; repeat += 1) {
    try {
      const played = await once(options, entry, repeat);
      const failures = grade(entry.expect, played, options.suite.languages);
      outcome.passes += failures.length === 0 ? 1 : 0;
      outcome.failures = outcome.failures.length === 0 ? failures : outcome.failures;
      outcome.answer = played.answer;
      outcome.tools = [...new Set(played.tools)];
      outcome.modelCalls += played.modelCalls;
      outcome.seconds = Math.round(played.seconds * 10) / 10;
      outcome.costEur += played.costNanoEur / 1e9;
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : "could not run";
    }
  }
  return { ...outcome, passed: outcome.error === null && outcome.passes === options.runs };
};

const runAll = async (options: Options, cases: readonly EvalCase[]): Promise<Outcome[]> => {
  const outcomes = new Array<Outcome>(cases.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < cases.length; index = next++) {
      const entry = cases[index];
      if (entry !== undefined) {
        outcomes[index] = await runCase(options, entry);
      }
    }
  };
  await Promise.all(Array.from({ length: options.parallel }, worker));
  return outcomes;
};

const readBaseline = async (path: string): Promise<CaseResult[] | null> => {
  try {
    const stored = JSON.parse(await readFile(path, "utf8")) as { results: CaseResult[] };
    return stored.results;
  } catch {
    return null;
  }
};

const report = (outcomes: readonly Outcome[], baseline: readonly CaseResult[] | null): void => {
  for (const [group, counts] of Object.entries(byGroup(outcomes))) {
    say(`${group.padEnd(20)} ${String(counts.passed)}/${String(counts.cases)}`);
  }
  for (const outcome of outcomes.filter((entry) => !entry.passed)) {
    const reason =
      outcome.error === null ? outcome.failures.join("; ") : `could not run: ${outcome.error}`;
    say(`FAIL ${outcome.id}: ${reason}`);
  }
  if (baseline !== null) {
    const diff = compareToBaseline(outcomes, baseline);
    say(
      `Against the baseline: ${String(diff.nowFailing.length)} now failing, ${String(diff.nowPassing.length)} now passing, ${String(diff.added.length)} new.`,
    );
    for (const id of diff.nowFailing) {
      say(`  now failing: ${id}`);
    }
  }
};

const summaryOf = (outcomes: readonly Outcome[], target: Target): Record<string, unknown> => ({
  runId: target.runId,
  runtime: target.runtime,
  tenant: target.tenant,
  tier: target.tier ?? null,
  effort: target.effort ?? null,
  cases: outcomes.length,
  passed: outcomes.filter((outcome) => outcome.passed).length,
  errors: outcomes.filter((outcome) => outcome.error !== null).length,
  modelCalls: outcomes.reduce((total, outcome) => total + outcome.modelCalls, 0),
  costEur: Number(outcomes.reduce((total, outcome) => total + outcome.costEur, 0).toFixed(6)),
  groups: byGroup(outcomes),
  results: outcomes,
});

const main = async (): Promise<number> => {
  const { values } = parseArgs({
    options: {
      runtime: { type: "string" },
      tenant: { type: "string" },
      cases: { type: "string" },
      only: { type: "string" },
      runs: { type: "string", default: "1" },
      tier: { type: "string" },
      effort: { type: "string" },
      parallel: { type: "string", default: "4" },
      "save-baseline": { type: "boolean", default: false },
    },
  });
  const secret = process.env["EVAL_SECRET"] ?? "";
  if (
    values.runtime === undefined ||
    values.tenant === undefined ||
    values.cases === undefined ||
    secret === ""
  ) {
    say(USAGE);
    return 2;
  }
  const casesPath = resolve(values.cases);
  const suite = await loadSuite(casesPath);
  const cases = selectCases(suite, values.only);
  const target: Target = {
    runtime: values.runtime.replace(/\/$/, ""),
    tenant: values.tenant,
    secret,
    runId: new Date().toISOString().replace(/\D/g, "").slice(0, 14),
    tier: values.tier,
    effort: values.effort,
  };
  const options = {
    suite,
    target,
    runs: Math.max(1, Number(values.runs)),
    parallel: Math.max(1, Number(values.parallel)),
  };
  const outcomes = await runAll(options, cases);
  const results = join(dirname(casesPath), "results");
  const baselinePath = join(results, "baseline.json");
  report(outcomes, await readBaseline(baselinePath));
  const summary = summaryOf(outcomes, target);
  await mkdir(results, { recursive: true });
  await writeFile(join(results, "latest.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (values["save-baseline"]) {
    await writeFile(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
  }
  say(
    `${String(summary["passed"])}/${String(outcomes.length)} passed, ${String(summary["modelCalls"])} model calls, €${String(summary["costEur"])}.`,
  );
  return outcomes.every((outcome) => outcome.passed) ? 0 : 1;
};

process.exitCode = await main();
