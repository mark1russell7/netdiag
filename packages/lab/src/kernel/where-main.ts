// The command of the where cases of the kernel lab (ND-15). It starts one world for each round, operates each where
// case in the round, and writes the runs, the score of each case and the gate. It needs Docker, so only CI starts it
// (the job `where` of the workflow `lab-kernel.yml`).
//
//   node packages/lab/src/kernel/where-main.ts --rounds 5 --out lab-where-out [--bars bars/where.json]
//
// The exit code is 0 when each run gave a read and the gate passed, 1 when the gate failed, and 2 for a run with no read.
// The file `score.json` has the recalls of the cases in the field `score`, so `bars-main.ts` gives their bars.

import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { labGate, type LabBars, type LabGate } from "@mark1russell7/netdiag";
import { authority } from "@netdiag/fixtures";
import { visitRounds } from "../run.ts";
import { WHERE_CASES, readWhere, whereMarkdown, whereRecalls, whereScores, type WhereCase } from "./where.ts";
import { kernelTrust, labImage, startKernelRound, wherePlan } from "./world.ts";

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: "5" },
    out: { type: "string", default: "lab-where-out" },
    bars: { type: "string" },
  },
});

const rounds = Number(values.rounds);
const trust = await kernelTrust(await authority("netdiag kernel lab root"));

const runs = await visitRounds(WHERE_CASES, rounds, () => startKernelRound<WhereCase>(trust, labImage(), wherePlan), readWhere, (run) => {
  const line = run.status === "read" ? `${run.hit ? "hit" : "miss"} ${JSON.stringify(run.answer)}` : `no read: ${run.reason}`;
  process.stdout.write(`round ${run.round} ${run.case}: ${line}\n`);
});
const scores = whereScores(WHERE_CASES, runs);
const recalls = whereRecalls(scores);
const noReads = scores.reduce((sum, score) => sum + score.noReads, 0);

let gate: LabGate | undefined;
if (values.bars !== undefined) {
  const bars = JSON.parse(await readFile(values.bars, "utf8")) as LabBars;
  const checked = labGate(recalls, bars);
  if (checked.tag === "err") throw new Error(`The bars have problems: ${checked.error.join(" ")}`);
  // Each where case is a case of the gate. A case with no bar is a fault of the file of the bars, not a pass.
  if (checked.value.unbarred.length > 0) throw new Error(`The bars have no bar for the cases ${checked.value.unbarred.join(", ")}.`);
  gate = checked.value;
}

await mkdir(values.out, { recursive: true });
await writeFile(join(values.out, "where.ndjson"), runs.map((run) => JSON.stringify(run)).join("\n") + "\n");
await writeFile(join(values.out, "score.json"), JSON.stringify({ rounds, cases: WHERE_CASES, scores, score: recalls, noReads }, null, 2) + "\n");
if (gate !== undefined) await writeFile(join(values.out, "gate.json"), JSON.stringify(gate, null, 2) + "\n");
const markdown = whereMarkdown(scores, runs, rounds, gate);
await writeFile(join(values.out, "summary.md"), markdown);
if (process.env["GITHUB_STEP_SUMMARY"] !== undefined) appendFileSync(process.env["GITHUB_STEP_SUMMARY"], markdown);
process.stdout.write(`\n${markdown}`);

// The Docker client of the harness can keep handles open after the last world stops. Thus the command ends itself.
process.exit(noReads > 0 ? 2 : gate !== undefined && !gate.pass ? 1 : 0);
