import { err, ok, type Result } from "@mark1russell7/optional";
import type { LabBars, LabScore } from "@mark1russell7/netdiag";

// The bars of the gate (ND-7, step 4). The command `bars-main.ts` reads the file `score.json` of each run of one lab.
// `labBars` of netdiag gives the bars from these scores.

/** The file `score.json` of one run of a lab, as `main.ts` and `kernel/main.ts` write it. */
export interface RunScoreFile {
  readonly score?: LabScore | undefined;
  readonly problems?: readonly string[] | undefined;
  readonly noReads?: number | undefined;
}

/**
 * This function gives the score of one run from its file `score.json`. A run with a case with no read, or with
 * problems in its score, gives no bars. A gate that cannot read a case shows no read, not a pass.
 */
export function runScore(name: string, file: RunScoreFile): Result<LabScore, string> {
  const noReads = file.noReads ?? 0;
  if (noReads > 0) return err(`The run ${name} has ${noReads} cases with no read.`);
  const problems = file.problems ?? [];
  if (problems.length > 0) return err(`The run ${name} has problems in its score: ${problems.join(" ")}`);
  const score = file.score;
  if (score === undefined || typeof score.catalog !== "string" || !Array.isArray(score.classes)) return err(`The run ${name} has no score.`);
  return ok(score);
}

const fixed = (value: number): string => value.toFixed(3);

/**
 * This function gives a Markdown table of the bars: the bar and the lower end of the recall in each run. The columns of
 * the runs have numbers, and a list after the table gives the name of each run.
 */
export function barsMarkdown(names: readonly string[], scores: readonly LabScore[], bars: LabBars): string {
  const lines = [
    `## The bars of the gate`,
    "",
    `The bar of each hypothesis is the least lower end of its recall over ${scores.length} runs, minus the spread of these lower ends.`,
    "",
    `| Hypothesis | Bar | ${scores.map((_, i) => String(i + 1)).join(" | ")} |`,
    `| --- | ---: | ${scores.map(() => "---:").join(" | ")} |`,
  ];
  for (const [hypothesis, bar] of Object.entries(bars)) {
    const lows = scores.map((score) => score.classes.find((each) => each.label === hypothesis)?.recallInterval.low);
    lines.push(`| \`${hypothesis}\` | ${fixed(bar)} | ${lows.map((low) => (low === undefined ? "none" : fixed(low))).join(" | ")} |`);
  }
  lines.push("", ...names.map((name, i) => `${i + 1}. \`${name}\``));
  return `${lines.join("\n")}\n`;
}
