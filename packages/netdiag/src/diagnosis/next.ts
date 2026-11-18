import { informationGain } from "@mark1russell7/rigor-statistics";
import { causeVariants, repeatedLikelihood, repeatKey, tallies, type Catalog, type Cause, type Diagnosis, type Tally } from "./model.ts";

/** One feature that a probe observes, of the primary target or of a reference host. */
export interface Observable {
  readonly feature: string;
  readonly primary: boolean;
}

/** A probe that the diagnosis can start next, with the features that its facts give. */
export interface Candidate {
  /** The id of the candidate, for example the id of the probe and its target. */
  readonly id: string;
  /** The features that the facts of the probe give. */
  readonly observes: readonly Observable[];
  /** The cost of the probe, for example its time in seconds. When two gains are equal, the lower cost comes first. The default is 0. */
  readonly cost?: number | undefined;
}

/** A candidate with its expected information gain. */
export interface ProbeChoice {
  readonly candidate: Candidate;
  /** The expected information gain over the causes, in bits. */
  readonly gain: number;
}

/** The options of `rankProbes`. */
export interface RankOptions {
  /**
   * The number of the most probable causes that the gain tells apart. The other causes count as one group. The default
   * is all of the causes.
   */
  readonly top?: number | undefined;
}

/**
 * The largest number of joint values of the features of one candidate.
 *
 * - The likelihood table of a candidate has one row of this length for each group of causes. With 22 groups, the
 *   table has 1.4 million numbers, or 11.5 MB.
 * - The largest probe of a visit is one HTTPS request. Its 7 features have 5400 joint values in `STANDARD_CATALOG`.
 */
export const MAX_JOINT_VALUES = 65536;

/** Two gains that differ by less than this number of bits are equal in the order of `rankProbes`. */
export const GAIN_RESOLUTION = 1e-9;

/** This function gives the groups of causes: each of the top causes alone, then one group of the other causes. */
function groupsOf(causes: readonly Cause[], top: number | undefined): readonly (readonly Cause[])[] {
  const size = top ?? causes.length;
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`The option top is ${size}. It must be a whole number of 1 or more.`);
  if (size >= causes.length - 1) return causes.map((cause) => [cause]);
  return [...causes.slice(0, size).map((cause) => [cause]), causes.slice(size)];
}

/**
 * This function gives the likelihood table of the features of a candidate. The table has one row for each group of
 * causes, and one column for each joint value of the features. The model is the model of `diagnose`.
 *
 * - For a cause, the probability of a joint value is the product of the probabilities of its values. A feature with a
 *   concentration depends on the earlier observations of its feature and role: in the evidence, and earlier in the joint value.
 * - The first feature is the most significant digit of the index of a column, and the last feature is the least
 *   significant digit.
 * - A walk over the features computes each product of a prefix one time for each cause. A value with the probability
 *   0 stops its branch, because each joint value under it has the probability 0.
 */
function tableOf(catalog: Catalog, groups: readonly (readonly Cause[])[], observes: readonly Observable[], earlier: ReadonlyMap<string, Tally>): number[][] {
  const columns = observes.map((item, index) => {
    const feature = catalog.features.get(item.feature);
    if (feature === undefined) throw new RangeError(`The catalog has no feature ${item.feature}.`);
    const key = repeatKey(item);
    // The earlier columns of the same feature and role. Their values change the probabilities of this column.
    const before = observes.slice(0, index).flatMap((other, at) => (repeatKey(other) === key ? [at] : []));
    return { ...item, known: feature, values: feature.values, tally: earlier.get(key), before };
  });
  const joint = columns.reduce((count, column) => count * column.values.length, 1);
  if (joint > MAX_JOINT_VALUES) throw new RangeError(`The features of a candidate have ${joint} joint values. The limit is ${MAX_JOINT_VALUES}.`);
  return groups.map((group) => {
    const mass = group.reduce((sum, cause) => sum + cause.probability, 0);
    const row = new Array<number>(joint).fill(0);
    for (const cause of group) for (const variant of causeVariants(cause)) {
      // A group with a probability of 0 adds nothing to the gain. Its row is the mean of the rows of its variants.
      const weight = mass > 0 ? variant.probability / mass : 1 / (group.length * causeVariants(cause).length);
      // The likelihood of each value of each feature for the variant of the cause, before the repeats.
      const rows = columns.map((column) => column.values.map((value) => catalog.likelihood(cause.id, column.feature, value, column.primary, variant.reach, variant.degree)));
      // The index of the value of each column on the path of the walk.
      const chosen: number[] = [];
      const walk = (depth: number, index: number, p: number): void => {
        const column = columns[depth];
        const bases = rows[depth];
        if (column === undefined || bases === undefined) {
          row[index] = (row[index] ?? 0) + p;
          return;
        }
        bases.forEach((base, value) => {
          const name = column.values[value] ?? "";
          const same = (column.tally?.values.get(name) ?? 0) + column.before.filter((at) => chosen[at] === value).length;
          const q = repeatedLikelihood(column.known, base, same, (column.tally?.total ?? 0) + column.before.length);
          if (q <= 0) return;
          chosen[depth] = value;
          walk(depth + 1, index * bases.length + value, p * q);
        });
      };
      if (weight > 0) walk(0, 0, weight);
    }
    return row;
  });
}

/**
 * This function gives the candidates from the largest expected information gain over the causes of a diagnosis. The
 * first candidate is the next probe.
 *
 * - The gain is the mutual information of the causes and the features of the candidate, in bits.
 * - The model of the gain is the model of `diagnose`. A repeat of a feature with a concentration depends on the earlier
 *   observations of its feature and role. Thus a repeat that is nearly a copy adds nearly nothing.
 * - A candidate that names a feature and role two times observes it two times.
 * - With the option `top`, the gain tells apart only the most probable causes.
 * - When two gains are equal, the lower cost comes first, then the order of the candidates.
 */
export function rankProbes(catalog: Catalog, diagnosis: Diagnosis, candidates: readonly Candidate[], options: RankOptions = {}): ProbeChoice[] {
  const groups = groupsOf(diagnosis.causes, options.top);
  const prior = groups.map((group) => group.reduce((sum, cause) => sum + cause.probability, 0));
  const earlier = tallies(diagnosis.used);
  const choices = candidates.map((candidate, order) => {
    const gain = candidate.observes.length === 0 ? 0 : informationGain(prior, tableOf(catalog, groups, candidate.observes, earlier));
    return { choice: { candidate, gain }, order };
  });
  const level = (gain: number): number => Math.round(gain / GAIN_RESOLUTION);
  return choices
    .sort((a, b) => level(b.choice.gain) - level(a.choice.gain) || (a.choice.candidate.cost ?? 0) - (b.choice.candidate.cost ?? 0) || a.order - b.order)
    .map(({ choice }) => choice);
}
