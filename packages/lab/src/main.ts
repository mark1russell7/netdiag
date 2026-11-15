// The command of the loopback lab. It runs each case in each round, and writes the records, the score and the gate.
//
//   node packages/lab/src/main.ts --hosts ci --rounds 5 --out lab-out [--bars bars.json]
//
// The exit code is 0 when each run gave a read and the gate passed, 1 when the gate failed, and 2 for a run with no read.

import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { STANDARD_CATALOG, labGate, type LabBars, type LabGate } from "@mark1russell7/netdiag";
import { CI_HOSTS, LOCAL_HOSTS, LOOPBACK_CASES } from "./cases.ts";
import { labReport, reportMarkdown } from "./report.ts";
import { runLab } from "./run.ts";
import { labTrust } from "./world.ts";

const { values } = parseArgs({
  options: {
    hosts: { type: "string", default: "ci" },
    rounds: { type: "string", default: "5" },
    out: { type: "string", default: "lab-out" },
    bars: { type: "string" },
  },
});

if (values.hosts !== "ci" && values.hosts !== "local") throw new Error(`The option --hosts is "ci" or "local", not "${values.hosts}".`);
const hosts = values.hosts === "ci" ? CI_HOSTS : LOCAL_HOSTS;
const rounds = Number(values.rounds);
const trust = await labTrust();

const runs = await runLab(LOOPBACK_CASES, rounds, { hosts, trust }, (run) => {
  const line = run.status === "read" ? `${run.record.truth} -> ${run.record.predicted}` : `no read: ${run.reason}`;
  process.stdout.write(`round ${run.round} ${run.case}: ${line}\n`);
});
const report = labReport(STANDARD_CATALOG, runs, rounds, LOOPBACK_CASES.length);

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
await writeFile(join(values.out, "score.json"), JSON.stringify({ score: report.score, problems: report.problems, noReads: report.noReads.length }, null, 2) + "\n");
if (gate !== undefined) await writeFile(join(values.out, "gate.json"), JSON.stringify(gate, null, 2) + "\n");
const markdown = reportMarkdown(report, gate);
await writeFile(join(values.out, "summary.md"), markdown);
if (process.env["GITHUB_STEP_SUMMARY"] !== undefined) appendFileSync(process.env["GITHUB_STEP_SUMMARY"], markdown);
process.stdout.write(`\n${markdown}`);

process.exitCode = report.noReads.length > 0 || report.problems.length > 0 || report.score === undefined ? 2 : gate !== undefined && !gate.pass ? 1 : 0;
