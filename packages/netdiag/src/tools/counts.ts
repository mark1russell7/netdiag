// The limits of the echo requests of the ping tool and of the cycles of mtr. This module imports no module of Node, so
// the plan of a check in a browser can use them.

/** The default number of echo requests. The feature `path.loss` needs `LOSS_MIN_SENT` requests or more. */
export const DEFAULT_PING_COUNT = 4;

/** The largest number of echo requests in one input. */
export const MAX_PING_COUNT = 100;

/** The default number of cycles of mtr. It is `LOSS_MIN_SENT` of the readers, so a report gives the feature `path.loss`. */
export const DEFAULT_MTR_CYCLES = 20;

/** The largest number of cycles of mtr in one input. */
export const MAX_MTR_CYCLES = 100;
