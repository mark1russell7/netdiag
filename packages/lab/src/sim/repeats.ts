// The concentration of the repeats of each feature: the fit of the Dirichlet-multinomial law to the repeated observations of the sim.

import { compileCatalog, STANDARD_CATALOG, STANDARD_CATALOG_SPEC, type Catalog } from "@mark1russell7/netdiag";
import { bootstrapClusters, fitConcentration, polyaLogLikelihood, type Interval, type PolyaUnit } from "@mark1russell7/rigor-statistics";
import { evidenceOfLabel } from "../run.ts";
import { caseVariant, type SimOutcome } from "./report.ts";

/** The file of the standard concentrations in the package `@mark1russell7/netdiag`. The command of the sim writes it with --write. */
export const STANDARD_CONCENTRATIONS_FILE: URL = new URL("../../../netdiag/src/diagnosis/standard-concentrations.ts", import.meta.url);

/** The number of significant digits of a fitted concentration. */
const DIGITS = 3;

/**
 * The low end of the search of a concentration, on a log scale. A fit at this end is not an interior fit. The data then
 * tell only that the repeats are copies, and the summary gives the value as "at or under 1e-6".
 */
export const CONCENTRATION_LOW = 1e-6;

/** The number of runs of the bootstrap of a concentration. Each run fits the concentration again, so the count is small. */
export const CONCENTRATION_BOOTSTRAP_RUNS = 200;

/** The repeated observations of one feature, one case and one role, with the case. The bootstrap draws the cases. */
export interface CaseUnit extends PolyaUnit {
  /** The seed and the id of the case. */
  readonly case: string;
}

/** The fit of the repeats of one feature. */
export interface ConcentrationFit {
  readonly feature: string;
  /** The fitted concentration. No value tells that independent repeats explain the observations equally well or better. */
  readonly concentration: number | undefined;
  /** The number of cases and roles with two or more observations of the feature. */
  readonly repeats: number;
  /** The share of the cases and roles with a repeat whose observations all agree. */
  readonly agree: number;
  /** The mean gain of the log-likelihood over independent repeats, in nats, for each case and role with a repeat. */
  readonly gain: number;
}

/**
 * This function gives the repeated observations of each feature. It gives one unit for each case and role with two or
 * more observations. Each unit has the likelihood of each value under the variant of the case. A case with two faults gives no unit,
 * because the variant of one fault does not give the likelihoods of its features.
 */
export function repeatUnits(outcomes: readonly SimOutcome[], catalog: Catalog = STANDARD_CATALOG): Map<string, CaseUnit[]> {
  const units = new Map<string, CaseUnit[]>();
  for (const each of outcomes) {
    if (each.evidence === undefined) continue;
    const variant = caseVariant(each.case, catalog);
    if (variant === undefined || variant.faults > 1) continue;
    const groups = new Map<string, { feature: string; primary: boolean; observations: string[] }>();
    for (const item of each.evidence.map(evidenceOfLabel)) {
      const key = `${item.feature}\u0000${item.primary ? 1 : 0}`;
      const group = groups.get(key) ?? { feature: item.feature, primary: item.primary, observations: [] };
      group.observations.push(item.value);
      groups.set(key, group);
    }
    for (const { feature, primary, observations } of groups.values()) {
      const known = catalog.features.get(feature);
      if (known === undefined || observations.length < 2) continue;
      const base = Object.fromEntries(known.values.map((value) => [value, catalog.likelihood(variant.hypothesis, feature, value, primary, variant.reach, variant.degree)]));
      const list = units.get(feature) ?? [];
      list.push({ observations, base, case: `${String(each.seed)}:${each.case.id}` });
      units.set(feature, list);
    }
  }
  return units;
}

/** This function gives the mean gain of the log-likelihood of the units over independent repeats, in nats, with a concentration. */
export function repeatGain(units: readonly PolyaUnit[], concentration: number | undefined): number {
  if (units.length === 0 || concentration === undefined) return 0;
  const gain = units.reduce((sum, unit) => sum + polyaLogLikelihood(unit.observations, unit.base, concentration) - polyaLogLikelihood(unit.observations, unit.base, Number.POSITIVE_INFINITY), 0);
  return gain / units.length;
}

/**
 * This function fits the concentration of the repeats of each feature of the catalog, in the order of the catalog. A
 * feature with no repeat, or with a fit of independent repeats, gets no concentration.
 */
export function repeatConcentrations(outcomes: readonly SimOutcome[], catalog: Catalog = STANDARD_CATALOG): ConcentrationFit[] {
  const units = repeatUnits(outcomes, catalog);
  return [...catalog.features.keys()].map((feature) => {
    const list = units.get(feature) ?? [];
    const fitted = list.length === 0 ? Number.POSITIVE_INFINITY : fitConcentration(list, { low: CONCENTRATION_LOW });
    const concentration = Number.isFinite(fitted) ? Number(fitted.toPrecision(DIGITS)) : undefined;
    const agree = list.length === 0 ? 0 : list.filter((unit) => unit.observations.every((value) => value === unit.observations[0])).length / list.length;
    return { feature, concentration, repeats: list.length, agree, gain: repeatGain(list, concentration) };
  });
}

/**
 * This function gives a 95 % interval of each fitted concentration from the units of `repeatUnits`. The bootstrap draws
 * the cases again, and the units of a drawn case come with it. A run that fits independent repeats gives no finite
 * value, and the interval tells the count of the finite runs. A feature with no fitted concentration gets no interval.
 */
export function concentrationIntervals(units: ReadonlyMap<string, readonly CaseUnit[]>, fits: readonly ConcentrationFit[], runs: number = CONCENTRATION_BOOTSTRAP_RUNS): ReadonlyMap<string, Interval> {
  const intervals = new Map<string, Interval>();
  for (const fit of fits) {
    const list = units.get(fit.feature) ?? [];
    if (fit.concentration === undefined || list.length === 0) continue;
    intervals.set(fit.feature, bootstrapClusters(list, (unit) => unit.case, (sample) => fitConcentration(sample, { low: CONCENTRATION_LOW }), { runs, level: 0.95, seed: `concentration:${fit.feature}` }));
  }
  return intervals;
}

/**
 * This function gives the text of a fitted concentration. A value at `CONCENTRATION_LOW` after the rounding to `DIGITS`
 * digits is at the end of the search, thus the text is "at or under 1e-6".
 */
export function concentrationText(concentration: number | undefined): string {
  if (concentration === undefined) return "independent";
  return Number(concentration.toPrecision(DIGITS)) <= CONCENTRATION_LOW ? `at or under ${CONCENTRATION_LOW.toExponential()}` : String(concentration);
}

/** This function gives the text of an interval of a concentration, with the count of its finite runs. */
export function intervalText(interval: Interval | undefined): string {
  if (interval === undefined) return "-";
  const end = (value: number): string => (Number(value.toPrecision(DIGITS)) <= CONCENTRATION_LOW ? `at or under ${CONCENTRATION_LOW.toExponential()}` : value.toPrecision(DIGITS));
  const ends = `${end(interval.low)} to ${end(interval.high)}`;
  return interval.finite === interval.runs ? ends : `${ends} (${String(interval.finite)} of ${String(interval.runs)} runs finite)`;
}

/** This function gives the standard catalog with the fitted concentrations. A feature with no fitted concentration has independent repeats. */
export function concentrationCatalog(fits: readonly ConcentrationFit[]): Catalog {
  const byFeature = new Map(fits.map((fit) => [fit.feature, fit.concentration]));
  const compiled = compileCatalog({ ...STANDARD_CATALOG_SPEC, features: STANDARD_CATALOG_SPEC.features.map((feature) => ({ ...feature, concentration: byFeature.get(feature.id) })) });
  if (compiled.tag === "err") throw new Error(`The catalog with the fitted concentrations has problems: ${compiled.error.join(" ")}`);
  return compiled.value;
}

/** This function gives the fitted concentrations as a record, for `STANDARD_CONCENTRATIONS`. */
export function concentrationRecord(fits: readonly ConcentrationFit[]): Record<string, number> {
  return Object.fromEntries(fits.flatMap((fit) => (fit.concentration === undefined ? [] : [[fit.feature, fit.concentration]])));
}

/** This function gives the source of the file of the standard concentrations. */
export function concentrationsSource(fits: readonly ConcentrationFit[]): string {
  const entries = Object.entries(concentrationRecord(fits)).map(([feature, concentration]) => `  "${feature}": ${concentration},`);
  const body = entries.length === 0 ? "{}" : `{\n${entries.join("\n")}\n}`;
  return `// This file is data. The command of the simulated world of the lab writes it with --write, from seeds that its gate does not use.

/**
 * The concentration of the repeats of each feature of \`STANDARD_CATALOG\`. It is the fit of the Dirichlet-multinomial law to
 * the repeated observations of the held-out seeds of the sim. A feature with no entry has independent repeats.
 */
export const STANDARD_CONCENTRATIONS: Readonly<Record<string, number>> = ${body};
`;
}

/**
 * This function gives the section of the summary on the concentrations. Each row has the fit on its seeds with its
 * interval, and the gain on the seeds of the gate.
 */
export function concentrationSummary(fits: readonly ConcentrationFit[], gate: readonly SimOutcome[], catalog: Catalog = STANDARD_CATALOG, intervals: ReadonlyMap<string, Interval> = new Map()): string {
  const units = repeatUnits(gate, catalog);
  const rows = fits
    .filter((fit) => fit.repeats > 0)
    .map((fit) => {
      const held = units.get(fit.feature) ?? [];
      return `| ${fit.feature} | ${concentrationText(fit.concentration)} | ${intervalText(intervals.get(fit.feature))} | ${fit.repeats} | ${(fit.agree * 100).toFixed(1)} % | ${fit.gain.toFixed(4)} | ${held.length} | ${repeatGain(held, fit.concentration).toFixed(4)} |`;
    });
  return [
    "## The concentrations of the repeats",
    "",
    "The held-out seeds give the concentration of each feature. The interval is a 95 % bootstrap that draws the cases of the held-out seeds again. A gain is the mean log-likelihood gain over independent repeats, in nats, for each case and role with a repeat.",
    "",
    "| Feature | Concentration | 95 % interval | Repeats (fit) | Agree | Gain (fit) | Repeats (gate) | Gain (gate) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
