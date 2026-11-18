import { labBars, STANDARD_CATALOG, type LabBars, type LabRecalls } from "@mark1russell7/netdiag";
import type { Result } from "@mark1russell7/optional";
import { countOf } from "@mark1russell7/text";
import { faultsOf, faultValues } from "../grammar.ts";
import { labReport } from "../report.ts";
import { runRounds, type LabRound } from "../run.ts";
import { SIM_BANDS, simCases, type SimCase } from "./cases.ts";
import { simVisit } from "./world.ts";

// The runs of the simulated world (ND-17, the layer E0). Each seed draws a new plan of cases, and each case is one
// visit of netdiag on the model. The bars come from `labBars` over the scores of the seeds.

/** The number of seeds of the bars of the simulated world. `labBars` needs 5 runs or more. */
export const SIM_SEEDS = 5;

/**
 * The result of one case in one seed: the class that netdiag gave, or the reason of a visit with no read. `visits` is 1,
 * or more when a fault passed each of its draws in a visit.
 */
export interface SimOutcome {
  readonly seed: number;
  readonly case: SimCase;
  readonly predicted: string | undefined;
  readonly reason?: string | undefined;
  readonly visits: number;
}

/** The runs of the seeds: the outcome of each case, the score of each seed, the bars, and the problems. */
export interface SimRuns {
  readonly outcomes: readonly SimOutcome[];
  readonly scores: readonly LabRecalls[];
  readonly bars: Result<LabBars, string[]>;
  readonly problems: readonly string[];
}

/** This function visits each case of the plans of the seeds 1 to `seeds`, and it gives the bars of the runs. */
export async function simRuns(seeds: number = SIM_SEEDS): Promise<SimRuns> {
  const scores: LabRecalls[] = [];
  const outcomes: SimOutcome[] = [];
  const problems: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
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
    for (const run of runs) {
      const labCase = byId.get(run.case);
      if (labCase === undefined) continue;
      const count = visits.get(run.case) ?? 1;
      outcomes.push(run.status === "read" ? { seed, case: labCase, predicted: run.record.predicted, visits: count } : { seed, case: labCase, predicted: undefined, reason: run.reason, visits: count });
    }
    if (report.noReads.length > 0) problems.push(`The seed ${seed} has ${countOf(report.noReads.length, "case")} with no read.`);
    for (const problem of report.problems) problems.push(`The seed ${seed}: ${problem}`);
    if (report.score !== undefined) scores.push(report.score);
  }
  const bars = labBars(scores);
  if (bars.tag === "err") problems.push(...bars.error);
  return { outcomes, scores, bars, problems };
}

/** The hits of one option at one place: the cases of the option at the place, and the cases with the correct class. */
export interface SimPlaceHits {
  readonly label: string;
  readonly option: string;
  readonly place: string;
  readonly hits: number;
  readonly cases: number;
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
export function simSummary(runs: SimRuns, seeds: number = SIM_SEEDS): string {
  const { outcomes } = runs;
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
