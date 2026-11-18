/**
 * This module holds the bins that change the number in a fact into the value of a feature. The catalog uses the bins
 * of a loss. The predictions of a loss come from the count of the echo requests and the limits of these bins.
 */

/** A bin of a number. A number below `below` gets `value`. The last bin has no limit. */
export interface Bin {
  readonly below?: number | undefined;
  readonly value: string;
}

/** This function gives the value of the first bin that holds `x`. */
export function binOf(bins: readonly Bin[], x: number): string {
  for (const bin of bins) if (bin.below === undefined || x < bin.below) return bin.value;
  throw new RangeError("The last bin has a limit.");
}

/**
 * The smallest number of echo requests that gives the feature `path.loss`. With 20 requests, one lost request is a loss
 * of 5 %. With no reply, the feature `icmp.reply` tells the result, not `path.loss`.
 */
export const LOSS_MIN_SENT = 20;

/**
 * The bins of the features `path.loss` and `gateway.loss`, on the share of the echo requests with a reply. A share of 1
 * has no loss. A share of 0.95 or more has a loss of up to 5 %. A share below 0.5 lost most requests.
 */
export const PATH_LOSS_BINS: readonly Bin[] = [{ below: 0.5, value: "most" }, { below: 0.95, value: "high" }, { below: 1, value: "some" }, { value: "none" }];
