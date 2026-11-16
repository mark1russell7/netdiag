// The command of the where cases of the kernel lab (ND-15). It starts one world for each round, operates each where
// case in the round, and writes the runs and the score of each case. It needs Docker, so only CI starts it (the job
// `where` of the workflow `lab-kernel.yml`).
//
//   node packages/lab/src/kernel/where-main.ts --rounds 5 --out lab-where-out
//
// The exit code is 0 when each run gave a read, and 2 for a run with no read. The cases have no bar yet, so a miss does
// not change the exit code.

import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { authority } from "@netdiag/fixtures";
import { visitRounds } from "../run.ts";
import { WHERE_CASES, readWhere, whereMarkdown, whereScores, type WhereCase } from "./where.ts";
import { kernelTrust, labImage, startKernelRound, wherePlan } from "./world.ts";

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: "5" },
    out: { type: "string", default: "lab-where-out" },
  },
});

const rounds = Number(values.rounds);
const trust = await kernelTrust(await authority("netdiag kernel lab root"));

const runs = await visitRounds(WHERE_CASES, rounds, () => startKernelRound<WhereCase>(trust, labImage(), wherePlan), readWhere, (run) => {
  const line = run.status === "read" ? `${run.hit ? "hit" : "miss"} ${JSON.stringify(run.answer)}` : `no read: ${run.reason}`;
  process.stdout.write(`round ${run.round} ${run.case}: ${line}\n`);
});
const scores = whereScores(WHERE_CASES, runs);

await mkdir(values.out, { recursive: true });
await writeFile(join(values.out, "where.ndjson"), runs.map((run) => JSON.stringify(run)).join("\n") + "\n");
await writeFile(join(values.out, "score.json"), JSON.stringify({ rounds, cases: WHERE_CASES, scores }, null, 2) + "\n");
const markdown = whereMarkdown(scores, runs, rounds);
await writeFile(join(values.out, "summary.md"), markdown);
if (process.env["GITHUB_STEP_SUMMARY"] !== undefined) appendFileSync(process.env["GITHUB_STEP_SUMMARY"], markdown);
process.stdout.write(`\n${markdown}`);

// The Docker client of the harness can keep handles open after the last world stops. Thus the command ends itself.
process.exit(runs.some((run) => run.status === "no-read") ? 2 : 0);
