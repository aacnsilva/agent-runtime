export interface Expectation {
  tools?: string[] | undefined;
  anyTool?: string[] | undefined;
  noTools?: string[] | undefined;
  noAnyTool?: boolean | undefined;
  contains?: string[] | undefined;
  containsAny?: string[] | undefined;
  excludes?: string[] | undefined;
  amounts?: string[] | undefined;
  excludesAmounts?: string[] | undefined;
  language?: string | undefined;
  onTopic?: boolean | undefined;
  stopReason?: string | undefined;
  maxModelCalls?: number | undefined;
  maxSeconds?: number | undefined;
}

export interface Observation {
  answer: string;
  written: string[];
  tools: string[];
  onTopic: boolean | null;
  stopReason: string | null;
  modelCalls: number;
  seconds: number;
}

export type Languages = Record<string, string>;

const LONG_LINE_CHARS = 40;
const DIACRITICS = /\p{Diacritic}/gu;

export const plain = (text: string): string =>
  text.normalize("NFD").replace(DIACRITICS, "").toLowerCase();

const amountForms = (amount: string): string[] => {
  const [whole = "", cents] = amount.replace(",", ".").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "[ ., ]?");
  const decimals = cents === undefined ? "(?:[.,]00)?" : `[.,]${cents.padEnd(2, "0")}`;
  return [`(?<![\\d.,])${grouped}${decimals}(?![\\d])`];
};

export const hasAmount = (text: string, amount: string): boolean =>
  amountForms(amount).some((form) => new RegExp(form).test(text));

const matchCount = (text: string, words: string): number =>
  (text.match(new RegExp(words, "gi")) ?? []).length;

export const languageOf = (line: string, languages: Languages): string | null => {
  const scored = Object.entries(languages)
    .map(([id, words]) => ({ id, score: matchCount(line, words) }))
    .sort((left, right) => right.score - left.score);
  const [best, next] = scored;
  return best !== undefined && best.score > (next?.score ?? 0) ? best.id : null;
};

type Check = (expect: Expectation, seen: Observation, languages: Languages) => string[];

const each = (
  items: readonly string[] | undefined,
  failed: (item: string) => boolean,
  say: (item: string) => string,
): string[] => (items ?? []).filter(failed).map(say);

const checkTools: Check = (expect, seen) => [
  ...each(
    expect.tools,
    (tool) => !seen.tools.includes(tool),
    (tool) => `did not call ${tool}`,
  ),
  ...each(
    expect.noTools,
    (tool) => seen.tools.includes(tool),
    (tool) => `called ${tool}`,
  ),
  ...(expect.anyTool !== undefined && !expect.anyTool.some((tool) => seen.tools.includes(tool))
    ? [`called none of ${expect.anyTool.join(", ")}`]
    : []),
  ...(expect.noAnyTool === true && seen.tools.length > 0
    ? [`called ${seen.tools.join(", ")} but should call no tool`]
    : []),
];

const checkText: Check = (expect, seen) => {
  const answer = plain(seen.answer);
  const has = (text: string): boolean => answer.includes(plain(text));
  return [
    ...each(
      expect.contains,
      (text) => !has(text),
      (text) => `answer lacks "${text}"`,
    ),
    ...each(expect.excludes, has, (text) => `answer has "${text}"`),
    ...(expect.containsAny !== undefined && !expect.containsAny.some(has)
      ? [`answer has none of ${expect.containsAny.map((text) => `"${text}"`).join(", ")}`]
      : []),
  ];
};

const checkAmounts: Check = (expect, seen) => [
  ...each(
    expect.amounts,
    (amount) => !hasAmount(seen.answer, amount),
    (amount) => `answer lacks the amount ${amount}`,
  ),
  ...each(
    expect.excludesAmounts,
    (amount) => hasAmount(seen.answer, amount),
    (amount) => `answer has the amount ${amount}`,
  ),
];

const checkLanguage: Check = (expect, seen, languages) => {
  const wanted = expect.language;
  if (wanted === undefined) {
    return [];
  }
  return seen.written
    .flatMap((text) => text.split("\n"))
    .filter((line) => line.trim().length >= LONG_LINE_CHARS)
    .filter((line) => {
      const written = languageOf(line, languages);
      return written !== null && written !== wanted;
    })
    .map((line) => `a line is not in ${wanted}: "${line.trim().slice(0, 60)}"`);
};

const checkShape: Check = (expect, seen) => [
  ...(expect.onTopic !== undefined && seen.onTopic !== expect.onTopic
    ? [`onTopic was ${String(seen.onTopic)}, expected ${String(expect.onTopic)}`]
    : []),
  ...(expect.stopReason !== undefined && seen.stopReason !== expect.stopReason
    ? [`stopped with ${String(seen.stopReason)}, expected ${expect.stopReason}`]
    : []),
  ...(expect.maxModelCalls !== undefined && seen.modelCalls > expect.maxModelCalls
    ? [`took ${String(seen.modelCalls)} model calls, more than ${String(expect.maxModelCalls)}`]
    : []),
  ...(expect.maxSeconds !== undefined && seen.seconds > expect.maxSeconds
    ? [`took ${seen.seconds.toFixed(1)} s, more than ${String(expect.maxSeconds)} s`]
    : []),
];

const CHECKS: readonly Check[] = [checkTools, checkText, checkAmounts, checkLanguage, checkShape];

export const grade = (
  expect: Expectation,
  seen: Observation,
  languages: Languages = {},
): string[] => CHECKS.flatMap((check) => check(expect, seen, languages));

export interface CaseResult {
  id: string;
  group: string;
  passed: boolean;
}

export interface BaselineDiff {
  nowFailing: string[];
  nowPassing: string[];
  added: string[];
}

export const compareToBaseline = (
  results: readonly CaseResult[],
  baseline: readonly CaseResult[],
): BaselineDiff => {
  const before = new Map(baseline.map((result) => [result.id, result.passed]));
  return {
    nowFailing: results
      .filter((result) => before.get(result.id) === true && !result.passed)
      .map((result) => result.id),
    nowPassing: results
      .filter((result) => before.get(result.id) === false && result.passed)
      .map((result) => result.id),
    added: results.filter((result) => !before.has(result.id)).map((result) => result.id),
  };
};

export const byGroup = (
  results: readonly CaseResult[],
): Record<string, { cases: number; passed: number }> => {
  const groups: Record<string, { cases: number; passed: number }> = {};
  for (const result of results) {
    const group = (groups[result.group] ??= { cases: 0, passed: 0 });
    group.cases += 1;
    group.passed += result.passed ? 1 : 0;
  }
  return groups;
};
