import { err, ok, type Result } from "@mark1russell7/optional";
import { LAYERS, type Layer } from "../layer.ts";

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

/** The reaches, in the order of the variants of a fault. */
export const REACHES: readonly Reach[] = ["shared", "target"];

/** The probability of one reach of a cause. The probabilities of the reaches of a cause add up to the probability of the cause. */
export interface ReachShare {
  readonly reach: Reach;
  readonly probability: number;
}

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
  /** The layer where the fault starts. The coverage of the lab and the views of a report read it. */
  readonly layer: Layer;
  /**
   * The reach of the fault. A list tells that the fault can be at a place of each reach. For example, a loss near the
   * client is shared, and a loss near the target is not. The model then sums the variants of each reach.
   */
  readonly reach: Reach | readonly Reach[];
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
  /** The layer where the fault starts. Only a hypothesis of the kind `fault` has a layer. */
  readonly layer?: Layer | undefined;
  /** The reaches of the fault, in the order of `REACHES`. Only a hypothesis of the kind `fault` has reaches. */
  readonly reach?: readonly Reach[] | undefined;
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
  /**
   * This function gives the probability of a value of a feature under a hypothesis, for a primary or a reference host.
   * With `reach`, it gives the probability under the variant of that reach. Without it, it gives the mean over the reaches.
   */
  likelihood(hypothesis: string, feature: string, value: string, primary: boolean, reach?: Reach): number;
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
 * It refuses a repeated id, an unknown layer, feature or value, a probability below `FLOOR`, and a distribution with a sum that is not 1.
 */
export function compileCatalog(spec: CatalogSpec): Result<Catalog, string[]> {
  const problems: string[] = [];
  const features = new Map<string, Feature>();
  for (const feature of spec.features) {
    if (!ID.test(feature.id)) problems.push(`"${feature.id}" is not a valid feature id.`);
    if (features.has(feature.id)) problems.push(`The feature ${feature.id} is repeated.`);
    if (!LAYERS.includes(feature.layer)) problems.push(`The feature ${feature.id} has the unknown layer ${String(feature.layer)}.`);
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
    if (!LAYERS.includes(fault.layer)) problems.push(`The fault ${fault.id} has the unknown layer ${String(fault.layer)}.`);
    priors.set(fault.id, fault.prior ?? 1);
    const reaches: readonly Reach[] = typeof fault.reach === "string" ? [fault.reach] : fault.reach;
    if (reaches.length === 0 || new Set(reaches).size !== reaches.length || reaches.some((reach) => !REACHES.includes(reach))) {
      problems.push(`The fault ${fault.id} has the reach ${JSON.stringify(fault.reach)}. It must be one or more different values of ${REACHES.join(" and ")}.`);
    }
    const reach = REACHES.filter((each) => reaches.includes(each));
    hypotheses.push({ id: fault.id, kind: "fault", summary: fault.summary, step: fault.step, part: fault.part, layer: fault.layer, reach });
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
  const reachOf = new Map(hypotheses.map((h) => [h.id, h.reach ?? []]));
  return ok({
    version: spec.version,
    features,
    hypotheses,
    prior: (hypothesis) => (priors.get(hypothesis) ?? 0) / total,
    likelihood(hypothesis, featureId, value, primary, reach) {
      const feature = features.get(featureId);
      if (feature === undefined || !feature.values.includes(value)) return Number.NaN;
      if (hypothesis === UNKNOWN) return 1 / feature.values.length;
      const changed = tables.get(hypothesis)?.get(featureId);
      const reaches = reachOf.get(hypothesis) ?? [];
      if (reach !== undefined && !reaches.includes(reach)) return Number.NaN;
      const of = (each: Reach): number => ((primary || each === "shared") && changed !== undefined ? changed : feature.healthy)[value] ?? Number.NaN;
      if (reach !== undefined) return of(reach);
      if (reaches.length === 0) return feature.healthy[value] ?? Number.NaN;
      return reaches.reduce((sum, each) => sum + of(each), 0) / reaches.length;
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

/** A cause with its probability. A fault also gives the probability of each of its reaches. */
export interface Cause extends Hypothesis {
  readonly probability: number;
  readonly reaches?: readonly ReachShare[] | undefined;
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

/** This function gives the logarithm of the likelihood of the evidence under one variant of a hypothesis. */
function logLikelihood(catalog: Catalog, used: readonly Evidence[], hypothesis: string, reach?: Reach): number {
  let sum = 0;
  for (const item of used) sum += Math.log(catalog.likelihood(hypothesis, item.feature, item.value, item.primary, reach));
  return sum;
}

/** One variant of a hypothesis: its reach, and the logarithm of its prior and of the likelihood of the evidence. */
interface VariantLog {
  readonly reach: Reach | undefined;
  readonly log: number;
}

/** This function gives the variants of a hypothesis: one for each reach of a fault, or the hypothesis itself. */
function variantLogs(catalog: Catalog, used: readonly Evidence[], hypothesis: Hypothesis): VariantLog[] {
  const prior = Math.log(catalog.prior(hypothesis.id));
  const reaches = hypothesis.reach ?? [];
  if (reaches.length === 0) return [{ reach: undefined, log: prior + logLikelihood(catalog, used, hypothesis.id) }];
  const share = Math.log(reaches.length);
  return reaches.map((reach) => ({ reach, log: prior - share + logLikelihood(catalog, used, hypothesis.id, reach) }));
}

/**
 * This function gives the probability of each hypothesis from the evidence, with the rule of Bayes.
 *
 * The model takes the observations as independent for a given variant of a hypothesis. A fault has one variant for each
 * of its reaches, and each variant gets an equal part of the prior. The probability of the fault is the sum of its
 * variants. The calculation uses logarithms, so a long list of evidence does not go to zero. The order of the evidence
 * does not change the result. An exact tie keeps the order of the catalog, with "no fault" first.
 */
export function diagnose(catalog: Catalog, evidence: readonly Evidence[]): Diagnosis {
  const { used, ignored } = usable(catalog, evidence);
  const variants = catalog.hypotheses.map((h) => variantLogs(catalog, used, h));
  const top = Math.max(...variants.flat().map((variant) => variant.log));
  const weights = variants.map((each) => each.map((variant) => ({ reach: variant.reach, weight: Math.exp(variant.log - top) })));
  const total = weights.flat().reduce((sum, variant) => sum + variant.weight, 0);
  // An exact tie keeps the order of the catalog: "no fault" first, then the faults, then "unknown cause". Thus a fault
  // whose features are not observed does not come before "no fault".
  const causes = catalog.hypotheses
    .map((h, i) => {
      const parts = weights[i] ?? [];
      const probability = parts.reduce((sum, variant) => sum + variant.weight, 0) / total;
      const reaches = parts.flatMap((variant) => (variant.reach === undefined ? [] : [{ reach: variant.reach, probability: variant.weight / total }]));
      return { ...h, probability, ...(reaches.length > 0 ? { reaches } : {}), order: i };
    })
    .sort((a, b) => b.probability - a.probability || a.order - b.order)
    .map(({ order: _order, ...cause }) => cause);
  return { causes, used, ignored };
}

/** One variant of a cause: the reach of a fault, or no reach for the cause itself, with its probability. */
export interface CauseVariant {
  readonly reach: Reach | undefined;
  readonly probability: number;
}

/**
 * This function gives the variants of a cause: one for each reach of a fault, or the cause itself. The choice of the
 * next probe and `predictive` use them.
 */
export function causeVariants(cause: Cause): readonly CauseVariant[] {
  return cause.reaches !== undefined && cause.reaches.length > 0 ? cause.reaches : [{ reach: undefined, probability: cause.probability }];
}

/** The part of one observation in the comparison of two hypotheses. */
export interface Contribution {
  readonly evidence: Evidence;
  /** The ratio of the likelihoods of the two hypotheses, as a base-10 logarithm. 1 is a factor of 10 for the first hypothesis. */
  readonly weight: number;
}

/** This function gives the reach of the most probable variant of a hypothesis for the evidence. A tie keeps the order of `REACHES`. */
function likeliestReach(catalog: Catalog, used: readonly Evidence[], hypothesis: string): Reach | undefined {
  const found = catalog.hypotheses.find((h) => h.id === hypothesis);
  if (found === undefined) return undefined;
  let best: VariantLog | undefined;
  for (const variant of variantLogs(catalog, used, found)) if (best === undefined || variant.log > best.log) best = variant;
  return best?.reach;
}

/**
 * This function tells why the model prefers one hypothesis to a second hypothesis.
 *
 * It gives each observation with its weight, from the largest weight in absolute value. The default second hypothesis is
 * "no fault". For a fault with more than one reach, the weights use the most probable reach for the evidence.
 */
export function explain(catalog: Catalog, evidence: readonly Evidence[], hypothesis: string, versus: string = NONE): Contribution[] {
  const { used } = usable(catalog, evidence);
  const first = likeliestReach(catalog, used, hypothesis);
  const second = likeliestReach(catalog, used, versus);
  return used
    .map((item) => ({
      evidence: item,
      weight: Math.log10(catalog.likelihood(hypothesis, item.feature, item.value, item.primary, first)) -
        Math.log10(catalog.likelihood(versus, item.feature, item.value, item.primary, second)),
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
    dist[value] = diagnosis.causes.reduce(
      (sum, cause) => sum + causeVariants(cause).reduce((part, variant) => part + variant.probability * catalog.likelihood(cause.id, feature, value, primary, variant.reach), 0),
      0,
    );
  }
  return dist;
}
