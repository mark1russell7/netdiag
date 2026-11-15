import { informationGain } from "@mark1russell7/rigor-statistics";
import type { Catalog, Cause, Diagnosis } from "./model.ts";

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
  /** The features of the candidate that the diagnosis did not observe. The gain counts only these features. */
  readonly counted: readonly Observable[];
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

const keyOf = (item: Observable): string => `${item.feature}\u0000${item.primary ? 1 : 0}`;

/** This function gives the groups of causes: each of the top causes alone, then one group of the other causes. */
function groupsOf(causes: readonly Cause[], top: number | undefined): readonly (readonly Cause[])[] {
  const size = top ?? causes.length;
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`The option top is ${size}. It must be a whole number of 1 or more.`);
  if (size >= causes.length - 1) return causes.map((cause) => [cause]);
  return [...causes.slice(0, size).map((cause) => [cause]), causes.slice(size)];
}

/**
 * This function gives the likelihood table of the features of a candidate. The table has one row for each group of
 * causes, and one column for each joint value of the features. The model takes the features as independent for a cause.
 * Thus the probability of a joint value is the product of the probabilities of its values.
 *
 * - The first feature is the most significant digit of the index of a column, and the last feature is the least
 *   significant digit.
 * - A walk over the features computes each product of a prefix one time for each cause. A value with the probability
 *   0 stops its branch, because each joint value under it has the probability 0.
 */
function tableOf(catalog: Catalog, groups: readonly (readonly Cause[])[], counted: readonly Observable[]): number[][] {
  const columns = counted.map((item) => {
    const feature = catalog.features.get(item.feature);
    if (feature === undefined) throw new RangeError(`The catalog has no feature ${item.feature}.`);
    return { ...item, values: feature.values };
  });
  const joint = columns.reduce((count, column) => count * column.values.length, 1);
  if (joint > MAX_JOINT_VALUES) throw new RangeError(`The features of a candidate have ${joint} joint values. The limit is ${MAX_JOINT_VALUES}.`);
  return groups.map((group) => {
    const mass = group.reduce((sum, cause) => sum + cause.probability, 0);
    const row = new Array<number>(joint).fill(0);
    for (const cause of group) {
      // A group with a probability of 0 adds nothing to the gain. Its row is the mean of the rows of its causes.
      const weight = mass > 0 ? cause.probability / mass : 1 / group.length;
      // The probabilities of each value of each feature for the cause.
      const rows = columns.map((column) => column.values.map((value) => catalog.likelihood(cause.id, column.feature, value, column.primary)));
      const walk = (depth: number, index: number, p: number): void => {
        const probabilities = rows[depth];
        if (probabilities === undefined) {
          row[index] = (row[index] ?? 0) + p;
          return;
        }
        probabilities.forEach((q, value) => {
          if (q > 0) walk(depth + 1, index * probabilities.length + value, p * q);
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
 * - A feature that the evidence of the diagnosis has, with the same role, adds nothing. A second observation of a
 *   feature is not independent of the first observation.
 * - With the option `top`, the gain tells apart only the most probable causes.
 * - When two gains are equal, the lower cost comes first, then the order of the candidates.
 */
export function rankProbes(catalog: Catalog, diagnosis: Diagnosis, candidates: readonly Candidate[], options: RankOptions = {}): ProbeChoice[] {
  const groups = groupsOf(diagnosis.causes, options.top);
  const prior = groups.map((group) => group.reduce((sum, cause) => sum + cause.probability, 0));
  const seen = new Set(diagnosis.used.map(keyOf));
  const choices = candidates.map((candidate, order) => {
    const keys = new Set<string>();
    const counted = candidate.observes.filter((item) => {
      const key = keyOf(item);
      if (seen.has(key) || keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    const gain = counted.length === 0 ? 0 : informationGain(prior, tableOf(catalog, groups, counted));
    return { choice: { candidate, gain, counted }, order };
  });
  const level = (gain: number): number => Math.round(gain / GAIN_RESOLUTION);
  return choices
    .sort((a, b) => level(b.choice.gain) - level(a.choice.gain) || (a.choice.candidate.cost ?? 0) - (b.choice.candidate.cost ?? 0) || a.order - b.order)
    .map(({ choice }) => choice);
}
