// The concentration of the repeats of each feature: the fit of the Dirichlet-multinomial law to the repeated observations of the sim.

import { compileCatalog, STANDARD_CATALOG, STANDARD_CATALOG_SPEC, type Catalog } from "@mark1russell7/netdiag";
import { fitConcentration, polyaLogLikelihood, type PolyaUnit } from "@mark1russell7/rigor-statistics";
import { evidenceOfLabel } from "../run.ts";
import { caseVariant, type SimOutcome } from "./report.ts";

/** The file of the standard concentrations in the package `@mark1russell7/netdiag`. The command of the sim writes it with --write. */
export const STANDARD_CONCENTRATIONS_FILE: URL = new URL("../../../netdiag/src/diagnosis/standard-concentrations.ts", import.meta.url);

/** The number of significant digits of a fitted concentration. */
const DIGITS = 3;

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
export function repeatUnits(outcomes: readonly SimOutcome[], catalog: Catalog = STANDARD_CATALOG): Map<string, PolyaUnit[]> {
  const units = new Map<string, PolyaUnit[]>();
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
      list.push({ observations, base });
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
    const fitted = list.length === 0 ? Number.POSITIVE_INFINITY : fitConcentration(list);
    const concentration = Number.isFinite(fitted) ? Number(fitted.toPrecision(DIGITS)) : undefined;
    const agree = list.length === 0 ? 0 : list.filter((unit) => unit.observations.every((value) => value === unit.observations[0])).length / list.length;
    return { feature, concentration, repeats: list.length, agree, gain: repeatGain(list, concentration) };
  });
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

/** This function gives the section of the summary on the concentrations: the fit on its seeds, and the gain on the seeds of the gate. */
export function concentrationSummary(fits: readonly ConcentrationFit[], gate: readonly SimOutcome[], catalog: Catalog = STANDARD_CATALOG): string {
  const units = repeatUnits(gate, catalog);
  const rows = fits
    .filter((fit) => fit.repeats > 0)
    .map((fit) => {
      const held = units.get(fit.feature) ?? [];
      const value = fit.concentration === undefined ? "independent" : String(fit.concentration);
      return `| ${fit.feature} | ${value} | ${fit.repeats} | ${(fit.agree * 100).toFixed(1)} % | ${fit.gain.toFixed(4)} | ${held.length} | ${repeatGain(held, fit.concentration).toFixed(4)} |`;
    });
  return [
    "## The concentrations of the repeats",
    "",
    "The held-out seeds give the concentration of each feature. A gain is the mean log-likelihood gain over independent repeats, in nats, for each case and role with a repeat.",
    "",
    "| Feature | Concentration | Repeats (fit) | Agree | Gain (fit) | Repeats (gate) | Gain (gate) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
