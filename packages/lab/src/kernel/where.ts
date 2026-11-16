import { PATH_REPORT, factsOf, lossStart, type LabGate, type LabRecalls, type PathReport } from "@mark1russell7/netdiag";
import { wilson, type Proportion } from "@mark1russell7/rigor-statistics";
import { gateLines, percent } from "../report.ts";
import type { Visit } from "../run.ts";
import { TOWARD_CLIENT, type KernelFault } from "./cases.ts";

// The where cases of the kernel lab (ND-15). Each case puts a loss on one link of the path, or no loss. The agent
// starts `mtr` to the target. `lossStart` of netdiag gives the part of the path where the loss starts, and the lab
// compares it with the link of the fault. This module imports no value of the harness, so the unit tests start no container.

/**
 * The number of cycles of `mtr` in a where case. With a loss of 30%, `lossStart` misses the start after the router in
 * approximately 2 of 10000 runs. With 20 cycles, it misses it in 8 of 10 runs.
 */
export const WHERE_CYCLES = 60;
/** The `netem` spec of the loss of a where case. */
export const WHERE_LOSS = "loss 30%";
/** The format of a where run. */
export const WHERE_RUN_FORMAT = "netdiag.lab-where/1";
/** The version of the set of where cases. A change of a case, of the loss or of the cycles gives a new version, and thus new bars. */
export const WHERE_CATALOG = "kernel-where@1";

/** The name of a hop of the path: `gateway` for the router, `target` for the destination. Each other address is its own name. */
export type WhereHop = string;

/** A part of the path where the loss starts: the last hop before it, or `null` for the first link, and the hops after it. */
export interface WherePart {
  readonly after: WhereHop | null;
  readonly hops: readonly WhereHop[];
}

/** A where case: a fault on one link, or none, and the part of the path that `lossStart` must give. `null` is no loss. */
export interface WhereCase {
  readonly id: string;
  readonly summary: string;
  readonly fault: KernelFault | null;
  readonly expect: WherePart | null;
}

/** The where cases. Each case is in each round. */
export const WHERE_CASES: readonly WhereCase[] = [
  {
    id: "loss.last-link",
    summary: "The target loses 30% of the packets that it sends. The router loses none, so the loss starts after the router.",
    fault: { kind: "netem", at: "target", spec: WHERE_LOSS },
    expect: { after: "gateway", hops: ["target"] },
  },
  {
    id: "loss.first-link",
    summary: "The router loses 30% of the packets that it sends to the client, and its answers to mtr. Thus the loss starts on the first link.",
    fault: { kind: "netem", at: TOWARD_CLIENT, spec: WHERE_LOSS },
    expect: { after: null, hops: ["gateway", "target"] },
  },
  {
    id: "none",
    summary: "The path has no fault. Thus no loss starts on it.",
    fault: null,
    expect: null,
  },
];

/** A hop of the report of `mtr` in a where run. */
export interface WhereReportHop {
  readonly ttl: number;
  /** The name of the hop. It is `null` for a hop with no answer. */
  readonly hop: WhereHop | null;
  readonly sent: number;
  readonly received: number;
}

/**
 * The result of one run of a where case.
 *
 * - `read`: the visit has one report of `mtr` that reached the target. `answer` is the part that `lossStart` gave.
 * - `no-read`: the world did not start, a probe did not end, or the visit has no such report. The reason tells which.
 */
export type WhereRun =
  | {
      readonly status: "read";
      readonly format: typeof WHERE_RUN_FORMAT;
      readonly case: string;
      readonly round: number;
      readonly expect: WherePart | null;
      readonly answer: WherePart | null;
      readonly hit: boolean;
      readonly hops: readonly WhereReportHop[];
    }
  | { readonly status: "no-read"; readonly case: string; readonly round: number; readonly reason: string };

/** This function gives the name of each address of a report: `gateway` for the gateway, `target` for the destination. */
function namer(report: PathReport, gateway: string | undefined): (address: string) => WhereHop {
  return (address) => (address === gateway ? "gateway" : address === report.address ? "target" : address);
}

/** This function tells if two parts of a path are the same. */
export function samePart(a: WherePart | null, b: WherePart | null): boolean {
  if (a === null || b === null) return a === b;
  return a.after === b.after && a.hops.length === b.hops.length && a.hops.every((hop, i) => hop === b.hops[i]);
}

/**
 * This function changes the visit of a where case into a run. The visit must have each probe ended and one report of
 * `mtr` of the target that reached it. Without them, the run has no read.
 */
export function readWhere(labCase: WhereCase, round: number, visit: Visit): WhereRun {
  const noRead = (reason: string): WhereRun => ({ status: "no-read", case: labCase.id, round, reason });
  if (visit.status === "no-visit") return noRead(visit.reason);
  if (visit.problems.length > 0) return noRead(visit.problems.join(" "));
  // As in the readers of netdiag, a visit with no function `primary` has only facts of the target.
  const reports = factsOf(PATH_REPORT, visit.facts).filter((fact) => visit.read.primary?.(fact) ?? true);
  const report = reports[0]?.value;
  if (report === undefined || reports.length > 1) return noRead(`The visit has ${reports.length} reports of mtr of the target, not 1.`);
  if (report.outcome !== "reached") return noRead(`The report of mtr did not reach the target. Its outcome is "${report.outcome}".`);
  const name = namer(report, visit.read.gateway);
  const start = lossStart(report);
  const answer: WherePart | null =
    start === undefined ? null : { after: start.after === undefined ? null : name(start.after.address), hops: start.hops.map((hop) => name(hop.address)) };
  return {
    status: "read",
    format: WHERE_RUN_FORMAT,
    case: labCase.id,
    round,
    expect: labCase.expect,
    answer,
    hit: samePart(answer, labCase.expect),
    hops: report.hops.map((hop) => ({ ttl: hop.ttl, hop: hop.address === undefined ? null : name(hop.address), sent: hop.sent, received: hop.received })),
  };
}

/** A where run with a read. */
export type WhereRead = Extract<WhereRun, { readonly status: "read" }>;
/** A where run with no read. */
export type WhereNoRead = Extract<WhereRun, { readonly status: "no-read" }>;

const isRead = (run: WhereRun): run is WhereRead => run.status === "read";
const isNoRead = (run: WhereRun): run is WhereNoRead => run.status === "no-read";

/** The score of one where case over its runs. */
export interface WhereScore {
  readonly case: string;
  readonly reads: number;
  readonly hits: number;
  readonly noReads: number;
  /** The Wilson interval of the part of the reads with a hit. */
  readonly rate: Proportion;
}

/** This function scores each where case, in the order of the cases. A run of an unknown case is not in a score. */
export function whereScores(cases: readonly WhereCase[], runs: readonly WhereRun[]): WhereScore[] {
  return cases.map((labCase) => {
    const mine = runs.filter((run) => run.case === labCase.id);
    const reads = mine.filter(isRead);
    const hits = reads.filter((run) => run.hit).length;
    return { case: labCase.id, reads: reads.length, hits, noReads: mine.length - reads.length, rate: wilson(hits, reads.length) };
  });
}

/**
 * This function gives the recalls of the where cases, so that `labBars` and `labGate` of netdiag read them. The recall
 * of a case is the part of its reads with a hit. A case with no read has the support 0.
 */
export function whereRecalls(scores: readonly WhereScore[]): LabRecalls {
  return { catalog: WHERE_CATALOG, classes: scores.map((score) => ({ label: score.case, support: score.reads, recallInterval: score.rate })) };
}

/** This function gives the text of a part of a path. */
export function partText(part: WherePart | null): string {
  if (part === null) return "no loss";
  const hops = part.hops.map((hop) => `\`${hop}\``).join(", ");
  return part.after === null ? `from the first link: ${hops}` : `after \`${part.after}\`: ${hops}`;
}

/** This function gives the scores, the runs and the gate of the where cases as Markdown, for the summary of a CI run. */
export function whereMarkdown(scores: readonly WhereScore[], runs: readonly WhereRun[], rounds: number, gate?: LabGate): string {
  const reads = runs.filter(isRead).length;
  const lines = ["## The where cases of the kernel lab", ""];
  lines.push(`${scores.length} cases, ${rounds} rounds, ${WHERE_CYCLES} cycles of mtr: ${reads} reads and ${runs.length - reads} runs with no read.`, "");
  lines.push("| Case | Reads | Hits | Hit rate | 95% interval | No reads |", "| --- | ---: | ---: | ---: | --- | ---: |");
  for (const score of scores) {
    const rate = score.reads === 0 ? undefined : score.hits / score.reads;
    lines.push(`| \`${score.case}\` | ${score.reads} | ${score.hits} | ${percent(rate)} | ${percent(score.rate.low)} to ${percent(score.rate.high)} | ${score.noReads} |`);
  }
  lines.push("");
  const misses = runs.filter(isRead).filter((run) => !run.hit);
  if (misses.length > 0) {
    lines.push("### Misses", "");
    for (const run of misses) lines.push(`- \`${run.case}#${run.round}\`: the loss starts ${partText(run.answer)}. The case expects ${partText(run.expect)}.`);
    lines.push("");
  }
  const noReads = runs.filter(isNoRead);
  if (noReads.length > 0) {
    lines.push("### No reads", "");
    for (const run of noReads) lines.push(`- \`${run.case}#${run.round}\`: ${run.reason}`);
    lines.push("");
  }
  if (gate !== undefined) lines.push(...gateLines(gate, "Case", "Reads"));
  return lines.join("\n");
}
