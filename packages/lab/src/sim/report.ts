import {
  ACTION_KINDS,
  alikeBand,
  chooseByCost,
  diagnose,
  harmfulOf,
  kindProbabilities,
  labBars,
  scoredCause,
  ruledVariants,
  ruleOf,
  STANDARD_ACTIONS,
  STANDARD_CATALOG,
  STANDARD_POLICY,
  temper,
  type ActionKind,
  type ActionPolicy,
  type ActionRule,
  type AlikeBand,
  type Calibration,
  type LabBars,
  type LabRecalls,
  type LabRecord,
  type Reach,
  type RuledVariant,
} from "@mark1russell7/netdiag";
import type { Result } from "@mark1russell7/optional";
import { canonicalJson } from "@mark1russell7/rigor-generators";
import { bootstrapClusters, brier, wilson, type Forecast } from "@mark1russell7/rigor-statistics";
import { countOf } from "@mark1russell7/text";
import { faultsOf, faultValues, termVariant } from "../grammar.ts";
import { bandLine, labReport } from "../report.ts";
import { evidenceOfLabel, runRounds, type LabRound } from "../run.ts";
import { SIM_BANDS, simCases, type SimCase } from "./cases.ts";
import { simReach } from "./network.ts";
import { simVisit } from "./world.ts";

// The runs of the simulated world (ND-17, the layer E0). Each seed draws a new plan of cases, and each case is one
// visit of netdiag on the model. The bars come from `labBars` over the scores of the seeds.

/** The seeds of the bars and of the gates of the simulated world. `labBars` needs 5 runs or more. */
export const SIM_SEEDS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * The result of one case in one seed: the class that the score counts (refer to `scoredCause`), or the reason of a visit
 * with no read. `visits` is 1, or more when a fault passed each of its draws in a visit.
 */
export interface SimOutcome {
  readonly seed: number;
  readonly case: SimCase;
  readonly predicted: string | undefined;
  readonly reason?: string | undefined;
  readonly visits: number;
  /** The truth of the case for the actions. A case with two faults has none. */
  readonly truth?: SimTruth | undefined;
  /** The action of the case with the policy of the runs. A case with no truth has none. */
  readonly action?: SimAction | undefined;
}

/** The truth of one case for the actions: the rule of its variant, and the variants of its diagnosis with their rules. */
export interface SimTruth {
  readonly rule: ActionRule;
  /** The variants of the diagnosis, with no calibration map. A policy applies its own map to them. */
  readonly variants: readonly RuledVariant[];
}

/** The action that a policy chose for one case, the correct action of the variant of the case, and the harm. */
export interface SimAction {
  readonly taken: ActionKind;
  readonly correct: ActionKind;
  readonly harmful: boolean;
  readonly confidence: number;
  /** The probability of each kind of action after the calibration map. A kind with no variant has none. */
  readonly probabilities: Readonly<Partial<Record<ActionKind, number>>>;
}

/**
 * This function gives the truth of one case for the actions, from the evidence of its run.
 *
 * - The correct action is the action of the rule of the variant of the case: its class, its reach in the world and its degree.
 * - A class with no upstream reach takes an upstream fault as shared, because the fault changes the reference too.
 * - A case with two faults, or with a class that the catalog does not have, has no truth.
 */
export function simTruth(labCase: SimCase, evidence: readonly string[]): SimTruth | undefined {
  const hypothesis = STANDARD_CATALOG.hypotheses.find((each) => each.id === labCase.truth);
  const variant = termVariant(labCase.term, simReach);
  if (hypothesis === undefined || variant === undefined) return undefined;
  const reaches = hypothesis.reach ?? [];
  const near = (reach: Reach | undefined): Reach | undefined => {
    if (reach === undefined || reaches.length === 0 || reaches.includes(reach)) return reaches.length === 0 ? undefined : reach;
    return reach === "upstream" && reaches.includes("shared") ? "shared" : reaches[0];
  };
  const rule = ruleOf(STANDARD_ACTIONS, labCase.truth, near(variant.reach), variant.degree);
  return { rule, variants: ruledVariants(diagnose(STANDARD_CATALOG, evidence.map(evidenceOfLabel)), STANDARD_ACTIONS) };
}

/** This function gives the action of a policy for one case, with the correct action and the harm of the variant of the case. */
export function simAction(truth: SimTruth, policy: ActionPolicy): SimAction {
  const choice = chooseByCost(STANDARD_CATALOG, temper(truth.variants, policy.calibration), policy.costs);
  const taken = choice.action.kind;
  const correct = truth.rule.action.kind;
  const probabilities = Object.fromEntries(choice.kinds.filter((share) => share.probability > 0).map((share) => [share.kind, share.probability]));
  return { taken, correct, harmful: harmfulOf(STANDARD_CATALOG, truth.rule).includes(taken), confidence: choice.confidence, probabilities };
}

/** This function gives the forecast of each kind of action of a case with a calibration map. It prices no action, thus a sweep of maps is fast. */
export function truthForecasts(truth: SimTruth, calibration: Calibration): Forecast[] {
  return kindForecasts({ probabilities: kindProbabilities(temper(truth.variants, calibration)), correct: truth.rule.action.kind });
}

/** This function gives the outcomes with the actions of a different policy. The variants of the diagnoses stay. */
export function withPolicy(outcomes: readonly SimOutcome[], policy: ActionPolicy): SimOutcome[] {
  return outcomes.map((each) => (each.truth === undefined ? each : { ...each, action: simAction(each.truth, policy) }));
}

/** This function gives the forecast of each kind of action for one outcome: the probability of the kind, and if it is the correct kind. */
export function kindForecasts(action: Pick<SimAction, "probabilities" | "correct">): Forecast[] {
  return ACTION_KINDS.map((kind) => ({ p: action.probabilities[kind] ?? 0, hit: kind === action.correct }));
}

/** The runs of the seeds: the seeds, the outcome of each case, the score of each seed, the bars, the alike band and the problems. */
export interface SimRuns {
  readonly seeds: readonly number[];
  readonly outcomes: readonly SimOutcome[];
  readonly scores: readonly LabRecalls[];
  readonly bars: Result<LabBars, string[]>;
  readonly band: AlikeBand;
  readonly problems: readonly string[];
}

/** This function visits each case of the plans of the seeds, and it gives the bars of the runs and the actions of the policy. */
export async function simRuns(seeds: readonly number[] = SIM_SEEDS, policy: ActionPolicy = STANDARD_POLICY): Promise<SimRuns> {
  const scores: LabRecalls[] = [];
  const outcomes: SimOutcome[] = [];
  const problems: string[] = [];
  const records: LabRecord[] = [];
  for (const seed of seeds) {
    const cases = simCases(seed);
    const byId = new Map(cases.map((each) => [each.id, each]));
    const visits = new Map<string, number>();
    // The round of the simulated world starts no process, so `close` has no work.
    const round: LabRound<SimCase> = {
      visit: async (labCase) => {
        const result = await simVisit(labCase);
        visits.set(labCase.id, result.visits);
        return result.visit;
      },
      close: () => Promise.resolve(),
    };
    const runs = await runRounds(cases, 1, () => Promise.resolve(round), STANDARD_CATALOG);
    const report = labReport(STANDARD_CATALOG, runs, 1, cases.length);
    records.push(...report.records);
    for (const run of runs) {
      const labCase = byId.get(run.case);
      if (labCase === undefined) continue;
      const count = visits.get(run.case) ?? 1;
      if (run.status === "read") {
        const truth = simTruth(labCase, run.evidence);
        outcomes.push({ seed, case: labCase, predicted: scoredCause(run.record), visits: count, ...(truth !== undefined ? { truth, action: simAction(truth, policy) } : {}) });
      } else outcomes.push({ seed, case: labCase, predicted: undefined, reason: run.reason, visits: count });
    }
    if (report.noReads.length > 0) problems.push(`The seed ${seed} has ${countOf(report.noReads.length, "case")} with no read.`);
    for (const problem of report.problems) problems.push(`The seed ${seed}: ${problem}`);
    if (report.score !== undefined) scores.push(report.score);
  }
  const bars = labBars(scores);
  if (bars.tag === "err") problems.push(...bars.error);
  return { seeds, outcomes, scores, bars, band: alikeBand(records), problems };
}

/** The hits of one option at one place: the cases of the option at the place, and the cases with the correct class. */
export interface SimPlaceHits {
  readonly label: string;
  readonly option: string;
  readonly place: string;
  readonly hits: number;
  readonly cases: number;
}

/** The low end of the rate of correct actions, and the high end of the rate of harmful actions, of 95 % intervals to 3 places. */
export interface SimActionEnds {
  readonly correctLow: number;
  readonly harmHigh: number;
}

/** The actions of the cases of one class: the cases with an action, the correct and the harmful actions, their ends and the Brier score. */
export interface SimActionRate {
  readonly cases: number;
  readonly correct: number;
  readonly harmful: number;
  /** The ends of the Wilson intervals. Wilson takes each case as independent. */
  readonly wilson: SimActionEnds;
  /** The ends of the bootstrap intervals that draw the terms of the class again. The cases of one term are one cluster. */
  readonly bootstrap: SimActionEnds;
  /** The ends of the gate: the lower of the two low ends, and the higher of the two high ends. */
  readonly correctLow: number;
  readonly harmHigh: number;
  /** The Brier score of the probability of each kind of action, to 4 places. 0 is perfect. */
  readonly brier: number;
}

/**
 * The highest harm of a class: the high end of the gate of its harmful actions. The first limit is the worst class of
 * the first sim (10 of 400, Wilson high end 0.045) and its spread, rounded up.
 */
export const SIM_HARM_LIMIT = 0.05;

/** The number of draws of each bootstrap of the action rates. */
export const SIM_BOOTSTRAP_RUNS = 4000;

/** The seed sets of the limits of the correct low end: the gate seeds, and four sets of the seeds 6 to 25. */
export const SIM_LIMIT_SETS: readonly (readonly number[])[] = [SIM_SEEDS, ...[1, 2, 3, 4].map((set) => [1, 2, 3, 4, 5].map((seed) => set * 5 + seed))];

/** The limits of the gate of the actions, in the file `bars/action-limits.json`. The command of the sim writes it with --limits. */
export interface ActionLimits {
  /** The date when the limits were set, and the reason. */
  readonly set: string;
  readonly sets: readonly (readonly number[])[];
  /** The correct low end of each class on each limit set. */
  readonly lows: Readonly<Record<string, readonly number[]>>;
  /** The harm high end of each class on each limit set. The gate does not use it. It shows the margin to `SIM_HARM_LIMIT`. */
  readonly highs: Readonly<Record<string, readonly number[]>>;
  /** The limit of the correct low end of each class: its worst low end minus the spread of its low ends, rounded down. */
  readonly limits: Readonly<Record<string, number>>;
}

/** This function gives the limits of the gate of the actions from the action rates of each limit set. */
export function actionLimits(set: string, sets: readonly (readonly number[])[], rates: readonly Readonly<Record<string, SimActionRate>>[]): ActionLimits {
  const lows: Record<string, number[]> = {};
  const highs: Record<string, number[]> = {};
  for (const each of rates) {
    for (const [label, rate] of Object.entries(each)) {
      (lows[label] ??= []).push(rate.correctLow);
      (highs[label] ??= []).push(rate.harmHigh);
    }
  }
  const limits = Object.fromEntries(
    Object.entries(lows).map(([label, values]) => {
      const [least, most] = [Math.min(...values), Math.max(...values)];
      return [label, Math.floor((least - (most - least)) * 1000 + 1e-9) / 1000];
    }),
  );
  return { set, sets, lows, highs, limits };
}

/** This function gives the text of the file `bars/action-limits.json`. */
export function actionLimitsText(limits: ActionLimits): string {
  return `${JSON.stringify(limits, null, 2)}\n`;
}

/** This function gives a problem for each class with actions that has no limit, or a correct low end under its limit. */
export function limitProblems(rates: Readonly<Record<string, SimActionRate>>, limits: ActionLimits): readonly string[] {
  const problems: string[] = [];
  for (const [label, rate] of Object.entries(rates)) {
    const limit = limits.limits[label];
    if (limit === undefined) problems.push(`The class ${label} has no limit of the correct low end in bars/action-limits.json.`);
    else if (rate.correctLow < limit) problems.push(`The class ${label} has the correct low end ${rate.correctLow}, under its limit ${limit}.`);
  }
  return problems;
}

const third = (value: number): number => Math.round(value * 1000) / 1000;
const fourth = (value: number): number => Math.round(value * 10_000) / 10_000;
const share = (rows: readonly SimOutcome[], test: (action: SimAction) => boolean): number => rows.filter((each) => each.action !== undefined && test(each.action)).length / rows.length;
const termOf = (each: SimOutcome): string => canonicalJson(each.case.term);

/**
 * This function gives the high end of the gate of the harm of the cases of one class. It is the higher high end of a
 * Wilson interval and of a bootstrap that draws the terms again. With no harmful case, the Wilson end decides.
 */
export function harmHighOf(label: string, rows: readonly SimOutcome[]): { readonly wilson: number; readonly bootstrap: number } {
  const harmful = rows.filter((each) => each.action?.harmful === true).length;
  const high = wilson(harmful, rows.length).high;
  if (harmful === 0) return { wilson: high, bootstrap: 0 };
  const drawn = bootstrapClusters(rows, termOf, (sample) => share(sample, (action) => action.harmful), { runs: SIM_BOOTSTRAP_RUNS, level: 0.95, seed: `actions:${label}:harm` });
  return { wilson: high, bootstrap: drawn.high };
}

/** This function gives the outcomes with an action of each class, in the order of the classes. */
export function actionClasses(outcomes: readonly SimOutcome[]): readonly (readonly [string, readonly SimOutcome[]])[] {
  const groups = new Map<string, SimOutcome[]>();
  for (const each of outcomes) {
    if (each.action === undefined) continue;
    const group = groups.get(each.case.truth);
    if (group === undefined) groups.set(each.case.truth, [each]);
    else group.push(each);
  }
  return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
}

/** This function gives the action rates of each class, in the order of the classes. Only a case with an action counts. */
export function actionRates(outcomes: readonly SimOutcome[]): Readonly<Record<string, SimActionRate>> {
  const rate = (label: string, rows: readonly SimOutcome[]): SimActionRate => {
    const correct = rows.filter((each) => each.action?.taken === each.action?.correct).length;
    const harmful = rows.filter((each) => each.action?.harmful === true).length;
    const hits = bootstrapClusters(rows, termOf, (sample) => share(sample, (action) => action.taken === action.correct), { runs: SIM_BOOTSTRAP_RUNS, level: 0.95, seed: `actions:${label}:correct` });
    const harm = harmHighOf(label, rows);
    const wilsonEnds = { correctLow: third(wilson(correct, rows.length).low), harmHigh: third(harm.wilson) };
    const bootstrapEnds = { correctLow: third(hits.low), harmHigh: third(harm.bootstrap) };
    const forecasts = rows.flatMap((each) => (each.action === undefined ? [] : kindForecasts(each.action)));
    return {
      cases: rows.length,
      correct,
      harmful,
      wilson: wilsonEnds,
      bootstrap: bootstrapEnds,
      correctLow: Math.min(wilsonEnds.correctLow, bootstrapEnds.correctLow),
      harmHigh: Math.max(wilsonEnds.harmHigh, bootstrapEnds.harmHigh),
      brier: fourth(brier(forecasts)),
    };
  };
  return Object.fromEntries(actionClasses(outcomes).map(([label, rows]) => [label, rate(label, rows)]));
}

/** This function gives the text of the file `bars/actions.json`: the action rates of each class. */
export function actionsText(outcomes: readonly SimOutcome[]): string {
  return `${JSON.stringify(actionRates(outcomes), null, 2)}\n`;
}

/** This function gives the number of silent visits: the visits where a fault passed each of its draws. */
export function silentVisits(outcomes: readonly SimOutcome[]): number {
  return outcomes.reduce((sum, each) => sum + each.visits - 1, 0);
}

/** This function gives the hits of each option at each place, in the order of the class, the option and the place. */
export function placeHits(outcomes: readonly SimOutcome[]): readonly SimPlaceHits[] {
  const groups = new Map<string, { label: string; option: string; place: string; hits: number; cases: number }>();
  for (const each of outcomes) {
    for (const choice of faultsOf(each.case.term)) {
      const place = String(faultValues(choice)["place"]);
      const key = [each.case.truth, choice.option, place].join("|");
      const group = groups.get(key) ?? { label: each.case.truth, option: choice.option, place, hits: 0, cases: 0 };
      group.cases += 1;
      if (each.predicted === each.case.truth) group.hits += 1;
      groups.set(key, group);
    }
  }
  const order = (group: SimPlaceHits): string => [group.label, group.option, group.place].join("|");
  return [...groups.values()].sort((a, b) => order(a).localeCompare(order(b)));
}

const percent = (part: number, whole: number): string => (whole === 0 ? "–" : `${Math.round((100 * part) / whole)} %`);

/** This function gives the summary of the runs as Markdown: the hits of each class, the hits of each place, and the bands. */
export function simSummary(runs: SimRuns, limits?: ActionLimits): string {
  const { outcomes } = runs;
  const seeds = runs.seeds.length;
  const lines: string[] = ["# The simulated world (E0)", "", `${countOf(outcomes.length, "visit")}: ${countOf(seeds, "seed")} of ${countOf(outcomes.length / seeds, "case")}.`, ""];
  const bars = runs.bars.tag === "ok" ? runs.bars.value : {};
  lines.push(
    `A silent visit is a visit where a fault passed each of its draws. It has no sign of the fault, so the world visits the case again with a new seed. The seeds have ${countOf(silentVisits(outcomes), "silent visit")}.`,
    "",
    "| Class | Hits | Bar | Silent visits | The other answers |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const label of [...new Set(outcomes.map((each) => each.case.truth))]) {
    const mine = outcomes.filter((each) => each.case.truth === label);
    const hits = mine.filter((each) => each.predicted === label).length;
    const others = new Map<string, number>();
    for (const each of mine) {
      if (each.predicted === label) continue;
      const answer = each.predicted ?? "no read";
      others.set(answer, (others.get(answer) ?? 0) + 1);
    }
    const list = [...others].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`);
    lines.push(`| ${label} | ${percent(hits, mine.length)} | ${bars[label] ?? "–"} | ${silentVisits(mine)} | ${list.join(", ")} |`);
  }
  lines.push("", bandLine(runs.band));
  lines.push(
    "",
    "## The actions",
    "",
    "The correct action is the action of the variant of the case. A harmful action is worse than none. A case with two faults has no action.",
    "",
    "The ends are of 95 % intervals: Wilson, and a bootstrap that draws the terms of the class again. The gate takes the worse end of the two.",
    `A class with a harm high end above ${SIM_HARM_LIMIT} fails the test of the sim. The margin is ${SIM_HARM_LIMIT} minus the harm high end.`,
    "A class with a correct low end under its limit in `bars/action-limits.json` also fails the test. The Brier score is of the probability of each kind of action.",
    "",
    "| Class | Cases | Correct | Correct, low end (Wilson, bootstrap) | Its limit | Harmful | Harmful, high end (Wilson, bootstrap) | Harm margin | Brier | The other actions |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [label, rate] of Object.entries(actionRates(outcomes))) {
    const others = new Map<string, number>();
    for (const each of outcomes) {
      if (each.case.truth !== label || each.action === undefined || each.action.taken === each.action.correct) continue;
      const name = `${each.action.taken}${each.action.harmful ? " (harmful)" : ""}`;
      others.set(name, (others.get(name) ?? 0) + 1);
    }
    const list = [...others].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`);
    const ends = (gate: number, wilsonEnd: number, bootstrapEnd: number): string => `${gate} (${wilsonEnd}, ${bootstrapEnd})`;
    lines.push(
      `| ${label} | ${rate.cases} | ${percent(rate.correct, rate.cases)} | ${ends(rate.correctLow, rate.wilson.correctLow, rate.bootstrap.correctLow)} | ${limits?.limits[label] ?? "–"} | ${percent(rate.harmful, rate.cases)} | ${ends(rate.harmHigh, rate.wilson.harmHigh, rate.bootstrap.harmHigh)} | ${third(SIM_HARM_LIMIT - rate.harmHigh)} | ${rate.brier} | ${list.join(", ")} |`,
    );
  }
  lines.push("", "## The hits of each option at each place", "", "| Class | Option | Place | Hits | Cases |", "| --- | --- | --- | --- | --- |");
  for (const group of placeHits(outcomes)) lines.push(`| ${group.label} | ${group.option} | ${group.place} | ${percent(group.hits, group.cases)} | ${group.cases} |`);
  lines.push("", "## The bands", "", "| Option | Param | Range | Reason |", "| --- | --- | --- | --- |");
  for (const band of SIM_BANDS) lines.push(`| ${band.option} | ${band.param} | ${band.min.toPrecision(3)} to ${band.max.toPrecision(3)} | ${band.reason} |`);
  const noReads = outcomes.filter((each) => each.reason !== undefined).slice(0, 10);
  if (noReads.length > 0) lines.push("", "## Visits with no read", "", ...noReads.map((each) => `- ${each.case.id} (seed ${each.seed}): ${each.reason}`));
  return `${lines.join("\n")}\n`;
}

/** This function gives the text of the file `bars/sim.json`. */
export function barsText(bars: LabBars): string {
  return `${JSON.stringify(bars, null, 2)}\n`;
}
