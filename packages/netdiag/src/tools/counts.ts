// The limits of the echo requests of the ping tool. This module imports no module of Node, so the plan of a check in a
// browser can use them.

/** The default number of echo requests. The feature `path.loss` needs `LOSS_MIN_SENT` requests or more. */
export const DEFAULT_PING_COUNT = 4;

/** The largest number of echo requests in one input. */
export const MAX_PING_COUNT = 100;
