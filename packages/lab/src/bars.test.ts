import { STANDARD_CATALOG, diagnose, labBars, labRecordOf, scoreLab, type LabRecord, type LabScore } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { barsMarkdown, runScore } from "./bars.ts";

/** The record of a case that the evidence of a refused connect diagnoses. */
function record(caseId: string, truth: string): LabRecord {
  const diagnosis = diagnose(STANDARD_CATALOG, [{ feature: "tcp.connect", value: "refused", primary: true }]);
  const result = labRecordOf(STANDARD_CATALOG, caseId, truth, diagnosis);
  if (result.tag !== "ok") throw new Error(result.error);
  return result.value;
}

function score(records: readonly LabRecord[]): LabScore {
  const result = scoreLab(STANDARD_CATALOG, records);
  if (result.tag !== "ok") throw new Error(result.error.join(" "));
  return result.value;
}

const predicted = record("p", "none").predicted;
const SCORE = score([record("a", predicted), record("b", predicted), record("c", "none")]);

describe("runScore", () => {
  it("gives the score of a run with a read in each case", () => {
    expect(runScore("run-1", { score: SCORE, problems: [], noReads: 0 })).toEqual({ tag: "ok", value: SCORE });
  });

  it("refuses a run with a case with no read, with problems, or with no score", () => {
    expect(runScore("run-1", { score: SCORE, problems: [], noReads: 2 })).toEqual({ tag: "err", error: "The run run-1 has 2 cases with no read." });
    expect(runScore("run-2", { score: SCORE, problems: ["A record has no catalog."] })).toMatchObject({ tag: "err", error: expect.stringContaining("A record has no catalog.") });
    expect(runScore("run-3", { problems: [], noReads: 0 })).toEqual({ tag: "err", error: "The run run-3 has no score." });
  });
});

describe("barsMarkdown", () => {
  it("gives one row for each bar, with the lower end of each run", () => {
    const scores = Array.from({ length: 5 }, () => SCORE);
    const bars = labBars(scores);
    expect(bars.tag).toBe("ok");
    if (bars.tag !== "ok") return;
    const names = scores.map((_, i) => `run-${i + 1}`);
    const markdown = barsMarkdown(names, scores, bars.value);
    const rows = markdown.split("\n").filter((line) => line.startsWith("| `"));
    expect(rows).toHaveLength(Object.keys(bars.value).length);
    const low = SCORE.classes.find((each) => each.label === predicted)?.recallInterval.low ?? Number.NaN;
    expect(rows).toContain(`| \`${predicted}\` | ${(bars.value[predicted] ?? Number.NaN).toFixed(3)} | ${Array(5).fill(low.toFixed(3)).join(" | ")} |`);
    expect(markdown).toContain("| Hypothesis | Bar | 1 | 2 | 3 | 4 | 5 |");
    expect(markdown).toContain("\n1. `run-1`\n2. `run-2`\n");
  });
});
