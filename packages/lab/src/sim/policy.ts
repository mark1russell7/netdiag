// The fit of the action policy of netdiag on the simulated world (ND-18). The fit uses seeds that the gate does not
// use. A coordinate descent on a grid of pairs of temperatures finds the calibration map, and then a sweep of harmful
// costs finds the least cost that keeps the harm of each class at the limit or under it, on each fit set.

import { checkPolicy, type ActionCosts, type ActionPolicy, type Calibration } from "@mark1russell7/netdiag";
import { brier } from "@mark1russell7/rigor-statistics";
import { actionClasses, harmHighOf, SIM_HARM_LIMIT, truthForecasts, withPolicy, type SimOutcome } from "./report.ts";

/**
 * The sets of five seeds of the fit of the policy: 101 to 125. The gate examines one set of five seeds, thus the harmful
 * cost must keep the harm at the limit on each fit set. The gate uses `SIM_SEEDS`, thus the fit and the gate share no plan.
 */
export const SIM_FIT_SETS: readonly (readonly number[])[] = [0, 1, 2, 3, 4].map((set) => [1, 2, 3, 4, 5].map((seed) => 100 + set * 5 + seed));

/** The seeds of the fit of the policy: the seeds of each fit set. */
export const SIM_FIT_SEEDS: readonly number[] = SIM_FIT_SETS.flat();

/**
 * The temperatures of the grid of the calibration map, from 1/16 to 16, to 3 places. Each temperature is the one before
 * it multiplied by the square root of 2. A pair of the grid is a cause temperature and a variant temperature.
 */
export const SIM_TEMPERATURES: readonly number[] = Array.from({ length: 17 }, (_, index) => Math.round(2 ** (index / 2 - 4) * 1000) / 1000);

/** The harmful costs of the second sweep, from the least. Each is more than the cost of a useless action. */
export const SIM_HARM_COSTS: readonly number[] = [1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 70, 100];

/** The costs that the fit does not change. `none` is the unit. A useless action does no harm, thus it costs as much as `none`. */
export const SIM_UNIT_COSTS: Omit<ActionCosts, "harmful"> = { none: 1, useless: 1 };

/** The file of `STANDARD_POLICY` in the package `@mark1russell7/netdiag`. The command of the sim writes it with --write. */
export const STANDARD_POLICY_FILE: URL = new URL("../../../netdiag/src/diagnosis/standard-policy.ts", import.meta.url);

/** One step of the descent on the grid: the calibration map, and the Brier score of the kind probabilities of the fit with it. */
export interface TemperatureStep {
  readonly calibration: Calibration;
  readonly brier: number;
}

/** One step of the sweep of costs: the class with the most harm, its harm high end, and the correct rate of all cases. */
export interface CostStep {
  readonly harmful: number;
  /** The class with the highest harm high end of all fit sets. */
  readonly worst: string;
  /** The highest harm high end of all fit sets. */
  readonly harmHigh: number;
  /** The highest harm high end of the classes in each fit set. */
  readonly sets: readonly number[];
  readonly correct: number;
}

/** The fit of the policy: its seed sets, the steps of the two sweeps, the policy that they choose, and the problems. */
export interface PolicyFit {
  readonly sets: readonly (readonly number[])[];
  /** The calibration map with the least Brier score, and the least harmful cost whose harm high end is at the limit or under it. */
  readonly policy: ActionPolicy;
  readonly temperatures: readonly TemperatureStep[];
  readonly costs: readonly CostStep[];
  /** The problems of the fit. A temperature at an end of the sweep, or no harmful cost that keeps the harm at the limit, gives a problem. */
  readonly problems: readonly string[];
}

const third = (value: number): number => Math.round(value * 1000) / 1000;
const fourth = (value: number): number => Math.round(value * 10_000) / 10_000;

/** This function gives the Brier score of the kind probabilities of the outcomes with a truth, with a calibration map. */
export function kindBrier(outcomes: readonly SimOutcome[], calibration: Calibration): number {
  return brier(outcomes.flatMap((each) => (each.truth === undefined ? [] : truthForecasts(each.truth, calibration))));
}

const worstHarm = (outcomes: readonly SimOutcome[]): { readonly label: string; readonly high: number } => {
  let worst = { label: "", high: -1 };
  for (const [label, rows] of actionClasses(outcomes)) {
    const ends = harmHighOf(label, rows);
    const high = Math.max(ends.wilson, ends.bootstrap);
    if (high > worst.high) worst = { label, high };
  }
  return worst;
};

/**
 * This function gives the step of one harmful cost: the class with the most harm, the high end of its gate, and the
 * correct rate. The harm high end is the highest of the fit sets. A set with no outcomes has the high end -1.
 */
export function costStep(outcomes: readonly SimOutcome[], policy: ActionPolicy, sets: readonly (readonly number[])[] = SIM_FIT_SETS): CostStep {
  const chosen = withPolicy(outcomes, policy);
  const highs = sets.map((seeds) => worstHarm(chosen.filter((each) => seeds.includes(each.seed))));
  const worst = highs.reduce((most, each) => (each.high > most.high ? each : most), { label: "", high: -1 });
  const acted = chosen.filter((each) => each.action !== undefined);
  const correct = acted.filter((each) => each.action?.taken === each.action?.correct).length / acted.length;
  return { harmful: policy.costs.harmful, worst: worst.label, harmHigh: third(worst.high), sets: highs.map((each) => third(each.high)), correct: third(correct) };
}

/**
 * This function fits the policy on the outcomes of the fit seeds.
 *
 * - The calibration map comes from a coordinate descent on the pairs of `SIM_TEMPERATURES`, from the pair (1, 1). Each
 *   round finds the best cause temperature for the variant temperature, and then the best variant temperature for it.
 *   The descent stops when a round changes no temperature.
 * - The Brier scores have 4 places. The data cannot tell apart two maps with the same score, thus a tie goes to the
 *   temperature nearest 1. That map changes the diagnosis least.
 * - The Brier score is of the outcomes of all fit sets.
 * - The harmful cost is the least cost of `SIM_HARM_COSTS` whose harm high end is at `SIM_HARM_LIMIT` or under it, on each set.
 * - With no such cost, the fit takes the highest cost and gives a problem. A set with no outcomes also gives a problem.
 */
export function fitPolicy(outcomes: readonly SimOutcome[], sets: readonly (readonly number[])[] = SIM_FIT_SETS): PolicyFit {
  const policyAt = (calibration: Calibration, harmful: number): ActionPolicy => ({ calibration, costs: { ...SIM_UNIT_COSTS, harmful } });
  const temperatures: TemperatureStep[] = [];
  const scoreOf = (calibration: Calibration): number => {
    const known = temperatures.find((step) => step.calibration.cause === calibration.cause && step.calibration.variant === calibration.variant);
    if (known !== undefined) return known.brier;
    const step = { calibration, brier: fourth(kindBrier(outcomes, calibration)) };
    temperatures.push(step);
    return step.brier;
  };
  const bestOf = (axis: keyof Calibration, make: (temperature: number) => Calibration): Calibration =>
    SIM_TEMPERATURES.map(make).reduce((best, each) => {
      const [score, bestScore] = [scoreOf(each), scoreOf(best)];
      return score < bestScore || (score === bestScore && Math.abs(Math.log(each[axis])) < Math.abs(Math.log(best[axis]))) ? each : best;
    });
  let calibration: Calibration = { cause: 1, variant: 1 };
  for (let round = 0; round < SIM_TEMPERATURES.length; round++) {
    const cause = bestOf("cause", (temperature) => ({ cause: temperature, variant: calibration.variant })).cause;
    const next = bestOf("variant", (temperature) => ({ cause, variant: temperature }));
    if (next.cause === calibration.cause && next.variant === calibration.variant) break;
    calibration = next;
  }
  const problems: string[] = [];
  for (const seeds of sets) {
    if (!outcomes.some((each) => seeds.includes(each.seed))) problems.push(`The fit set of the seeds ${seeds.join(", ")} has no outcomes.`);
  }
  const ends = [SIM_TEMPERATURES[0], SIM_TEMPERATURES[SIM_TEMPERATURES.length - 1]];
  for (const [name, temperature] of Object.entries(calibration)) {
    if (ends.includes(temperature)) problems.push(`The ${name} temperature ${temperature} is at an end of the sweep. Make the sweep wider.`);
  }
  const costs = SIM_HARM_COSTS.map((harmful) => costStep(outcomes, policyAt(calibration, harmful), sets));
  const passed = costs.find((step) => step.harmHigh <= SIM_HARM_LIMIT);
  if (passed === undefined) problems.push(`No harmful cost of the sweep keeps the harm of each class at ${SIM_HARM_LIMIT} or under it on each fit set.`);
  const policy = policyAt(calibration, passed?.harmful ?? SIM_HARM_COSTS[SIM_HARM_COSTS.length - 1] ?? 100);
  problems.push(...checkPolicy(policy));
  return { sets, policy, temperatures, costs, problems };
}

/** This function gives the text of the file `bars/policy.json`: the seed sets, the policy and the steps of the two sweeps. */
export function policyText(fit: PolicyFit): string {
  return `${JSON.stringify({ sets: fit.sets, policy: fit.policy, temperatures: fit.temperatures, costs: fit.costs }, null, 2)}\n`;
}

/** This function gives the text of the file of `STANDARD_POLICY` for a policy. */
export function policySource(policy: ActionPolicy): string {
  const { calibration, costs } = policy;
  return `// This file is data. The command of the simulated world of the lab writes it with --write, from seeds that its gate does not use.

import type { ActionPolicy } from "./actions.ts";

/**
 * The policy of \`chooseAction\` for \`STANDARD_CATALOG\` and \`STANDARD_ACTIONS\`.
 *
 * - The two temperatures give the least Brier score of the kind probabilities on the held-out seeds of the sim.
 * - The harmful cost is the least cost that keeps the harm of each class at the limit or under it, on each seed set.
 */
export const STANDARD_POLICY: ActionPolicy = { calibration: { cause: ${calibration.cause}, variant: ${calibration.variant} }, costs: { none: ${costs.none}, useless: ${costs.useless}, harmful: ${costs.harmful} } };
`;
}

/** This function gives the summary of the fit as Markdown: the policy, a grid of the Brier scores, and a table of the costs. */
export function policySummary(fit: PolicyFit): string {
  const { policy } = fit;
  const { cause, variant } = policy.calibration;
  const cellOf = (c: number, v: number): string => {
    const step = fit.temperatures.find((each) => each.calibration.cause === c && each.calibration.variant === v);
    return step === undefined ? "–" : `${step.brier}${c === cause && v === variant ? " (chosen)" : ""}`;
  };
  const lines = [
    "## The policy of the actions",
    "",
    `The fit uses ${fit.sets.length} sets of seeds, from ${fit.sets[0]?.[0]} to ${fit.sets.at(-1)?.at(-1)}. The gate does not use them. The policy has the cause temperature ${cause}, the variant temperature ${variant} and the harmful cost ${policy.costs.harmful}.`,
    "",
    "The Brier score of the kind probabilities at each pair of temperatures of the descent. The rows are the cause temperatures, and the columns are the variant temperatures.",
    "",
    `| Cause \\ variant | ${SIM_TEMPERATURES.join(" | ")} |`,
    `| --- | ${SIM_TEMPERATURES.map(() => "---").join(" | ")} |`,
    ...SIM_TEMPERATURES.filter((c) => fit.temperatures.some((step) => step.calibration.cause === c)).map((c) => `| ${c} | ${SIM_TEMPERATURES.map((v) => cellOf(c, v)).join(" | ")} |`),
    "",
    `| Harmful cost | The class with the most harm | Its harm high end | The worst high end of each set | Correct, all classes |`,
    "| --- | --- | --- | --- | --- |",
    ...fit.costs.map((step) => `| ${step.harmful}${step.harmful === policy.costs.harmful ? " (chosen)" : ""} | ${step.worst} | ${step.harmHigh} | ${step.sets.join(", ")} | ${Math.round(step.correct * 1000) / 10} % |`),
  ];
  if (fit.problems.length > 0) lines.push("", ...fit.problems.map((problem) => `- ${problem}`));
  return `${lines.join("\n")}\n`;
}
