// The schemes of the HTTP request of a check. This module imports nothing, so a browser can read a report with it.

/** The schemes of the HTTP request of a check. */
export const SCHEMES: readonly ["http", "https"] = ["http", "https"];

/** A scheme of the HTTP request of a check. */
export type Scheme = (typeof SCHEMES)[number];

/** This function tells if a value is a scheme of a check. */
export function isScheme(value: unknown): value is Scheme {
  return (SCHEMES as readonly unknown[]).includes(value);
}
