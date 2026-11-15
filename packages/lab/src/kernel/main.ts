// The command of the kernel lab. It starts one world for each round, operates each case in the round, and writes the
// records, the score and the gate. It needs Docker, so only CI starts it (the workflow `lab-kernel.yml`).
//
//   node packages/lab/src/kernel/main.ts --rounds 5 --out lab-kernel-out [--bars bars.json]
//
// The exit code is 0 when each run gave a read and the gate passed, 1 when the gate failed, and 2 for a run with no read.

import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { STANDARD_CATALOG, labGate, type LabBars, type LabGate } from "@mark1russell7/netdiag";
import { authority } from "@netdiag/fixtures";
import { labReport, reportMarkdown } from "../report.ts";
import { runRounds } from "../run.ts";
import { KERNEL_CASES, KERNEL_LATER } from "./cases.ts";
import { kernelTrust, startKernelRound } from "./world.ts";

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: "5" },
    out: { type: "string", default: "lab-kernel-out" },
    bars: { type: "string" },
  },
});

const rounds = Number(values.rounds);
const trust = await kernelTrust(await authority("netdiag kernel lab root"));

const runs = await runRounds(KERNEL_CASES, rounds, () => startKernelRound(trust), STANDARD_CATALOG, (run) => {
  const line = run.status === "read" ? `${run.record.truth} -> ${run.record.predicted}` : `no read: ${run.reason}`;
  process.stdout.write(`round ${run.round} ${run.case}: ${line}\n`);
});
const report = labReport(STANDARD_CATALOG, runs, rounds, KERNEL_CASES.length);

let gate: LabGate | undefined;
if (values.bars !== undefined && report.score !== undefined) {
  const bars = JSON.parse(await readFile(values.bars, "utf8")) as LabBars;
  const checked = labGate(report.score, bars);
  if (checked.tag === "err") throw new Error(`The bars have problems: ${checked.error.join(" ")}`);
  gate = checked.value;
}

await mkdir(values.out, { recursive: true });
await writeFile(join(values.out, "runs.ndjson"), runs.map((run) => JSON.stringify(run)).join("\n") + "\n");
await writeFile(join(values.out, "records.ndjson"), report.records.map((record) => JSON.stringify(record)).join("\n") + "\n");
await writeFile(
  join(values.out, "score.json"),
  JSON.stringify({ score: report.score, problems: report.problems, noReads: report.noReads.length, later: KERNEL_LATER }, null, 2) + "\n",
);
if (gate !== undefined) await writeFile(join(values.out, "gate.json"), JSON.stringify(gate, null, 2) + "\n");
const markdown = reportMarkdown(report, gate, { title: "The kernel lab", later: KERNEL_LATER });
await writeFile(join(values.out, "summary.md"), markdown);
if (process.env["GITHUB_STEP_SUMMARY"] !== undefined) appendFileSync(process.env["GITHUB_STEP_SUMMARY"], markdown);
process.stdout.write(`\n${markdown}`);

// The Docker client of the harness can keep handles open after the last world stops. Thus the command ends itself.
process.exit(report.noReads.length > 0 || report.problems.length > 0 || report.score === undefined ? 2 : gate !== undefined && !gate.pass ? 1 : 0);
