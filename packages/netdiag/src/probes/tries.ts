// The tries of a DNS query. This module imports no module of Node, so the probe of the origins can use it.

/**
 * The count of the tries of a DNS query, when its input gives none: 3. A loss of 30 % in each direction then makes a
 * query fail in 13 % of the visits, and not in 51 %.
 */
export const DNS_TRIES = 3;

/** The most tries of a DNS query: 10. */
export const MAX_DNS_TRIES = 10;

/** This function gives the count of tries of an input. It throws for a count that is not an integer from 1 to `MAX_DNS_TRIES`. */
export function triesOf(tries: number | undefined): number {
  const count = tries ?? DNS_TRIES;
  if (!Number.isInteger(count) || count < 1 || count > MAX_DNS_TRIES) throw new RangeError(`${count} is not a count of tries from 1 to ${MAX_DNS_TRIES}.`);
  return count;
}

/**
 * This function gives the time limit of each try of a DNS query, in milliseconds. The tries share the time limit of
 * the query, so the last try ends at the limit.
 */
export function tryTimeoutOf(limitMs: number, tries: number): number {
  return Math.max(1, Math.floor(limitMs / tries));
}
