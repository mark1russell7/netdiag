// The command of the bars of the gate (ND-7, step 4). It reads the file `score.json` of 5 or more runs of one lab, and
// writes the bar of each hypothesis that each run reads.
//
//   node packages/lab/src/bars-main.ts --out packages/lab/bars/kernel.json run-1 run-2 run-3 run-4 run-5
//
// The option --title sets the heading of the table, for example for the where cases of the kernel lab.
//
// Each argument is the folder of one run, or its file `score.json`. The exit code is 0 when the command wrote the bars,
// and 2 when a run gives no bars.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { labBars, type LabRecalls } from "@mark1russell7/netdiag";
import { barsMarkdown, runScore, type RunScoreFile } from "./bars.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    k: { type: "string", default: "2" },
    minimum: { type: "string", default: "5" },
    title: { type: "string", default: "The bars of the gate" },
  },
});

if (values.out === undefined) throw new Error("The option --out <file> is necessary.");
const problems: string[] = [];
const names: string[] = [];
const scores: LabRecalls[] = [];
for (const path of positionals) {
  const file = path.endsWith(".json") ? path : join(path, "score.json");
  const name = path.endsWith(".json") ? basename(dirname(path)) : basename(path);
  const score = runScore(name, JSON.parse(await readFile(file, "utf8")) as RunScoreFile);
  if (score.tag === "err") problems.push(score.error);
  else {
    names.push(name);
    scores.push(score.value);
  }
}
const bars = problems.length > 0 ? undefined : labBars(scores, { k: Number(values.k), minimum: Number(values.minimum) });
if (bars === undefined || bars.tag === "err") {
  for (const problem of bars?.tag === "err" ? bars.error : problems) process.stderr.write(`${problem}\n`);
  process.exit(2);
}

await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify(bars.value, null, 2) + "\n");
process.stdout.write(barsMarkdown(names, scores, bars.value, values.title));
