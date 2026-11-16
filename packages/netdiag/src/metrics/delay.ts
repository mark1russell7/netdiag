import { mean, median, quantile, sd } from "@mark1russell7/rigor-statistics";

// The estimators of the delay (ND-6). Each one reads a list of delays in the order of the packets, in milliseconds. A
// round-trip time is also a delay: the offset of the two clocks has no effect on a change of the delay.

/** The gain of the jitter estimator of RFC 3550. Each new change of the transit time moves the estimate by 1/16 of the difference. */
export const JITTER_GAIN: number = 1 / 16;

/** The quantile of the PDV that `delayMetrics` gives. RFC 5481 tells a high quantile, for example 0.999 for a long stream. */
export const PDV_QUANTILE = 0.99;

/**
 * This function gives the interarrival jitter of RFC 3550 (section 6.4.1): `J += (abs(D) - J) / 16`. `D` is the change
 * of the transit time between two packets in sequence. The jitter starts at 0. A list with fewer than 2 delays has no
 * jitter.
 */
export function rfc3550Jitter(delaysMs: readonly number[]): number | undefined {
  if (delaysMs.length < 2) return undefined;
  let jitter = 0;
  for (let index = 1; index < delaysMs.length; index++) jitter += (Math.abs(delaysMs[index]! - delaysMs[index - 1]!) - jitter) * JITTER_GAIN;
  return jitter;
}

/**
 * This function gives the IP packet delay variation (IPDV) of RFC 3393 for each two packets in sequence. The IPDV of
 * a pair is the delay of the second packet less the delay of the first.
 */
export function ipdv(delaysMs: readonly number[]): number[] {
  return delaysMs.slice(1).map((delay, index) => delay - delaysMs[index]!);
}

/** This function gives the packet delay variation of RFC 5481 for each packet: its delay less the smallest delay of the list. */
export function pdv(delaysMs: readonly number[]): number[] {
  const least = delaysMs.reduce((low, delay) => Math.min(low, delay), Infinity);
  return delaysMs.map((delay) => delay - least);
}

/** The summary of a list of delays. Each time is in milliseconds. */
export interface DelayMetrics {
  /** The number of delays. */
  readonly samples: number;
  readonly minMs: number;
  readonly medianMs: number;
  readonly meanMs: number;
  readonly maxMs: number;
  /** The sample standard deviation. A list with fewer than 2 delays does not have it. */
  readonly sdMs?: number | undefined;
  /** The jitter of RFC 3550. A list with fewer than 2 delays does not have it. */
  readonly jitterMs?: number | undefined;
  /** The median of the absolute values of the IPDV of RFC 3393. A list with fewer than 2 delays does not have it. */
  readonly ipdvMs?: number | undefined;
  /** The quantile `PDV_QUANTILE` of the PDV of RFC 5481. */
  readonly pdvMs: number;
}

/** This function gives the summary of a list of delays. An empty list, or a list with a value that is not finite, has no summary. */
export function delayMetrics(delaysMs: readonly number[]): DelayMetrics | undefined {
  if (delaysMs.length === 0 || !delaysMs.every(Number.isFinite)) return undefined;
  const steps = ipdv(delaysMs).map(Math.abs);
  return {
    samples: delaysMs.length,
    minMs: delaysMs.reduce((low, delay) => Math.min(low, delay), Infinity),
    medianMs: median(delaysMs),
    meanMs: mean(delaysMs),
    maxMs: delaysMs.reduce((high, delay) => Math.max(high, delay), -Infinity),
    ...(delaysMs.length < 2 ? {} : { sdMs: sd(delaysMs), jitterMs: rfc3550Jitter(delaysMs), ipdvMs: median(steps) }),
    pdvMs: quantile(pdv(delaysMs), PDV_QUANTILE),
  };
}
