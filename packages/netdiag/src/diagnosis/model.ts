import { err, ok, type Result } from "@mark1russell7/optional";
import type { Layer } from "../layer.ts";

/** A probability for each value of a feature. The probabilities are more than 0, and their sum is 1. */
export type Distribution = Readonly<Record<string, number>>;

/**
 * A feature is one discrete observation that the facts give, for example the outcome of a TCP connect.
 *
 * The distribution `healthy` gives the probability of each value when the network has no fault.
 */
export interface Feature {
  readonly id: string;
  readonly layer: Layer;
  readonly summary: string;
  readonly values: readonly string[];
  readonly healthy: Distribution;
}

/** The parts of the model. Each fault is in one part. */
export const PARTS = ["interface", "wifi", "gateway", "resolver", "path", "service"] as const;

/** A part of the model: the network interface, the Wi-Fi link, the gateway, the DNS resolver, the path or the remote service. */
export type Part = (typeof PARTS)[number];

/**
 * The reach of a fault.
 *
 * - `shared`: the fault changes the observations of each host, for example a TLS proxy of the local network.
 * - `target`: the fault changes only the observations of the primary target, for example a slow server.
 */
export type Reach = "shared" | "target";

/**
 * The strength of a prediction. The rules of practice use these strengths. The lab runs then replace them with fitted
 * distributions.
 */
export type Strength = "sure" | "strong" | "usual" | "weak";

/** The probability that each strength gives to the expected values together. */
export const STRENGTHS: Readonly<Record<Strength, number>> = { sure: 0.98, strong: 0.9, usual: 0.75, weak: 0.6 };

/**
 * A prediction of a fault for one feature: a full distribution, or the expected values and a strength.
 *
 * With `expect`, the expected values share the probability of the strength equally. The other values share the rest.
 */
export type Prediction = Distribution | Expectation;

/** The expected values of a feature, and the strength of the prediction. */
export interface Expectation {
  readonly expect: string | readonly string[];
  readonly strength: Strength;
}

function isExpectation(prediction: Prediction): prediction is Expectation {
  return typeof prediction.strength === "string";
}

/**
 * A fault of the catalog.
 *
 * The fault predicts a distribution for each feature that it changes. For each other feature, it predicts the
 * distribution `healthy` of the feature. The prior is a relative weight. The default prior is 1.
 */
export interface Fault {
  readonly id: string;
  readonly part: Part;
  readonly reach: Reach;
  /** The cause in plain words, for example "No program listens on the port." */
  readonly summary: string;
  /** The next step for the user in plain words. */
  readonly step: string;
  readonly prior?: number | undefined;
  readonly predicts: Readonly<Record<string, Prediction>>;
}

/** The data of a catalog: the features, the faults, and the priors of the hypotheses "no fault" and "unknown cause". */
export interface CatalogSpec {
  readonly version: string;
  readonly features: readonly Feature[];
  readonly faults: readonly Fault[];
  readonly priors?: { readonly none?: number | undefined; readonly unknown?: number | undefined } | undefined;
}

/**
 * A hypothesis of the model.
 *
 * - `none`: the network has no fault.
 * - `fault`: one fault of the catalog.
 * - `unknown`: a cause that the catalog does not have. It gives each value of a feature the same probability.
 */
export interface Hypothesis {
  readonly id: string;
  readonly kind: "none" | "fault" | "unknown";
  readonly summary: string;
  readonly step: string;
  readonly part?: Part | undefined;
  readonly reach?: Reach | undefined;
}

/** The id of the hypothesis "no fault". */
export const NONE = "none";
/** The id of the hypothesis "unknown cause". */
export const UNKNOWN = "unknown";

/** A catalog with each distribution in its full form, and the logarithms of the probabilities. */
export interface Catalog {
  readonly version: string;
  readonly features: ReadonlyMap<string, Feature>;
  readonly hypotheses: readonly Hypothesis[];
  /** This function gives the probability of a value of a feature under a hypothesis, for a primary or a reference host. */
  likelihood(hypothesis: string, feature: string, value: string, primary: boolean): number;
  prior(hypothesis: string): number;
}

/** The lowest probability of a value. With a probability of 0, one wrong observation removes a cause. */
export const FLOOR = 0.001;

const SUM_TOLERANCE = 1e-9;

function distributionProblems(where: string, feature: Feature, dist: Distribution): string[] {
  const problems: string[] = [];
  for (const value of Object.keys(dist)) if (!feature.values.includes(value)) problems.push(`${where}: "${value}" is not a value of ${feature.id}.`);
  for (const value of feature.values) {
    const p = dist[value];
    if (p === undefined) problems.push(`${where}: the value "${value}" of ${feature.id} has no probability.`);
    else if (!Number.isFinite(p) || p < FLOOR) problems.push(`${where}: the probability of "${value}" is ${p}. It must be ${FLOOR} or more.`);
  }
  const sum = Object.values(dist).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > SUM_TOLERANCE) problems.push(`${where}: the sum of the probabilities is ${sum}, not 1.`);
  return problems;
}

/** This function gives the full distribution of a prediction, or the problems of the prediction. */
export function expand(feature: Feature, prediction: Prediction): Result<Distribution, string[]> {
  if (!isExpectation(prediction)) return ok(prediction);
  const expected = typeof prediction.expect === "string" ? [prediction.expect] : [...prediction.expect];
  const unknown = expected.filter((value) => !feature.values.includes(value));
  if (unknown.length > 0) return err(unknown.map((value) => `"${value}" is not a value of ${feature.id}.`));
  if (expected.length === 0 || new Set(expected).size !== expected.length) return err([`The expected values of ${feature.id} are empty or repeated.`]);
  const others = feature.values.filter((value) => !expected.includes(value));
  const mass = others.length === 0 ? 1 : STRENGTHS[prediction.strength];
  const dist: Record<string, number> = {};
  for (const value of expected) dist[value] = mass / expected.length;
  for (const value of others) dist[value] = (1 - mass) / others.length;
  return ok(dist);
}

const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

/**
 * This function examines a catalog and makes its tables.
 *
 * It refuses a repeated id, an unknown feature or value, a probability below `FLOOR`, and a distribution with a sum that is not 1.
 */
export function compileCatalog(spec: CatalogSpec): Result<Catalog, string[]> {
  const problems: string[] = [];
  const features = new Map<string, Feature>();
  for (const feature of spec.features) {
    if (!ID.test(feature.id)) problems.push(`"${feature.id}" is not a valid feature id.`);
    if (features.has(feature.id)) problems.push(`The feature ${feature.id} is repeated.`);
    if (feature.values.length < 2 || new Set(feature.values).size !== feature.values.length) {
      problems.push(`The feature ${feature.id} must have two or more different values.`);
    }
    problems.push(...distributionProblems(`healthy of ${feature.id}`, feature, feature.healthy));
    features.set(feature.id, feature);
  }
  const hypotheses: Hypothesis[] = [{ id: NONE, kind: "none", summary: "The network has no fault.", step: "No step is necessary." }];
  const priors = new Map<string, number>([[NONE, spec.priors?.none ?? 1]]);
  const tables = new Map<string, Map<string, Distribution>>();
  for (const fault of spec.faults) {
    if (!ID.test(fault.id) || fault.id === NONE || fault.id === UNKNOWN) problems.push(`"${fault.id}" is not a valid fault id.`);
    if (priors.has(fault.id)) problems.push(`The fault ${fault.id} is repeated.`);
    priors.set(fault.id, fault.prior ?? 1);
    hypotheses.push({ id: fault.id, kind: "fault", summary: fault.summary, step: fault.step, part: fault.part, reach: fault.reach });
    const table = new Map<string, Distribution>();
    for (const [featureId, prediction] of Object.entries(fault.predicts)) {
      const feature = features.get(featureId);
      if (feature === undefined) {
        problems.push(`The fault ${fault.id} predicts the unknown feature ${featureId}.`);
        continue;
      }
      const dist = expand(feature, prediction);
      if (dist.tag === "err") problems.push(...dist.error.map((problem) => `${fault.id}: ${problem}`));
      else {
        problems.push(...distributionProblems(`${fault.id} for ${featureId}`, feature, dist.value));
        table.set(featureId, dist.value);
      }
    }
    if (table.size === 0) problems.push(`The fault ${fault.id} predicts no feature.`);
    tables.set(fault.id, table);
  }
  hypotheses.push({
    id: UNKNOWN,
    kind: "unknown",
    summary: "The catalog does not have the cause.",
    step: "Collect more facts, and report the facts as a new fault of the catalog.",
  });
  priors.set(UNKNOWN, spec.priors?.unknown ?? 1);
  for (const [id, prior] of priors) if (!Number.isFinite(prior) || prior <= 0) problems.push(`The prior of ${id} is ${prior}. It must be more than 0.`);
  if (problems.length > 0) return err(problems);

  const total = [...priors.values()].reduce((a, b) => a + b, 0);
  const reach = new Map(hypotheses.map((h) => [h.id, h.reach]));
  return ok({
    version: spec.version,
    features,
    hypotheses,
    prior: (hypothesis) => (priors.get(hypothesis) ?? 0) / total,
    likelihood(hypothesis, featureId, value, primary) {
      const feature = features.get(featureId);
      if (feature === undefined || !feature.values.includes(value)) return Number.NaN;
      if (hypothesis === UNKNOWN) return 1 / feature.values.length;
      const fault = tables.get(hypothesis);
      const changed = fault?.get(featureId);
      const applies = primary || reach.get(hypothesis) === "shared";
      return (applies && changed !== undefined ? changed : feature.healthy)[value] ?? Number.NaN;
    },
  });
}

/**
 * One observation of a feature.
 *
 * `primary` tells if the observation is of the primary target or of a reference host. `facts` gives the ids of the facts
 * that gave the observation, for the explanation.
 */
export interface Evidence {
  readonly feature: string;
  readonly value: string;
  readonly primary: boolean;
  readonly facts?: readonly string[] | undefined;
}

/** A cause with its probability. */
export interface Cause extends Hypothesis {
  readonly probability: number;
}

/** The result of a diagnosis: the causes from the most probable, and the evidence that the model did not use, with the reason. */
export interface Diagnosis {
  readonly causes: readonly Cause[];
  readonly used: readonly Evidence[];
  readonly ignored: readonly { readonly evidence: Evidence; readonly reason: string }[];
}

function usable(catalog: Catalog, evidence: readonly Evidence[]): Pick<Diagnosis, "used" | "ignored"> {
  const used: Evidence[] = [];
  const ignored: { evidence: Evidence; reason: string }[] = [];
  for (const item of evidence) {
    const feature = catalog.features.get(item.feature);
    if (feature === undefined) ignored.push({ evidence: item, reason: `The catalog has no feature ${item.feature}.` });
    else if (!feature.values.includes(item.value)) ignored.push({ evidence: item, reason: `"${item.value}" is not a value of ${item.feature}.` });
    else used.push(item);
  }
  return { used, ignored };
}

/**
 * This function gives the probability of each hypothesis from the evidence, with the rule of Bayes.
 *
 * The model takes the observations as independent for a given hypothesis. The calculation uses logarithms, so a long
 * list of evidence does not go to zero. The order of the evidence does not change the result.
 * An exact tie keeps the order of the catalog, with "no fault" first.
 */
export function diagnose(catalog: Catalog, evidence: readonly Evidence[]): Diagnosis {
  const { used, ignored } = usable(catalog, evidence);
  const logs = catalog.hypotheses.map((h) => {
    let sum = Math.log(catalog.prior(h.id));
    for (const item of used) sum += Math.log(catalog.likelihood(h.id, item.feature, item.value, item.primary));
    return sum;
  });
  const top = Math.max(...logs);
  const weights = logs.map((log) => Math.exp(log - top));
  const total = weights.reduce((a, b) => a + b, 0);
  // An exact tie keeps the order of the catalog: "no fault" first, then the faults, then "unknown cause". Thus a fault
  // whose features are not observed does not come before "no fault".
  const causes = catalog.hypotheses
    .map((h, i) => ({ ...h, probability: (weights[i] ?? 0) / total, order: i }))
    .sort((a, b) => b.probability - a.probability || a.order - b.order)
    .map(({ order: _order, ...cause }) => cause);
  return { causes, used, ignored };
}

/** The part of one observation in the comparison of two hypotheses. */
export interface Contribution {
  readonly evidence: Evidence;
  /** The ratio of the likelihoods of the two hypotheses, as a base-10 logarithm. 1 is a factor of 10 for the first hypothesis. */
  readonly weight: number;
}

/**
 * This function tells why the model prefers one hypothesis to a second hypothesis.
 *
 * It gives each observation with its weight, from the largest weight in absolute value. The default second hypothesis is
 * "no fault".
 */
export function explain(catalog: Catalog, evidence: readonly Evidence[], hypothesis: string, versus: string = NONE): Contribution[] {
  const { used } = usable(catalog, evidence);
  return used
    .map((item) => ({
      evidence: item,
      weight: Math.log10(catalog.likelihood(hypothesis, item.feature, item.value, item.primary)) -
        Math.log10(catalog.likelihood(versus, item.feature, item.value, item.primary)),
    }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

/**
 * This function gives the probability of each value of a feature that is not observed yet, from the probabilities of
 * the causes. The choice of the next probe uses it.
 */
export function predictive(catalog: Catalog, diagnosis: Diagnosis, feature: string, primary: boolean): Distribution {
  const known = catalog.features.get(feature);
  if (known === undefined) throw new RangeError(`The catalog has no feature ${feature}`);
  const dist: Record<string, number> = {};
  for (const value of known.values) {
    dist[value] = diagnosis.causes.reduce((sum, cause) => sum + cause.probability * catalog.likelihood(cause.id, feature, value, primary), 0);
  }
  return dist;
}
