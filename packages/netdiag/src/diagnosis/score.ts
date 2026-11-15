import { err, ok, type Result } from "@mark1russell7/optional";
import { type ClassScore, type Confusion, type Proportion, brier, classScores, confusion, wilson } from "@mark1russell7/rigor-statistics";
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
export function labGate(score: LabScore, bars: LabBars): Result<LabGate, string[]> {
  const problems: string[] = [];
  const labels = new Set(score.table.labels);
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
