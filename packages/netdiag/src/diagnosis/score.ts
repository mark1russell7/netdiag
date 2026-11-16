import { err, ok, type Result } from "@mark1russell7/optional";
import { type ClassScore, type Confusion, type Proportion, brier, classScores, confusion, noiseFloor, wilson } from "@mark1russell7/rigor-statistics";
import type { Catalog, Diagnosis } from "./model.ts";

/** The format of a lab record. */
export const LAB_RECORD_FORMAT = "netdiag.lab-record/1";

/** The probability that a diagnosis gives to one cause. */
export interface LabCause {
  readonly id: string;
  readonly probability: number;
}

/** One run of a lab case: the hypothesis that the lab made true, and the diagnosis of netdiag. */
export interface LabRecord {
  readonly format: typeof LAB_RECORD_FORMAT;
  /** The id of the case, for example `tls.cert-invalid/expired`. */
  readonly case: string;
  /** The version of the catalog that gave the diagnosis. */
  readonly catalog: string;
  /** The hypothesis that the lab made true: a fault of the catalog, `none` or `unknown`. */
  readonly truth: string;
  /** The most probable cause of the diagnosis. */
  readonly predicted: string;
  /** The rank of the truth in the causes, from 1. */
  readonly rank: number;
  /** The probability of each cause, from the most probable. */
  readonly causes: readonly LabCause[];
}

/**
 * This function makes the record of one run of a lab case. The truth must be a hypothesis of the catalog, and the
 * diagnosis must have a cause.
 */
export function labRecordOf(catalog: Catalog, caseId: string, truth: string, diagnosis: Diagnosis): Result<LabRecord, string> {
  if (!catalog.hypotheses.some((hypothesis) => hypothesis.id === truth)) return err(`The truth "${truth}" is not a hypothesis of the catalog ${catalog.version}.`);
  const first = diagnosis.causes[0];
  if (first === undefined) return err("The diagnosis has no cause.");
  const index = diagnosis.causes.findIndex((cause) => cause.id === truth);
  if (index < 0) return err(`The diagnosis has no cause "${truth}".`);
  return ok({
    format: LAB_RECORD_FORMAT,
    case: caseId,
    catalog: catalog.version,
    truth,
    predicted: first.id,
    rank: index + 1,
    causes: diagnosis.causes.map((cause) => ({ id: cause.id, probability: cause.probability })),
  });
}

/** The scores of the lab records of one catalog. */
export interface LabScore {
  /** The version of the catalog. */
  readonly catalog: string;
  /** The number of records. */
  readonly n: number;
  /** The number of records where the predicted cause is the truth. */
  readonly correct: number;
  /** The Wilson interval of the part of the records where the predicted cause is the truth. */
  readonly accuracy: Proportion;
  /** The confusion table. It has a row for each hypothesis of the catalog, in the order of the catalog. */
  readonly table: Confusion<string>;
  /** The scores of each hypothesis, in the order of the catalog. */
  readonly classes: readonly ClassScore<string>[];
  /** The mean Brier score of the records: the squared distance of the probabilities from the truth, from 0 to 2. */
  readonly brier: number | undefined;
}

/**
 * This function scores the lab records of one catalog. The recall of a hypothesis is the part of its runs where the
 * diagnosis names it. A record of a different catalog version, or with a hypothesis that is not in the catalog, is an error.
 */
export function scoreLab(catalog: Catalog, records: readonly LabRecord[]): Result<LabScore, string[]> {
  const ids = catalog.hypotheses.map((hypothesis) => hypothesis.id);
  const known = new Set(ids);
  const problems: string[] = [];
  records.forEach((record, i) => {
    const name = `Record ${i} (${record.case})`;
    if (record.format !== LAB_RECORD_FORMAT) problems.push(`${name} has the format "${String(record.format)}", not "${LAB_RECORD_FORMAT}".`);
    if (record.catalog !== catalog.version) problems.push(`${name} comes from the catalog ${record.catalog}, not ${catalog.version}.`);
    for (const id of new Set([record.truth, record.predicted, ...record.causes.map((cause) => cause.id)])) {
      if (!known.has(id)) problems.push(`${name} names "${id}", which is not a hypothesis of the catalog.`);
    }
  });
  if (problems.length > 0) return err(problems);
  const table = confusion(
    records.map((record) => record.truth),
    records.map((record) => record.predicted),
    ids,
  );
  const forecasts = records.flatMap((record) => {
    const probability = new Map(record.causes.map((cause) => [cause.id, cause.probability]));
    return ids.map((id) => ({ p: probability.get(id) ?? 0, hit: id === record.truth }));
  });
  return ok({
    catalog: catalog.version,
    n: table.n,
    correct: table.correct,
    accuracy: wilson(table.correct, table.n),
    table,
    classes: classScores(table),
    brier: records.length === 0 ? undefined : brier(forecasts) * ids.length,
  });
}

/** The recall of one hypothesis in one run of a lab: its number of records and the Wilson interval of its recall. */
export type LabClassRecall = Pick<ClassScore<string>, "label" | "support" | "recallInterval">;

/**
 * The recalls of one run of a lab: the part of a score that `labGate` and `labBars` read. A `LabScore` is one. A lab
 * with no catalog of faults, for example a lab of the start of a loss, gives one for its cases.
 */
export interface LabRecalls {
  /** The version of the catalog, or of the set of cases. */
  readonly catalog: string;
  /** The recall of each hypothesis or case, in the order of the catalog. */
  readonly classes: readonly LabClassRecall[];
}

/** The least lower end of the Wilson interval of the recall, for each hypothesis that the gate holds. */
export type LabBars = Readonly<Record<string, number>>;

/** The verdict of the gate on one hypothesis: `no-read` when no record has it as the truth. */
export type LabStatus = "pass" | "fail" | "no-read";

/** The verdict of the gate on one hypothesis. */
export interface LabVerdict {
  readonly hypothesis: string;
  readonly status: LabStatus;
  /** The bar of the hypothesis. */
  readonly bar: number;
  /** The lower end of the recall interval. It is `undefined` when no record has the hypothesis as the truth. */
  readonly low: number | undefined;
  /** The number of records with the hypothesis as the truth. */
  readonly support: number;
}

/** The result of the accuracy gate. */
export interface LabGate {
  /** It is `true` only when each verdict is `pass`. A hypothesis with no read does not pass. */
  readonly pass: boolean;
  /** The verdicts, in the order of the catalog. */
  readonly verdicts: readonly LabVerdict[];
  /** The hypotheses with no bar, for example a fault that no lab can make. */
  readonly unbarred: readonly string[];
}

/**
 * This function holds the recall of each hypothesis with a bar. A hypothesis passes when the lower end of its
 * recall interval is the bar or more. A bar for a hypothesis that is not in the score is an error.
 */
export function labGate(score: LabRecalls, bars: LabBars): Result<LabGate, string[]> {
  const problems: string[] = [];
  const labels = new Set(score.classes.map((each) => each.label));
  for (const [hypothesis, bar] of Object.entries(bars)) {
    if (!labels.has(hypothesis)) problems.push(`The bar of "${hypothesis}" is not for a hypothesis of the catalog ${score.catalog}.`);
    if (!(bar >= 0 && bar <= 1)) problems.push(`The bar of "${hypothesis}" is ${bar}. A bar is from 0 to 1.`);
  }
  if (problems.length > 0) return err(problems);
  const verdicts: LabVerdict[] = [];
  const unbarred: string[] = [];
  for (const scores of score.classes) {
    const bar = bars[scores.label];
    if (bar === undefined) {
      unbarred.push(scores.label);
      continue;
    }
    const low = scores.support === 0 ? undefined : scores.recallInterval.low;
    const status: LabStatus = low === undefined ? "no-read" : low >= bar ? "pass" : "fail";
    verdicts.push({ hypothesis: scores.label, status, bar, low, support: scores.support });
  }
  return ok({ pass: verdicts.length > 0 && verdicts.every((verdict) => verdict.status === "pass"), verdicts, unbarred });
}

/** The options of `labBars`. */
export interface LabBarsOptions {
  /** The number of standard deviations in the spread of the lower ends. The default is 2. */
  readonly k?: number | undefined;
  /** The fewest runs that give bars. The default is 5. */
  readonly minimum?: number | undefined;
}

/** The step of a bar. `labBars` rounds each bar down to a whole number of steps. */
export const LAB_BAR_STEP = 0.001;

/**
 * This function gives the bars of the gate from the scores of the runs of one lab.
 *
 * - The bar of a hypothesis is the least lower end of its recall interval over the runs, minus the spread of these
 *   lower ends. The spread is `noiseFloor` of `rigor-statistics`: `k` standard deviations.
 * - The bar is 0 or more, rounded down to `LAB_BAR_STEP`.
 * - A hypothesis with no read in each run gets no bar. A hypothesis with a read in only some runs is an error.
 * - Fewer runs than `minimum`, and scores of different catalogs, are errors.
 */
export function labBars(scores: readonly LabRecalls[], options: LabBarsOptions = {}): Result<LabBars, string[]> {
  const k = options.k ?? 2;
  const minimum = options.minimum ?? 5;
  const problems: string[] = [];
  if (scores.length < minimum) problems.push(`The bars need ${minimum} runs or more. There are ${scores.length}.`);
  const catalogs = new Set(scores.map((score) => score.catalog));
  if (catalogs.size > 1) problems.push(`The runs have scores of ${catalogs.size} catalogs: ${[...catalogs].join(", ")}.`);
  if (problems.length > 0) return err(problems);
  const lows = new Map<string, (number | undefined)[]>();
  for (const score of scores) {
    for (const each of score.classes) {
      const list = lows.get(each.label) ?? [];
      list.push(each.support === 0 ? undefined : each.recallInterval.low);
      lows.set(each.label, list);
    }
  }
  const steps = Math.round(1 / LAB_BAR_STEP);
  const bars: Record<string, number> = {};
  for (const [hypothesis, list] of lows) {
    const read = list.filter((low): low is number => low !== undefined);
    if (read.length === 0) continue;
    if (read.length < scores.length) {
      problems.push(`The hypothesis "${hypothesis}" has a read in ${read.length} of ${scores.length} runs.`);
      continue;
    }
    const bar = Math.min(...read) - noiseFloor(read, { k, minimum });
    bars[hypothesis] = Math.max(0, Math.floor(bar * steps + 1e-9) / steps);
  }
  return problems.length > 0 ? err(problems) : ok(bars);
}
