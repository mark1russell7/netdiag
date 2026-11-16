// The command of the where cases of the kernel lab (ND-15). It starts one world for each round, operates each where
// case in the round, and writes the runs, the score of each case and the gate. It needs Docker, so only CI starts it
// (the job `where` of the workflow `lab-kernel.yml`).
//
//   node packages/lab/src/kernel/where-main.ts --rounds 5 --out lab-where-out [--bars bars/where.json] [--commit <sha>]
//
// The exit code is 0 when each run gave a read and the gate passed, 1 when the gate failed, and 2 for a run with no read.
// A file of samples that `readSamples` refuses also gives 2.
// The file `score.json` has the recalls of the cases in the field `score`, so `bars-main.ts` gives their bars.
// The file `samples.json` has the report of the first read of each case, for the site (ND-14).

import { appendFileSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { labGate, type LabBars, type LabGate } from "@mark1russell7/netdiag";
import { authority } from "@netdiag/fixtures";
import { visitRounds, type Visit } from "../run.ts";
import { SAMPLES_FORMAT, readSamples, type CheckSample, type CheckSamples } from "../samples.ts";
import type { AgentPlan } from "./protocol.ts";
import { WHERE_CASES, readWhere, whereMarkdown, whereRecalls, whereSample, whereScores, type WhereCase, type WhereRun } from "./where.ts";
import { kernelTrust, labImage, startKernelRound, wherePlan, type KernelAddresses } from "./world.ts";

/**
 * This function gives the commit of the run for the file of samples. On a pull request, it is the head of the pull
 * request from the event file of GitHub. Else it is `GITHUB_SHA`, or `local` outside CI.
 */
function runCommit(): string {
  const event = process.env["GITHUB_EVENT_PATH"];
  if (event !== undefined) {
    const head: unknown = (JSON.parse(readFileSync(event, "utf8")) as { pull_request?: { head?: { sha?: unknown } } }).pull_request?.head?.sha;
    if (typeof head === "string") return head;
  }
  return process.env["GITHUB_SHA"] ?? "local";
}

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: "5" },
    out: { type: "string", default: "lab-where-out" },
    bars: { type: "string" },
    commit: { type: "string" },
  },
});

const rounds = Number(values.rounds);
const trust = await kernelTrust(await authority("netdiag kernel lab root"));

// The plan of the last visit. Each visit of a round uses the plan of the world of the round, so the reader of a visit
// gets the plan that the agent followed.
let plan: AgentPlan | undefined;
const planOf = (addresses: KernelAddresses): AgentPlan => (plan = wherePlan(addresses));
const samples = new Map<string, CheckSample>();
const read = (labCase: WhereCase, round: number, visit: Visit): WhereRun => {
  const run = readWhere(labCase, round, visit);
  const sample = plan === undefined || samples.has(labCase.id) ? undefined : whereSample(labCase, run, plan, visit);
  if (sample !== undefined) samples.set(labCase.id, sample);
  return run;
};

const runs = await visitRounds(WHERE_CASES, rounds, () => startKernelRound<WhereCase>(trust, labImage(), planOf), read, (run) => {
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

// The samples go in the order of the cases. The site reads the file with `readSamples`, so the command reads it first.
const sampleFile: CheckSamples = {
  format: SAMPLES_FORMAT,
  commit: values.commit ?? runCommit(),
  samples: WHERE_CASES.flatMap((labCase) => samples.get(labCase.id) ?? []),
};
const sampleRead = readSamples(JSON.parse(JSON.stringify(sampleFile)));
const sampleProblems = sampleRead.tag === "err" ? sampleRead.error : [];

await mkdir(values.out, { recursive: true });
await writeFile(join(values.out, "where.ndjson"), runs.map((run) => JSON.stringify(run)).join("\n") + "\n");
await writeFile(join(values.out, "score.json"), JSON.stringify({ rounds, cases: WHERE_CASES, scores, score: recalls, noReads }, null, 2) + "\n");
await writeFile(join(values.out, "samples.json"), JSON.stringify(sampleFile, null, 2) + "\n");
if (gate !== undefined) await writeFile(join(values.out, "gate.json"), JSON.stringify(gate, null, 2) + "\n");
const markdown = whereMarkdown(scores, runs, rounds, gate);
await writeFile(join(values.out, "summary.md"), markdown);
if (process.env["GITHUB_STEP_SUMMARY"] !== undefined) appendFileSync(process.env["GITHUB_STEP_SUMMARY"], markdown);
process.stdout.write(`\n${markdown}`);
process.stdout.write(`\n${sampleFile.samples.length} of ${WHERE_CASES.length} cases gave a sample for the site, from the commit ${sampleFile.commit}.\n`);
for (const problem of sampleProblems) process.stderr.write(`The samples have a problem: ${problem}\n`);

// The Docker client of the harness can keep handles open after the last world stops. Thus the command ends itself.
process.exit(noReads > 0 || sampleProblems.length > 0 ? 2 : gate !== undefined && !gate.pass ? 1 : 0);
