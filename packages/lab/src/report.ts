import { scoreLab, type Catalog, type LabGate, type LabRecord, type LabScore } from "@mark1russell7/netdiag";
import type { CaseRun } from "./run.ts";

/** The result of a lab: the score of the reads, and the runs with no read. */
export interface LabReport {
  readonly rounds: number;
  readonly cases: number;
  readonly records: readonly LabRecord[];
  readonly noReads: readonly Extract<CaseRun, { status: "no-read" }>[];
  /** The score is absent when the lab has no read. */
  readonly score: LabScore | undefined;
  /** The problems of the score, when the records do not fit the catalog. */
  readonly problems: readonly string[];
}

/** This function scores the reads of a lab, and keeps the runs with no read. */
export function labReport(catalog: Catalog, runs: readonly CaseRun[], rounds: number, cases: number): LabReport {
  const records: LabRecord[] = [];
  const noReads: Extract<CaseRun, { status: "no-read" }>[] = [];
  for (const run of runs) {
    if (run.status === "read") records.push(run.record);
    else noReads.push(run);
  }
  if (records.length === 0) return { rounds, cases, records, noReads, score: undefined, problems: [] };
  const score = scoreLab(catalog, records);
  return score.tag === "ok"
    ? { rounds, cases, records, noReads, score: score.value, problems: [] }
    : { rounds, cases, records, noReads, score: undefined, problems: score.error };
}

const percent = (x: number | undefined): string => (x === undefined ? "–" : `${(100 * x).toFixed(0)}%`);

/** This function gives the report as Markdown, for the summary of a CI run. */
export function reportMarkdown(report: LabReport, gate?: LabGate): string {
  const lines = ["## The loopback lab", ""];
  const reads = report.records.length;
  lines.push(`${report.cases} cases, ${report.rounds} rounds: ${reads} reads and ${report.noReads.length} runs with no read.`, "");
  const score = report.score;
  if (score !== undefined) {
    lines.push(`Catalog ${score.catalog}. Accuracy ${percent(score.correct / score.n)} (${score.correct} of ${score.n}), 95% interval ${percent(score.accuracy.low)} to ${percent(score.accuracy.high)}. Brier score ${score.brier?.toFixed(3) ?? "–"}.`, "");
    lines.push("| Hypothesis | Cases | Hits | Recall | 95% interval | Precision |", "| --- | ---: | ---: | ---: | --- | ---: |");
    for (const row of score.classes.filter((c) => c.support > 0 || c.predicted > 0)) {
      lines.push(`| \`${row.label}\` | ${row.support} | ${row.hits} | ${percent(row.recall)} | ${percent(row.recallInterval.low)} to ${percent(row.recallInterval.high)} | ${percent(row.precision)} |`);
    }
    lines.push("");
    const wrong = report.records.filter((record) => record.predicted !== record.truth);
    if (wrong.length > 0) {
      lines.push("### Wrong diagnoses", "");
      for (const record of wrong) lines.push(`- \`${record.case}\`: \`${record.truth}\` got \`${record.predicted}\` (rank of the truth: ${record.rank}).`);
      lines.push("");
    }
  }
  for (const problem of report.problems) lines.push(`- The score has a problem: ${problem}`);
  if (report.noReads.length > 0) {
    lines.push("### No reads", "");
    for (const run of report.noReads) lines.push(`- \`${run.case}#${run.round}\`: ${run.reason}`);
    lines.push("");
  }
  if (gate !== undefined) {
    lines.push(`### The gate: ${gate.pass ? "pass" : "fail"}`, "", "| Hypothesis | Bar | Lower bound | Cases | Status |", "| --- | ---: | ---: | ---: | --- |");
    for (const v of gate.verdicts) lines.push(`| \`${v.hypothesis}\` | ${percent(v.bar)} | ${percent(v.low)} | ${v.support} | ${v.status} |`);
    lines.push("");
  }
  return lines.join("\n");
}
