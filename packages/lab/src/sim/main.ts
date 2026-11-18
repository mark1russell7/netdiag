// The command of the simulated world (ND-17, the layer E0). It fits the policy of the actions on held-out seeds, it
// visits the cases of the seeds of the gate with that policy, and it examines the bars.
//
//   pnpm --filter @netdiag/lab sim [--out <folder>] [--write] [--limits <reason>]
//
// Without --write, the command writes no bars. The exit code is 1 when a file of the bars or the file of
// `STANDARD_POLICY` does not have the values of the runs.
// With --out, the command also writes the summary and the outcome of each case into the folder.
// With --limits, the command writes the limits of the correct low end from five seed sets into
// `bars/action-limits.json`, with the reason. Change the limits only with a reason in the PR.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BARS_FOLDER } from "../worlds.ts";
import { fitPolicy, policySource, policySummary, policyText, SIM_FIT_SEEDS, STANDARD_POLICY_FILE } from "./policy.ts";
import {
  actionCalibration,
  actionLimits,
  actionLimitsText,
  actionRates,
  actionsText,
  barsText,
  calibrationText,
  limitProblems,
  SIM_LIMIT_SETS,
  SIM_SEEDS,
  simRuns,
  simSummary,
  withCatalog,
  type ActionLimits,
  type SimActionRate,
  type SimCalibration,
} from "./report.ts";
import { concentrationCatalog, concentrationsSource, concentrationSummary, repeatConcentrations, STANDARD_CONCENTRATIONS_FILE } from "./repeats.ts";

const { values } = parseArgs({ options: { out: { type: "string" }, write: { type: "boolean", default: false }, limits: { type: "string" } } });
const LIMITS_FILE = new URL("action-limits.json", BARS_FOLDER);
// The evidence of a run does not depend on the concentrations. Thus the fit of the concentrations comes first, and the
// fit of the policy and the gate use the catalog with them.
const fitRuns = await simRuns(SIM_FIT_SEEDS);
const concentrations = repeatConcentrations(fitRuns.outcomes);
const catalog = concentrationCatalog(concentrations);
const fit = fitPolicy(withCatalog(fitRuns.outcomes, catalog));
const runs = await simRuns(SIM_SEEDS, fit.policy, catalog);
const limitRuns: string[] = [];
if (values.limits !== undefined) {
  const rates: Readonly<Record<string, SimActionRate>>[] = [];
  const calibrations: SimCalibration[] = [];
  for (const seeds of SIM_LIMIT_SETS) {
    const each = seeds === SIM_SEEDS ? runs : await simRuns(seeds, fit.policy, catalog);
    limitRuns.push(...each.problems.map((problem) => `The limit seeds ${seeds.join(", ")}: ${problem}`));
    rates.push(actionRates(each.outcomes));
    calibrations.push(actionCalibration(each.outcomes));
  }
  await writeFile(LIMITS_FILE, actionLimitsText(actionLimits(values.limits, SIM_LIMIT_SETS, rates, calibrations)));
}
const limits = await readFile(LIMITS_FILE, "utf8").then(
  (text) => JSON.parse(text) as ActionLimits,
  () => undefined,
);
const summary = `${simSummary(runs, limits)}\n${policySummary(fit)}\n${concentrationSummary(concentrations, runs.outcomes, catalog)}`;
if (values.out !== undefined) {
  await mkdir(values.out, { recursive: true });
  await writeFile(join(values.out, "summary.md"), summary);
  const outcomes = runs.outcomes.map((each) => ({ seed: each.seed, case: each.case.id, term: each.case.term, medium: each.case.medium, ipv6: each.case.ipv6, predicted: each.predicted ?? null, reason: each.reason ?? null, visits: each.visits, action: each.action ?? null }));
  await writeFile(join(values.out, "outcomes.json"), `${JSON.stringify(outcomes, null, 2)}\n`);
}
process.stdout.write(summary);
const problems = [...fitRuns.problems.map((problem) => `The fit: ${problem}`), ...fit.problems, ...runs.problems, ...limitRuns];
if (limits === undefined) problems.push("The file bars/action-limits.json has no limits. Start the command with --limits <reason>.");
else problems.push(...limitProblems(actionRates(runs.outcomes), actionCalibration(runs.outcomes), limits));
if (problems.length > 0 || runs.bars.tag === "err") {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(2);
}
let stale = false;
for (const [file, text] of [
  [new URL("sim.json", BARS_FOLDER), barsText(runs.bars.value)],
  [new URL("actions.json", BARS_FOLDER), actionsText(runs.outcomes)],
  [new URL("calibration.json", BARS_FOLDER), calibrationText(runs.outcomes)],
  [new URL("policy.json", BARS_FOLDER), policyText(fit)],
  [STANDARD_POLICY_FILE, policySource(fit.policy)],
  [STANDARD_CONCENTRATIONS_FILE, concentrationsSource(concentrations)],
] as const) {
  if (values.write) await writeFile(file, text);
  else if ((await readFile(file, "utf8").catch(() => "")) !== text) {
    process.stderr.write(`The file ${file.pathname} does not have the values of the runs. Start the command with --write, and tell the reason in the PR.\n`);
    stale = true;
  }
}
if (stale) process.exit(1);
