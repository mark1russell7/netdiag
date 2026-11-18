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
  /**
   * This field tells that the feature is an observation of the local network: of this computer, its link or its gateway.
   * A fault with the reach `upstream` does not change it.
   */
  readonly local?: boolean | undefined;
}

/** The parts of the model. Each fault is in one part. */
export const PARTS = ["interface", "wifi", "gateway", "resolver", "path", "service"] as const;

/** A part of the model: the network interface, the Wi-Fi link, the gateway, the DNS resolver, the path or the remote service. */
export type Part = (typeof PARTS)[number];

/**
 * The reach of a fault.
 *
 * - `shared`: the fault changes the observations of each host, for example a TLS proxy of the local network.
 * - `upstream`: the fault changes the observations of each host past the gateway, for example a loss in the network of
 *   the provider. The local features, for example `gateway.loss`, stay healthy.
 * - `target`: the fault changes only the observations of the primary target, for example a slow server.
 */
export type Reach = "shared" | "upstream" | "target";

/** The reaches, in the order of the variants of a fault. */
export const REACHES: readonly Reach[] = ["shared", "upstream", "target"];

/** The probability of one reach of a cause. The probabilities of the reaches of a cause add up to the probability of the cause. */
export interface ReachShare {
  readonly reach: Reach;
  readonly probability: number;
}

/** The probability of one degree of a cause. The probabilities of the degrees of a cause add up to the probability of the cause. */
export interface DegreeShare {
  readonly degree: string;
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
 * With `expect`, the expected values share the probability of the strength equally. Each other value gets `FLOOR`. The
 * rest goes to the other values in proportion to their healthy probabilities. A fault that does not show its expected
 * value mostly leaves the feature healthy.
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
  /**
   * The weight of each reach in the prior of the fault. A reach with no weight gets 1, so by default the reaches share
   * the prior equally. For example, a loss in the local network, upstream and near the target can get 1, 1 and 2.
   */
  readonly reachShares?: Partial<Readonly<Record<Reach, number>>> | undefined;
  /** The cause in plain words, for example "No program listens on the port." */
  readonly summary: string;
  /** The next step for the user in plain words. */
  readonly step: string;
  readonly prior?: number | undefined;
  readonly predicts: Readonly<Record<string, Prediction>>;
  /**
   * The degrees of the fault. A degree is a severity or a mode that the facts do not tell directly. Examples are a small
   * or a large loss, and a silent or an absent resolver. A mode is the same on each subject of a visit, so a degree
   * with one expected value counts it once. With no degrees, the fault has one degree. The model sums the variants of each
   * degree and each reach.
   */
  readonly degrees?: readonly Degree[] | undefined;
}

/**
 * A degree of a fault: a severity with its own part of the prior and its own predictions.
 *
 * The predictions of a degree replace the predictions of the fault for the same features. Thus the observations of a
 * degree can come together. For example, a heavy loss makes each DNS try fail, so DNS times out at each host.
 */
export interface Degree {
  readonly id: string;
  /** The degree in plain words, for example "Most packets are lost." */
  readonly summary: string;
  /** The relative weight of the degree in the prior of the fault. */
  readonly share: number;
  /** The predictions that replace the predictions of the fault. With none, the degree keeps the predictions of the fault. */
  readonly predicts?: Readonly<Record<string, Prediction>> | undefined;
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
  /** The ids of the degrees of the fault, in the order of the catalog. Only a fault with degrees has them. */
  readonly degree?: readonly string[] | undefined;
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
   * With `reach`, it gives the probability under the variant of that reach. Without it, it gives the mean over the
   * reaches, with their shares.
   * With `degree`, it gives the probability under that degree. Without it, it gives the mean over the degrees, with their shares.
   */
  likelihood(hypothesis: string, feature: string, value: string, primary: boolean, reach?: Reach, degree?: string): number;
  /**
   * This function gives the prior of a hypothesis. With `degree`, it gives the part of the prior of that degree. With
   * `reach`, it gives the part of the prior of that reach.
   */
  prior(hypothesis: string, degree?: string, reach?: Reach): number;
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
  // A fault that does not show its expected value mostly leaves the feature healthy. Thus each other value gets the floor,
  // and the rest above the floors follows the healthy distribution. With no room above the floors, the rest is equal.
  const healthy = others.reduce((sum, value) => sum + (feature.healthy[value] ?? 0), 0);
  const free = 1 - mass - FLOOR * others.length;
  for (const value of others) {
    dist[value] = healthy > 0 && free > 0 ? FLOOR + (free * (feature.healthy[value] ?? 0)) / healthy : (1 - mass) / others.length;
  }
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
  const forms = new Map<string, readonly Form[]>();
  /** The share of each reach of each fault in the prior of the fault. The shares of a fault add up to 1. */
  const reachShares = new Map<string, ReadonlyMap<Reach, number>>();
  for (const fault of spec.faults) {
    if (!ID.test(fault.id) || fault.id === NONE || fault.id === UNKNOWN) problems.push(`"${fault.id}" is not a valid fault id.`);
    if (priors.has(fault.id)) problems.push(`The fault ${fault.id} is repeated.`);
    if (!LAYERS.includes(fault.layer)) problems.push(`The fault ${fault.id} has the unknown layer ${String(fault.layer)}.`);
    priors.set(fault.id, fault.prior ?? 1);
    const reaches: readonly Reach[] = typeof fault.reach === "string" ? [fault.reach] : fault.reach;
    if (reaches.length === 0 || new Set(reaches).size !== reaches.length || reaches.some((reach) => !REACHES.includes(reach))) {
      problems.push(`The fault ${fault.id} has the reach ${JSON.stringify(fault.reach)}. It must be one or more different values of ${REACHES.join(", ")}.`);
    }
    const reach = REACHES.filter((each) => reaches.includes(each));
    for (const [each, share] of Object.entries(fault.reachShares ?? {})) {
      if (!reach.includes(each as Reach)) problems.push(`The fault ${fault.id} has a share of the reach ${each}, but the fault does not have that reach.`);
      if (share !== undefined && (!Number.isFinite(share) || share <= 0)) problems.push(`The share of the reach ${each} of ${fault.id} is ${share}. It must be more than 0.`);
    }
    const weights = reach.map((each) => fault.reachShares?.[each] ?? 1);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    reachShares.set(fault.id, new Map(reach.map((each, index) => [each, (weights[index] ?? 0) / weightSum])));
    const degree = fault.degrees?.map((each) => each.id);
    hypotheses.push({
      id: fault.id,
      kind: "fault",
      summary: fault.summary,
      step: fault.step,
      part: fault.part,
      layer: fault.layer,
      reach,
      ...(degree !== undefined ? { degree } : {}),
    });
    const table = tableOf(fault.id, fault.predicts, features, problems);
    if (fault.degrees === undefined) {
      if (table.size === 0) problems.push(`The fault ${fault.id} predicts no feature.`);
      forms.set(fault.id, [{ id: undefined, share: 1, table }]);
      continue;
    }
    problems.push(...degreeProblems(fault));
    const total = fault.degrees.reduce((sum, each) => sum + each.share, 0);
    forms.set(
      fault.id,
      fault.degrees.map((each) => {
        const own = tableOf(`${fault.id} (${each.id})`, each.predicts ?? {}, features, problems);
        const merged = new Map([...table, ...own]);
        if (merged.size === 0) problems.push(`The fault ${fault.id} (${each.id}) predicts no feature.`);
        return { id: each.id, share: each.share / total, table: merged };
      }),
    );
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
  /** The form of a degree, or `undefined` when the hypothesis has no such degree. Without a degree, each form of the hypothesis. */
  const formsOf = (hypothesis: string, degree: string | undefined): readonly Form[] | undefined => {
    const all = forms.get(hypothesis) ?? [];
    if (degree === undefined) return all;
    const found = all.find((form) => form.id === degree);
    return found === undefined ? undefined : [{ ...found, share: 1 }];
  };
  return ok({
    version: spec.version,
    features,
    hypotheses,
    prior(hypothesis, degree, reach) {
      const whole = ((priors.get(hypothesis) ?? 0) / total) * (reach === undefined ? 1 : (reachShares.get(hypothesis)?.get(reach) ?? 0));
      if (degree === undefined) return whole;
      return whole * (forms.get(hypothesis)?.find((form) => form.id === degree)?.share ?? 0);
    },
    likelihood(hypothesis, featureId, value, primary, reach, degree) {
      const feature = features.get(featureId);
      if (feature === undefined || !feature.values.includes(value)) return Number.NaN;
      if (hypothesis === UNKNOWN) return 1 / feature.values.length;
      const reaches = reachOf.get(hypothesis) ?? [];
      if (reach !== undefined && !reaches.includes(reach)) return Number.NaN;
      const chosen = formsOf(hypothesis, degree);
      if (chosen === undefined) return Number.NaN;
      if (reaches.length === 0) return degree === undefined ? (feature.healthy[value] ?? Number.NaN) : Number.NaN;
      const of = (each: Reach, form: Form): number => {
        const changed = form.table.get(featureId);
        const changes = each === "upstream" && feature.local === true ? false : primary || each !== "target";
        return (changes && changed !== undefined ? changed : feature.healthy)[value] ?? Number.NaN;
      };
      const shares = reachShares.get(hypothesis);
      const overReaches = (form: Form): number => (reach !== undefined ? of(reach, form) : reaches.reduce((sum, each) => sum + (shares?.get(each) ?? 0) * of(each, form), 0));
      return chosen.reduce((sum, form) => sum + form.share * overReaches(form), 0);
    },
  });
}

/** One degree of a fault, compiled: its id, its part of the prior of the fault, and the distributions that it changes. */
interface Form {
  readonly id: string | undefined;
  readonly share: number;
  readonly table: ReadonlyMap<string, Distribution>;
}

/** This function expands the predictions of a fault or of a degree, and adds their problems to `problems`. */
function tableOf(where: string, predicts: Readonly<Record<string, Prediction>>, features: ReadonlyMap<string, Feature>, problems: string[]): Map<string, Distribution> {
  const table = new Map<string, Distribution>();
  for (const [featureId, prediction] of Object.entries(predicts)) {
    const feature = features.get(featureId);
    if (feature === undefined) {
      problems.push(`The fault ${where} predicts the unknown feature ${featureId}.`);
      continue;
    }
    const dist = expand(feature, prediction);
    if (dist.tag === "err") problems.push(...dist.error.map((problem) => `${where}: ${problem}`));
    else {
      problems.push(...distributionProblems(`${where} for ${featureId}`, feature, dist.value));
      table.set(featureId, dist.value);
    }
  }
  return table;
}

/** This function gives the problems of the degrees of a fault. A problem is no degree, a repeated or invalid id, or a share of 0 or less. */
function degreeProblems(fault: Fault): string[] {
  const degrees = fault.degrees ?? [];
  const problems: string[] = [];
  if (degrees.length === 0) problems.push(`The fault ${fault.id} has an empty list of degrees. Give one or more degrees, or no list.`);
  const seen = new Set<string>();
  for (const degree of degrees) {
    if (!ID.test(degree.id)) problems.push(`"${degree.id}" is not a valid degree id of the fault ${fault.id}.`);
    if (seen.has(degree.id)) problems.push(`The degree ${degree.id} of the fault ${fault.id} is repeated.`);
    seen.add(degree.id);
    if (!Number.isFinite(degree.share) || degree.share <= 0) problems.push(`The share of the degree ${degree.id} of the fault ${fault.id} is ${degree.share}. It must be more than 0.`);
  }
  return problems;
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

/**
 * A cause with its probability. A fault also gives the probability of each of its reaches and of each variant. A fault
 * with degrees also gives the probability of each degree.
 */
export interface Cause extends Hypothesis {
  readonly probability: number;
  readonly reaches?: readonly ReachShare[] | undefined;
  readonly degrees?: readonly DegreeShare[] | undefined;
  /**
   * The probability of each variant: each reach with each degree. Only a fault with degrees has them. The probabilities
   * add up to the probability of the cause.
   */
  readonly variants?: readonly CauseVariant[] | undefined;
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
function logLikelihood(catalog: Catalog, used: readonly Evidence[], hypothesis: string, reach?: Reach, degree?: string): number {
  let sum = 0;
  for (const item of used) sum += Math.log(catalog.likelihood(hypothesis, item.feature, item.value, item.primary, reach, degree));
  return sum;
}

/** One variant of a hypothesis: its reach and its degree, and the logarithm of its prior and of the likelihood of the evidence. */
interface VariantLog {
  readonly reach: Reach | undefined;
  readonly degree: string | undefined;
  readonly log: number;
}

/**
 * This function gives the variants of a hypothesis: one for each reach and each degree of a fault, or the hypothesis
 * itself. The reaches and the degrees of a fault share its prior by their shares.
 */
function variantLogs(catalog: Catalog, used: readonly Evidence[], hypothesis: Hypothesis): VariantLog[] {
  const reaches = hypothesis.reach ?? [];
  if (reaches.length === 0) return [{ reach: undefined, degree: undefined, log: Math.log(catalog.prior(hypothesis.id)) + logLikelihood(catalog, used, hypothesis.id) }];
  const degrees = hypothesis.degree ?? [undefined];
  return degrees.flatMap((degree) =>
    reaches.map((reach) => ({ reach, degree, log: Math.log(catalog.prior(hypothesis.id, degree, reach)) + logLikelihood(catalog, used, hypothesis.id, reach, degree) })),
  );
}

/** This function adds the probabilities of the variants with the same key, in the order of the first variant of each key. */
function sumsBy<K>(variants: readonly CauseVariant[], key: (variant: CauseVariant) => K | undefined): { key: K; probability: number }[] {
  const sums = new Map<K, number>();
  for (const variant of variants) {
    const k = key(variant);
    if (k !== undefined) sums.set(k, (sums.get(k) ?? 0) + variant.probability);
  }
  return [...sums].map(([k, probability]) => ({ key: k, probability }));
}

/**
 * This function gives the probability of each hypothesis from the evidence, with the rule of Bayes.
 *
 * The model takes the observations as independent for a given variant of a hypothesis. A fault has one variant for each
 * of its reaches and each of its degrees. The variants share the prior of the fault. The probability of the fault is
 * the sum of its variants.
 *
 * The calculation uses logarithms, so a long list of evidence does not go to zero. The order of the evidence does not
 * change the result. An exact tie keeps the order of the catalog, with "no fault" first.
 */
export function diagnose(catalog: Catalog, evidence: readonly Evidence[]): Diagnosis {
  const { used, ignored } = usable(catalog, evidence);
  const variants = catalog.hypotheses.map((h) => variantLogs(catalog, used, h));
  const top = Math.max(...variants.flat().map((variant) => variant.log));
  const weights = variants.map((each) => each.map((variant) => ({ reach: variant.reach, degree: variant.degree, weight: Math.exp(variant.log - top) })));
  const total = weights.flat().reduce((sum, variant) => sum + variant.weight, 0);
  // An exact tie keeps the order of the catalog: "no fault" first, then the faults, then "unknown cause". Thus a fault
  // whose features are not observed does not come before "no fault".
  const causes = catalog.hypotheses
    .map((h, i) => {
      const parts = weights[i] ?? [];
      const probability = parts.reduce((sum, variant) => sum + variant.weight, 0) / total;
      if (h.reach === undefined || h.reach.length === 0) return { ...h, probability, order: i };
      const shares: CauseVariant[] = parts.map((variant) => ({ reach: variant.reach, ...(variant.degree !== undefined ? { degree: variant.degree } : {}), probability: variant.weight / total }));
      const reaches = sumsBy(shares, (variant) => variant.reach).map(({ key, probability: p }) => ({ reach: key, probability: p }));
      const degrees = sumsBy(shares, (variant) => variant.degree).map(({ key, probability: p }) => ({ degree: key, probability: p }));
      return { ...h, probability, reaches, ...(degrees.length > 0 ? { degrees, variants: shares } : {}), order: i };
    })
    .sort((a, b) => b.probability - a.probability || a.order - b.order)
    .map(({ order: _order, ...cause }) => cause);
  return { causes, used, ignored };
}

/** One variant of a cause: the reach and the degree of a fault, or no reach for the cause itself, with its probability. */
export interface CauseVariant {
  readonly reach: Reach | undefined;
  /** The degree of the variant. Only a fault with degrees has it. */
  readonly degree?: string | undefined;
  readonly probability: number;
}

/**
 * This function gives the variants of a cause: one for each reach and each degree of a fault, or the cause itself. The
 * choice of the next probe and `predictive` use them.
 */
export function causeVariants(cause: Cause): readonly CauseVariant[] {
  if (cause.variants !== undefined && cause.variants.length > 0) return cause.variants;
  return cause.reaches !== undefined && cause.reaches.length > 0 ? cause.reaches : [{ reach: undefined, probability: cause.probability }];
}

/**
 * The default bound of `alikeCauses`, as a difference of natural logarithms. Two variants with the same predictions of
 * the catalog give the same numbers, so their distance is 0. The bound is only for the errors of floating point.
 */
export const ALIKE_EPSILON = 1e-6;

/**
 * The factor of the empty band around the bound of `alikeCauses`. Each alike cause is `epsilon / ALIKE_MARGIN` or less
 * from the cause, and each other cause is `epsilon * ALIKE_MARGIN` or more. A lab fails when a cause is in this band, so
 * a change of the catalog cannot change an alike set silently.
 */
export const ALIKE_MARGIN = 100;

/** This function gives the variant of a cause with the highest probability. A tie keeps the first variant. */
function likeliestOf(cause: Cause): CauseVariant {
  let best: CauseVariant = { reach: undefined, probability: cause.probability };
  let found = false;
  for (const variant of causeVariants(cause)) {
    if (!found || variant.probability > best.probability) best = variant;
    found = true;
  }
  return best;
}

/** This function gives each feature and subject of the evidence that the diagnosis used, one time each. */
function readFeatures(diagnosis: Diagnosis): readonly Pick<Evidence, "feature" | "primary">[] {
  return [...new Map(diagnosis.used.map((item) => [`${item.feature}@${String(item.primary)}`, { feature: item.feature, primary: item.primary }])).values()];
}

/**
 * This function gives the distance of two causes for the probes that a diagnosis read. The likeliest variant of each
 * cause gives a probability to each value of each read feature. The distance is the largest difference of the natural
 * logarithms of these probabilities.
 *
 * - The distance is 0 when the read probes cannot tell the causes apart: each fact has the same probability under both.
 * - Each value of each read feature counts, also a value that the evidence does not have. So a tie of the two
 *   likelihoods of the evidence alone does not make the distance small.
 * - A cause that is not in the diagnosis, or that has the probability 0, has the distance `Infinity`.
 */
export function alikeDistance(catalog: Catalog, diagnosis: Diagnosis, first: string, second: string): number {
  const a = diagnosis.causes.find((each) => each.id === first);
  const b = diagnosis.causes.find((each) => each.id === second);
  if (a === undefined || b === undefined || !(a.probability > 0) || !(b.probability > 0)) return Number.POSITIVE_INFINITY;
  return variantDistance(catalog, readFeatures(diagnosis), a, b);
}

function variantDistance(catalog: Catalog, reads: readonly Pick<Evidence, "feature" | "primary">[], a: Cause, b: Cause): number {
  const va = likeliestOf(a);
  const vb = likeliestOf(b);
  let worst = 0;
  for (const { feature, primary } of reads) {
    for (const value of catalog.features.get(feature)?.values ?? []) {
      const pa = catalog.likelihood(a.id, feature, value, primary, va.reach, va.degree);
      const pb = catalog.likelihood(b.id, feature, value, primary, vb.reach, vb.degree);
      worst = Math.max(worst, Math.abs(Math.log(pa) - Math.log(pb)));
    }
  }
  return worst;
}

/** The distances around one cause of a diagnosis (refer to `alikeMargin`). */
export interface AlikeMargin {
  /** The largest distance of an alike cause. It is 0 when the cause has no alike cause. */
  readonly inner: number;
  /** The smallest distance of a cause that is not alike. It is absent when no such cause has a probability above 0. */
  readonly outer?: number | undefined;
  /** The cause at the distance `outer`. */
  readonly nearest?: string | undefined;
}

/**
 * This function gives the distances around `cause` (refer to `alikeDistance`): the largest distance of an alike cause,
 * and the smallest distance of the other causes. It gives `undefined` for a cause that is not in the diagnosis, or that
 * has the probability 0. A bound below 0 is a `RangeError`.
 */
export function alikeMargin(catalog: Catalog, diagnosis: Diagnosis, cause: string, epsilon: number = ALIKE_EPSILON): AlikeMargin | undefined {
  if (!(epsilon >= 0)) throw new RangeError(`The bound of the alike causes is ${epsilon}. It must be 0 or more.`);
  const self = diagnosis.causes.find((each) => each.id === cause);
  if (self === undefined || !(self.probability > 0)) return undefined;
  const reads = readFeatures(diagnosis);
  let inner = 0;
  let outer = Number.POSITIVE_INFINITY;
  let nearest: string | undefined;
  for (const each of diagnosis.causes) {
    if (each.id === cause || !(each.probability > 0)) continue;
    const distance = variantDistance(catalog, reads, self, each);
    if (distance <= epsilon) inner = Math.max(inner, distance);
    else if (distance < outer) {
      outer = distance;
      nearest = each.id;
    }
  }
  return nearest === undefined ? { inner } : { inner, outer, nearest };
}

/**
 * This function gives the causes of a diagnosis that the read probes cannot tell from `cause`, from the most probable.
 * Each has a distance of `epsilon` or less from `cause` (refer to `alikeDistance`).
 *
 * - Only the priors of these causes put them in an order. A next probe that splits them reads a different feature.
 * - The relation is symmetric. A cause that is not in the diagnosis, or that has the probability 0, has no alike cause.
 * - A bound below 0 is a `RangeError`.
 */
export function alikeCauses(catalog: Catalog, diagnosis: Diagnosis, cause: string, epsilon: number = ALIKE_EPSILON): readonly string[] {
  if (!(epsilon >= 0)) throw new RangeError(`The bound of the alike causes is ${epsilon}. It must be 0 or more.`);
  const self = diagnosis.causes.find((each) => each.id === cause);
  if (self === undefined || !(self.probability > 0)) return [];
  const reads = readFeatures(diagnosis);
  return diagnosis.causes.filter((each) => each.id !== cause && each.probability > 0 && variantDistance(catalog, reads, self, each) <= epsilon).map((each) => each.id);
}

/** The part of one observation in the comparison of two hypotheses. */
export interface Contribution {
  readonly evidence: Evidence;
  /** The ratio of the likelihoods of the two hypotheses, as a base-10 logarithm. 1 is a factor of 10 for the first hypothesis. */
  readonly weight: number;
}

/**
 * This function gives the most probable variant of a hypothesis for the evidence. A tie keeps the order of the degrees
 * of the catalog, then the order of `REACHES`.
 */
function likeliestVariant(catalog: Catalog, used: readonly Evidence[], hypothesis: string): VariantLog | undefined {
  const found = catalog.hypotheses.find((h) => h.id === hypothesis);
  if (found === undefined) return undefined;
  let best: VariantLog | undefined;
  for (const variant of variantLogs(catalog, used, found)) if (best === undefined || variant.log > best.log) best = variant;
  return best;
}

/**
 * This function tells why the model prefers one hypothesis to a second hypothesis.
 *
 * It gives each observation with its weight, from the largest weight in absolute value. The default second hypothesis is
 * "no fault". For a fault with more than one variant, the weights use the most probable reach and degree for the evidence.
 */
export function explain(catalog: Catalog, evidence: readonly Evidence[], hypothesis: string, versus: string = NONE): Contribution[] {
  const { used } = usable(catalog, evidence);
  const first = likeliestVariant(catalog, used, hypothesis);
  const second = likeliestVariant(catalog, used, versus);
  return used
    .map((item) => ({
      evidence: item,
      weight: Math.log10(catalog.likelihood(hypothesis, item.feature, item.value, item.primary, first?.reach, first?.degree)) -
        Math.log10(catalog.likelihood(versus, item.feature, item.value, item.primary, second?.reach, second?.degree)),
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
      (sum, cause) =>
        sum + causeVariants(cause).reduce((part, variant) => part + variant.probability * catalog.likelihood(cause.id, feature, value, primary, variant.reach, variant.degree), 0),
      0,
    );
  }
  return dist;
}
