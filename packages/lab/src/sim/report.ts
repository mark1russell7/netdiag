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
  type Catalog,
  type LabBars,
  type LabRecalls,
  type LabRecord,
  type Reach,
  type RuledVariant,
} from "@mark1russell7/netdiag";
import type { Result } from "@mark1russell7/optional";
import { canonicalJson } from "@mark1russell7/rigor-generators";
import { bootstrapClusters, brier, calibrationError, reliabilityTest, wilson, type Forecast, type TestedBin } from "@mark1russell7/rigor-statistics";
import { countOf } from "@mark1russell7/text";
import { faultClass, faultsOf, faultValues, NO_FAULT, termVariant } from "../grammar.ts";
import { bandLine, labReport } from "../report.ts";
import { evidenceOfLabel, runRounds, type CaseRun, type LabRound } from "../run.ts";
import { SIM_BANDS, SIM_HISTORY_SHARES, simCases, type SimCase } from "./cases.ts";
import { gapOf, SIM_GAPS, type SimGap } from "./gaps.ts";
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
  /** The labels of the evidence of a case with a read, `feature=value@role`, with each repeat. */
  readonly evidence?: readonly string[] | undefined;
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

/** The variant of the catalog for one case: its class, its reach and its degree, and the number of its faults. */
export interface CaseVariant {
  readonly hypothesis: string;
  readonly reach: Reach | undefined;
  readonly degree: string | undefined;
  readonly faults: number;
}

/**
 * This function gives the variant of the catalog for one case: its class, its reach in the world and its degree.
 *
 * - A class with no upstream reach takes an upstream fault as shared, because the fault changes the reference too.
 * - A case with two faults gives the variant of the fault that decides, or no variant.
 * - A case with a class that the catalog does not have gives no variant.
 */
export function caseVariant(labCase: SimCase, catalog: Catalog = STANDARD_CATALOG): CaseVariant | undefined {
  const hypothesis = catalog.hypotheses.find((each) => each.id === labCase.truth);
  const variant = termVariant(labCase.term, simReach);
  if (hypothesis === undefined || variant === undefined) return undefined;
  const reaches = hypothesis.reach ?? [];
  const near = (reach: Reach | undefined): Reach | undefined => {
    if (reach === undefined || reaches.length === 0 || reaches.includes(reach)) return reaches.length === 0 ? undefined : reach;
    return reach === "upstream" && reaches.includes("shared") ? "shared" : reaches[0];
  };
  const faults = faultsOf(labCase.term).filter((choice) => faultClass(choice) !== NO_FAULT).length;
  return { hypothesis: hypothesis.id, reach: near(variant.reach), degree: variant.degree, faults };
}

/**
 * This function gives the truth of one case for the actions, from the evidence of its run.
 *
 * - The correct action is the action of the rule of the variant of the case (`caseVariant`).
 * - A case with no variant has no truth.
 */
export function simTruth(labCase: SimCase, evidence: readonly string[], catalog: Catalog = STANDARD_CATALOG): SimTruth | undefined {
  const variant = caseVariant(labCase, catalog);
  if (variant === undefined) return undefined;
  const rule = ruleOf(STANDARD_ACTIONS, labCase.truth, variant.reach, variant.degree);
  return { rule, variants: ruledVariants(diagnose(catalog, evidence.map(evidenceOfLabel)), STANDARD_ACTIONS) };
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

/**
 * This function gives the outcomes with the diagnoses of a different catalog, from the evidence of each outcome, and the
 * actions of a policy. The class that the classifier of the run predicted stays.
 */
export function withCatalog(outcomes: readonly SimOutcome[], catalog: Catalog, policy: ActionPolicy = STANDARD_POLICY): SimOutcome[] {
  return outcomes.map((each) => {
    if (each.evidence === undefined || each.truth === undefined) return each;
    const truth = simTruth(each.case, each.evidence, catalog);
    return truth === undefined ? each : { ...each, truth, action: simAction(truth, policy) };
  });
}

/** This function gives the outcomes with the actions of a different policy. The variants of the diagnoses stay. */
export function withPolicy(outcomes: readonly SimOutcome[], policy: ActionPolicy): SimOutcome[] {
  return outcomes.map((each) => (each.truth === undefined ? each : { ...each, action: simAction(each.truth, policy) }));
}

/** This function gives the forecast of each kind of action for one outcome: the probability of the kind, and if it is the correct kind. */
export function kindForecasts(action: Pick<SimAction, "probabilities" | "correct">): Forecast[] {
  return ACTION_KINDS.map((kind) => ({ p: action.probabilities[kind] ?? 0, hit: kind === action.correct }));
}

/** The runs of the cases of one known gap: the score of each seed, and the bars of the gap. */
export interface SimGapRuns {
  readonly gap: SimGap;
  readonly scores: readonly LabRecalls[];
  readonly bars: Result<LabBars, string[]>;
}

/**
 * The runs of the seeds: the seeds, the outcome of each case, the score of each seed, the bars, the alike band and the problems. The
 * scores and the bars are of the cases in no known gap. `gaps` has the scores and the bars of each known gap.
 */
export interface SimRuns {
  readonly seeds: readonly number[];
  readonly outcomes: readonly SimOutcome[];
  readonly scores: readonly LabRecalls[];
  readonly bars: Result<LabBars, string[]>;
  readonly band: AlikeBand;
  readonly gaps: readonly SimGapRuns[];
  readonly problems: readonly string[];
}

/**
 * This function gives a problem for each known gap whose bar got to the bar of its class. Such a gap is closed, so remove
 * it from `SIM_GAPS`.
 */
export function closedGaps(bars: Result<LabBars, string[]>, gaps: readonly SimGapRuns[]): readonly string[] {
  if (bars.tag === "err") return [];
  const problems: string[] = [];
  for (const each of gaps) {
    if (each.bars.tag === "err") continue;
    const bar = each.bars.value[each.gap.label];
    const classBar = bars.value[each.gap.label];
    if (bar !== undefined && classBar !== undefined && bar >= classBar) {
      problems.push(`The gap ${each.gap.id} is closed: its bar ${bar} is at the bar ${classBar} of its class or over it. Remove it from SIM_GAPS.`);
    }
  }
  return problems;
}

/** This function visits each case of the plans of the seeds, and it gives the bars of the runs and the actions of the policy. */
export async function simRuns(seeds: readonly number[] = SIM_SEEDS, policy: ActionPolicy = STANDARD_POLICY, catalog: Catalog = STANDARD_CATALOG): Promise<SimRuns> {
  const scores: LabRecalls[] = [];
  const gapScores = new Map<SimGap, LabRecalls[]>(SIM_GAPS.map((gap) => [gap, []]));
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
    const runs = await runRounds(cases, 1, () => Promise.resolve(round), catalog);
    // The cases of a known gap have a score of their own, so that the bars of the other cases keep their gains.
    const gapOfRun = (run: CaseRun): SimGap | undefined => {
      const labCase = byId.get(run.case);
      return labCase === undefined ? undefined : gapOf(labCase);
    };
    const outside = runs.filter((run) => gapOfRun(run) === undefined);
    const report = labReport(catalog, outside, 1, outside.length);
    records.push(...report.records);
    for (const run of runs) {
      const labCase = byId.get(run.case);
      if (labCase === undefined) continue;
      const count = visits.get(run.case) ?? 1;
      if (run.status === "read") {
        const truth = simTruth(labCase, run.evidence, catalog);
        outcomes.push({ seed, case: labCase, predicted: scoredCause(run.record), visits: count, evidence: run.evidence, ...(truth !== undefined ? { truth, action: simAction(truth, policy) } : {}) });
      } else outcomes.push({ seed, case: labCase, predicted: undefined, reason: run.reason, visits: count });
    }
    const noReads = runs.filter((run) => run.status === "no-read").length;
    if (noReads > 0) problems.push(`The seed ${seed} has ${countOf(noReads, "case")} with no read.`);
    for (const problem of report.problems) problems.push(`The seed ${seed}: ${problem}`);
    if (report.score !== undefined) scores.push(report.score);
    for (const [gap, list] of gapScores) {
      const mine = runs.filter((run) => gapOfRun(run) === gap);
      if (mine.length === 0) continue;
      const each = labReport(catalog, mine, 1, mine.length);
      records.push(...each.records);
      for (const problem of each.problems) problems.push(`The seed ${seed}, the gap ${gap.id}: ${problem}`);
      if (each.score !== undefined) list.push(each.score);
    }
  }
  const bars = labBars(scores);
  if (bars.tag === "err") problems.push(...bars.error);
  const gaps = [...gapScores].map(([gap, list]) => ({ gap, scores: list, bars: labBars(list) }));
  for (const each of gaps) if (each.bars.tag === "err") problems.push(...each.bars.error.map((problem) => `The gap ${each.gap.id}: ${problem}`));
  problems.push(...closedGaps(bars, gaps));
  return { seeds, outcomes, scores, bars, gaps, band: alikeBand(records), problems };
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
  /** The cases of the class with an action. The harmful actions and their ends are of these cases. */
  readonly cases: number;
  /**
   * The cases outside the known gaps. The correct actions and their ends are of these cases. A case of a gap has the facts
   * of a case of a different class, thus no action is correct for the two.
   */
  readonly counted: number;
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

/** The number of bins of the reliability table and of the calibration errors of the actions. */
export const SIM_CALIBRATION_BINS = 10;

/** A top-label forecast under this probability is unsure. The near-certain cases above it dilute the pooled error. */
export const SIM_UNSURE_BELOW = 0.9;

/** A bin of the top label with this count of cases or more gets a calibration test. */
export const SIM_BIN_TEST_COUNT = 30;

/** The level of the family of the bin tests. The Holm correction over the tested bins holds it. */
export const SIM_BIN_TEST_LEVEL = 0.05;

/** A bin of the top label that fails its calibration test, with its cause and its end. */
export interface UncalibratedBin {
  /** The low end of the bin, a multiple of 1 / `SIM_CALIBRATION_BINS`. */
  readonly low: number;
  readonly cause: string;
  readonly end: string;
}

/**
 * The bins of the top label that fail their calibration test on the gate seeds. The gate fails on each other bin that
 * fails. It also fails when a bin of this list passes, thus the list stays current.
 */
export const SIM_UNCALIBRATED_BINS: readonly UncalibratedBin[] = [
  {
    low: 0.5,
    cause: "The calibration map states a higher probability than the hit rate of these cases.",
    end: "The fix of the calibration map in ND-18. The fix comes before the probe of the most information.",
  },
  {
    low: 0.9,
    cause: "The calibration map states a lower probability than the hit rate of the near-certain cases.",
    end: "The fix of the calibration map in ND-18. The fix comes before the probe of the most information.",
  },
];

/** The names of the calibration errors that the gate holds. */
export const SIM_CALIBRATION_ERRORS = ["top", "kinds", "unsure"] as const;

/** The name of one calibration error that the gate holds. */
export type SimCalibrationError = (typeof SIM_CALIBRATION_ERRORS)[number];

const ERROR_TEXT: Readonly<Record<SimCalibrationError, string>> = {
  top: "top-label calibration error",
  kinds: "kind calibration error",
  unsure: "calibration error of the unsure cases",
};

/**
 * The calibration of the actions of all cases with an action. The three errors are expected calibration errors to 4
 * places. The forecasts of one class are not calibrated by design, because the class is a part of the truth.
 */
export interface SimCalibration {
  readonly cases: number;
  /** The error of the top label: the probability of the chosen kind, and if that kind is correct. */
  readonly top: number;
  /** The error of the kind forecasts: one for each kind of each case, as for the Brier score. */
  readonly kinds: number;
  /** The number of cases with a top-label probability under `SIM_UNSURE_BELOW`. */
  readonly unsureCases: number;
  /** The error of the top label of the unsure cases only. With no unsure case, it is 0. */
  readonly unsure: number;
  /** The reliability bins of the top label, each with its calibration test. */
  readonly bins: readonly TestedBin[];
}

/** This function gives the top-label forecast of an action: the probability of the chosen kind, and if that kind is correct. */
export function topForecast(action: Pick<SimAction, "confidence" | "taken" | "correct">): Forecast {
  return { p: action.confidence, hit: action.taken === action.correct };
}

/** This function gives the calibration of the actions of the outcomes. With no action, the errors are 0 and the table is empty. */
export function actionCalibration(outcomes: readonly SimOutcome[]): SimCalibration {
  const acted = outcomes.flatMap((each) => (each.action === undefined ? [] : [each.action]));
  if (acted.length === 0) return { cases: 0, top: 0, kinds: 0, unsureCases: 0, unsure: 0, bins: [] };
  const top = acted.map(topForecast);
  const kinds = acted.flatMap(kindForecasts);
  const unsure = top.filter((each) => each.p < SIM_UNSURE_BELOW);
  const options = { bins: SIM_CALIBRATION_BINS };
  const tested = reliabilityTest(top, { ...options, minCount: SIM_BIN_TEST_COUNT, level: SIM_BIN_TEST_LEVEL });
  const bins = tested.map(({ p, adjusted, ...bin }) => ({
    ...bin,
    stated: fourth(bin.stated),
    rate: fourth(bin.rate),
    interval: { ...bin.interval, low: fourth(bin.interval.low), high: fourth(bin.interval.high) },
    ...(p === undefined || adjusted === undefined ? {} : { p: digits(p), adjusted: digits(adjusted) }),
  }));
  return {
    cases: acted.length,
    top: fourth(calibrationError(top, options)),
    kinds: fourth(calibrationError(kinds, options)),
    unsureCases: unsure.length,
    unsure: unsure.length === 0 ? 0 : fourth(calibrationError(unsure, options)),
    bins,
  };
}

/** This function gives the outcomes of the cases in no known gap. */
export function outsideGaps(outcomes: readonly SimOutcome[]): readonly SimOutcome[] {
  return outcomes.filter((each) => gapOf(each.case) === undefined);
}

/** This function gives the calibration that the gate examines: the calibration of the actions of the cases in no known gap. */
export function gateCalibration(outcomes: readonly SimOutcome[]): SimCalibration {
  return actionCalibration(outsideGaps(outcomes));
}

/** This function gives the text of the file `bars/calibration.json`: the calibration that the gate examines. */
export function calibrationText(outcomes: readonly SimOutcome[]): string {
  return `${JSON.stringify(gateCalibration(outcomes), null, 2)}\n`;
}

/**
 * This function gives the text of the file `bars/sim-gaps.json`. It has each known gap with its rule and its twin. It
 * also has the cause, the end, the count of cases, the bars and the calibration of the gap.
 */
export function gapsText(runs: SimRuns): string {
  const gaps = runs.gaps.map(({ gap, bars }) => {
    const mine = runs.outcomes.filter((each) => gapOf(each.case) === gap);
    const calibration = actionCalibration(mine);
    return {
      id: gap.id,
      label: gap.label,
      option: gap.option,
      when: gap.when ?? {},
      histories: gap.histories ?? Object.keys(SIM_HISTORY_SHARES),
      twin: gap.twin,
      cause: gap.cause,
      end: gap.end,
      cases: mine.length,
      hits: mine.filter((each) => each.predicted === gap.label).length,
      bars: bars.tag === "ok" ? bars.value : {},
      calibration: { cases: calibration.cases, top: calibration.top, kinds: calibration.kinds },
    };
  });
  return `${JSON.stringify(gaps, null, 2)}\n`;
}

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
  /** The number of unsure cases on each limit set. */
  readonly unsureCases: readonly number[];
  /** The calibration errors of the actions on each limit set. */
  readonly errors: Readonly<Record<SimCalibrationError, readonly number[]>>;
  /** The limit of each calibration error: the highest error plus the spread of the errors, rounded up to 4 places. */
  readonly errorLimits: Readonly<Record<SimCalibrationError, number>>;
}

/** This function gives the limits of the gate of the actions from the action rates of each limit set. */
export function actionLimits(set: string, sets: readonly (readonly number[])[], rates: readonly Readonly<Record<string, SimActionRate>>[], calibrations: readonly SimCalibration[]): ActionLimits {
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
  const upper = (values: readonly number[]): number => {
    const [least, most] = [Math.min(...values), Math.max(...values)];
    return Math.ceil((most + (most - least)) * 10_000 - 1e-9) / 10_000;
  };
  const errors = Object.fromEntries(SIM_CALIBRATION_ERRORS.map((name) => [name, calibrations.map((each) => each[name])])) as Record<SimCalibrationError, number[]>;
  const errorLimits = Object.fromEntries(SIM_CALIBRATION_ERRORS.map((name) => [name, upper(errors[name])])) as Record<SimCalibrationError, number>;
  return { set, sets, lows, highs, limits, unsureCases: calibrations.map((each) => each.unsureCases), errors, errorLimits };
}

/** This function gives the text of the file `bars/action-limits.json`. */
export function actionLimitsText(limits: ActionLimits): string {
  return `${JSON.stringify(limits, null, 2)}\n`;
}

/**
 * This function gives a problem for each class with actions that has no limit, or a correct low end under its limit. It
 * also gives a problem for a calibration error over its limit, and for runs with no action.
 */
export function limitProblems(rates: Readonly<Record<string, SimActionRate>>, calibration: SimCalibration, limits: ActionLimits): readonly string[] {
  const problems: string[] = [];
  if (calibration.cases === 0) problems.push("The runs have no case with an action, thus the gate has no calibration to examine.");
  for (const name of SIM_CALIBRATION_ERRORS) {
    const limit = limits.errorLimits[name];
    if (limit === undefined) problems.push(`The ${ERROR_TEXT[name]} has no limit in bars/action-limits.json.`);
    else if (calibration[name] > limit) problems.push(`The ${ERROR_TEXT[name]} is ${calibration[name]}, over its limit ${limit}.`);
  }
  for (const [label, rate] of Object.entries(rates)) {
    if (rate.counted === 0) {
      problems.push(`The class ${label} has no case outside the known gaps, thus the gate has no correct actions to examine.`);
      continue;
    }
    const limit = limits.limits[label];
    if (limit === undefined) problems.push(`The class ${label} has no limit of the correct low end in bars/action-limits.json.`);
    else if (rate.correctLow < limit) problems.push(`The class ${label} has the correct low end ${rate.correctLow}, under its limit ${limit}.`);
  }
  return problems;
}

/** This function gives the text of a bin of the top label, for example "0.5 to 0.6". */
function binText(bin: Pick<TestedBin, "low" | "high">): string {
  return `${bin.low.toFixed(1)} to ${bin.high.toFixed(1)}`;
}

/**
 * This function gives a problem for each bin of the top label that fails its calibration test and is not a known bin.
 * It also gives a problem for each known bin that does not fail.
 */
export function binProblems(calibration: SimCalibration, known: readonly UncalibratedBin[] = SIM_UNCALIBRATED_BINS): readonly string[] {
  const isKnown = (bin: TestedBin): boolean => known.some((each) => each.low === bin.low);
  const problems = calibration.bins
    .filter((bin) => bin.reject && !isKnown(bin))
    .map((bin) => `The top-label bin ${binText(bin)} fails its calibration test: ${bin.n} cases state ${bin.stated} and hit at ${bin.rate}, with the adjusted p ${bin.adjusted}.`);
  for (const each of known) {
    if (calibration.bins.some((bin) => bin.low === each.low && bin.reject)) continue;
    problems.push(`The top-label bin from ${each.low.toFixed(1)} passes its calibration test, or has no test. Remove it from SIM_UNCALIBRATED_BINS.`);
  }
  return problems;
}

const third = (value: number): number => Math.round(value * 1000) / 1000;
const fourth = (value: number): number => Math.round(value * 10_000) / 10_000;
/** This function gives a value with 4 significant digits. A p value of a large bin is too small for 4 places. */
const digits = (value: number): number => Number(value.toPrecision(4));
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

/**
 * This function gives the low end of the gate of the correct actions of the cases of one class. It is the lower low end
 * of a Wilson interval and of a bootstrap that draws the terms again.
 */
export function correctLowOf(label: string, rows: readonly SimOutcome[]): { readonly wilson: number; readonly bootstrap: number } {
  if (rows.length === 0) return { wilson: 0, bootstrap: 0 };
  const correct = rows.filter((each) => each.action?.taken === each.action?.correct).length;
  const drawn = bootstrapClusters(rows, termOf, (sample) => share(sample, (action) => action.taken === action.correct), { runs: SIM_BOOTSTRAP_RUNS, level: 0.95, seed: `actions:${label}:correct` });
  return { wilson: wilson(correct, rows.length).low, bootstrap: drawn.low };
}

/**
 * This function gives the high end of the gate of the false actions on healthy targets: the cases of the class `none`.
 * A false action is an action other than `none`. The high end is 1 minus the correct low end of each case of the class
 * `none`, also the cases of the known gaps. `falseActionProblems` holds it. With no healthy case, the function gives -1.
 */
export function falseHighOf(outcomes: readonly SimOutcome[]): number {
  const healthy = outcomes.filter((each) => each.action !== undefined && each.case.truth === NO_FAULT);
  if (healthy.length === 0) return -1;
  const ends = correctLowOf(NO_FAULT, healthy);
  return third(1 - Math.min(third(ends.wilson), third(ends.bootstrap)));
}

/**
 * This function gives a problem when the false actions on healthy targets have a high end above `SIM_HARM_LIMIT`. The
 * cases of the known gaps count. A needless action slows a live service, thus the harm limit applies, as in the fit.
 */
export function falseActionProblems(outcomes: readonly SimOutcome[]): readonly string[] {
  const high = falseHighOf(outcomes);
  if (high < 0) return ["The runs have no healthy case with an action, thus the gate has no false actions to examine."];
  return high > SIM_HARM_LIMIT ? [`The false actions on healthy targets have the high end ${high}, over the limit ${SIM_HARM_LIMIT}.`] : [];
}

/** The count of the cases of one known gap in the file `bars/sim-gaps.json`. */
export interface GapCount {
  readonly id: string;
  readonly cases: number;
}

/**
 * This function gives a problem for each known gap with more cases than its count in the file `bars/sim-gaps.json` of
 * the branch. The size of a gap can only fall, thus a wider rule or a new gap is a visible change of the gate. With no
 * file, the gate cannot read the counts, and each gap with a case gives a problem.
 */
export function gapSizeProblems(outcomes: readonly SimOutcome[], counts: readonly GapCount[] | undefined, gaps: readonly SimGap[] = SIM_GAPS): readonly string[] {
  const problems: string[] = [];
  for (const gap of gaps) {
    const cases = outcomes.filter((each) => gapOf(each.case, gaps) === gap).length;
    const count = counts?.find((each) => each.id === gap.id)?.cases;
    if (counts === undefined) {
      if (cases > 0) problems.push(`The file bars/sim-gaps.json has no counts, thus the gate cannot read the size of the gap ${gap.id} (${cases} cases).`);
    } else if (count === undefined) {
      if (cases > 0) problems.push(`The gap ${gap.id} is new, with ${cases} cases. Write its count in bars/sim-gaps.json by hand, and tell the reason in the PR.`);
    } else if (cases > count) {
      problems.push(`The gap ${gap.id} has ${cases} cases of the gate seeds, over its count ${count} in bars/sim-gaps.json. The size of a gap can only fall.`);
    }
  }
  return problems;
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

/**
 * This function gives the action rates of each class, in the order of the classes. Only a case with an action counts.
 * The harmful actions are of each case. The correct actions are of the cases outside the known gaps.
 */
export function actionRates(outcomes: readonly SimOutcome[]): Readonly<Record<string, SimActionRate>> {
  const rate = (label: string, rows: readonly SimOutcome[]): SimActionRate => {
    const counted = outsideGaps(rows);
    const correct = counted.filter((each) => each.action?.taken === each.action?.correct).length;
    const harmful = rows.filter((each) => each.action?.harmful === true).length;
    const hits = correctLowOf(label, counted);
    const harm = harmHighOf(label, rows);
    const wilsonEnds = { correctLow: third(hits.wilson), harmHigh: third(harm.wilson) };
    const bootstrapEnds = { correctLow: third(hits.bootstrap), harmHigh: third(harm.bootstrap) };
    const forecasts = rows.flatMap((each) => (each.action === undefined ? [] : kindForecasts(each.action)));
    return {
      cases: rows.length,
      counted: counted.length,
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
    "The table has the cases in no known gap. The section of the known gaps has the other cases.",
    "",
    "| Class | Hits | Bar | Silent visits | The other answers |",
    "| --- | --- | --- | --- | --- |",
  );
  const counted = outsideGaps(outcomes);
  for (const label of [...new Set(counted.map((each) => each.case.truth))]) {
    const mine = counted.filter((each) => each.case.truth === label);
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
    "The correct actions are of the cases outside the known gaps. The harmful actions are of each case. The section of the known gaps has the actions of its cases.",
    "The ends are of 95 % intervals: Wilson, and a bootstrap that draws the terms of the class again. The gate takes the worse end of the two.",
    `A class with a harm high end above ${SIM_HARM_LIMIT} fails the test of the sim. The margin is ${SIM_HARM_LIMIT} minus the harm high end.`,
    "A class with a correct low end under its limit in `bars/action-limits.json` also fails the test. The Brier score is of the probability of each kind of action.",
    "",
    "| Class | Cases | Outside the gaps | Correct | Correct, low end (Wilson, bootstrap) | Its limit | Harmful | Harmful, high end (Wilson, bootstrap) | Harm margin | Brier | The other actions outside the gaps |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [label, rate] of Object.entries(actionRates(outcomes))) {
    const others = new Map<string, number>();
    for (const each of outsideGaps(outcomes)) {
      if (each.case.truth !== label || each.action === undefined || each.action.taken === each.action.correct) continue;
      const name = `${each.action.taken}${each.action.harmful ? " (harmful)" : ""}`;
      others.set(name, (others.get(name) ?? 0) + 1);
    }
    const list = [...others].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`);
    const ends = (gate: number, wilsonEnd: number, bootstrapEnd: number): string => `${gate} (${wilsonEnd}, ${bootstrapEnd})`;
    lines.push(
      `| ${label} | ${rate.cases} | ${rate.counted} | ${percent(rate.correct, rate.counted)} | ${ends(rate.correctLow, rate.wilson.correctLow, rate.bootstrap.correctLow)} | ${limits?.limits[label] ?? "–"} | ${percent(rate.harmful, rate.cases)} | ${ends(rate.harmHigh, rate.wilson.harmHigh, rate.bootstrap.harmHigh)} | ${third(SIM_HARM_LIMIT - rate.harmHigh)} | ${rate.brier} | ${list.join(", ")} |`,
    );
  }
  const calibration = gateCalibration(outcomes);
  lines.push(
    "",
    "## The calibration of the actions",
    "",
    `The top-label forecast of a case is the probability of the chosen kind, and it hits when that kind is correct. The errors are expected calibration errors of ${SIM_CALIBRATION_BINS} bins, over the cases with an action in no known gap.`,
    "The forecasts of one class are not calibrated by design, because the class is a part of the truth. Thus the gate examines the errors of all cases.",
    "",
    `- The top-label error: ${calibration.top} (limit ${limits?.errorLimits.top ?? "–"}).`,
    `- The kind error: ${calibration.kinds} (limit ${limits?.errorLimits.kinds ?? "–"}).`,
    `- The error of the ${calibration.unsureCases} unsure cases, with a top probability under ${SIM_UNSURE_BELOW}: ${calibration.unsure} (limit ${limits?.errorLimits.unsure ?? "–"}).`,
    "",
    `Each bin with ${SIM_BIN_TEST_COUNT} cases or more gets the exact two-sided test of its count of hits against the sum of its probabilities. The Holm correction over these bins holds the level ${SIM_BIN_TEST_LEVEL}. The gate fails on a bin that fails, unless SIM_UNCALIBRATED_BINS has the bin with its cause and its end.`,
    "",
    "| Bin of the top label | Cases | Mean probability | Hit rate | Wilson interval | p | Holm p | Test |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...calibration.bins.map((bin) => {
      const known = SIM_UNCALIBRATED_BINS.find((each) => each.low === bin.low);
      const test = bin.p === undefined ? "no test" : bin.reject ? (known === undefined ? "fails" : "fails, known") : "passes";
      return `| ${binText(bin)} | ${bin.n} | ${bin.stated} | ${bin.rate} | ${bin.interval.low} to ${bin.interval.high} | ${bin.p ?? "–"} | ${bin.adjusted ?? "–"} | ${test} |`;
    }),
  );
  lines.push(
    "",
    "## The known gaps",
    "",
    "A known gap is a rule over the fault and the history of a case. Its cases have the same facts as the cases of its twin, a fault of a different class. The gate examines its cases apart from the other cases, with a bar of their own.",
    "The size of a gap can only fall: the gate holds its cases at or under its count in bars/sim-gaps.json. The top-label error is of the cases of the gap only. When the bar of a gap gets to the bar of its class, the sim tells you to remove the gap.",
    "",
    "| Gap | Class | Twin | Cases | Hits | Bar | Actions | Top-label error | Cause | End |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const { gap, bars: gapBars } of runs.gaps) {
    const mine = outcomes.filter((each) => gapOf(each.case) === gap);
    const hits = mine.filter((each) => each.predicted === gap.label).length;
    const bar = gapBars.tag === "ok" ? (gapBars.value[gap.label] ?? "–") : "–";
    const taken = new Map<string, number>();
    for (const each of mine) {
      if (each.action === undefined) continue;
      const name = `${each.action.taken}${each.action.harmful ? " (harmful)" : ""}`;
      taken.set(name, (taken.get(name) ?? 0) + 1);
    }
    const actions = [...taken].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`).join(", ") || "–";
    const twin = `${gap.twin.label} (${gap.twin.option}, ${Object.entries(gap.twin.params).map(([name, value]) => `${name} ${String(value)}`).join(", ")})`;
    lines.push(`| ${gap.id} | ${gap.label} | ${twin} | ${mine.length} | ${percent(hits, mine.length)} | ${bar} | ${actions} | ${actionCalibration(mine).top} | ${gap.cause} | ${gap.end} |`);
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
