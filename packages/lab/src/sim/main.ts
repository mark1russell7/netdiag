// The command of the simulated world (ND-17, the layer E0). It visits the cases of 5 seeds, and it examines the bars.
//
//   pnpm --filter @netdiag/lab sim [--out <folder>] [--write]
//
// Without --write, the command writes no bars. The exit code is 1 when bars/sim.json does not have the bars of the runs.
// With --out, the command also writes the summary and the outcome of each case into the folder.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BARS_FOLDER } from "../worlds.ts";
import { barsText, simRuns, simSummary } from "./report.ts";

const { values } = parseArgs({ options: { out: { type: "string" }, write: { type: "boolean", default: false } } });
const runs = await simRuns();
const summary = simSummary(runs);
if (values.out !== undefined) {
  await mkdir(values.out, { recursive: true });
  await writeFile(join(values.out, "summary.md"), summary);
  const outcomes = runs.outcomes.map((each) => ({ seed: each.seed, case: each.case.id, term: each.case.term, medium: each.case.medium, ipv6: each.case.ipv6, predicted: each.predicted ?? null, reason: each.reason ?? null, visits: each.visits }));
  await writeFile(join(values.out, "outcomes.json"), `${JSON.stringify(outcomes, null, 2)}\n`);
}
process.stdout.write(summary);
if (runs.problems.length > 0 || runs.bars.tag === "err") {
  process.stderr.write(`${runs.problems.join("\n")}\n`);
  process.exit(2);
}
const file = new URL("sim.json", BARS_FOLDER);
const text = barsText(runs.bars.value);
if (values.write) await writeFile(file, text);
else if ((await readFile(file, "utf8").catch(() => "")) !== text) {
  process.stderr.write("The file bars/sim.json does not have the bars of the runs. Start the command with --write, and tell the reason in the PR.\n");
  process.exit(1);
}
