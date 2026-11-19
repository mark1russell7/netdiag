// This file is data. The command of the simulated world of the lab writes it with --write, from seeds that its gate does not use.

import type { ActionPolicy } from "./actions.ts";

/**
 * The policy of `chooseAction` for `STANDARD_CATALOG` and `STANDARD_ACTIONS`.
 *
 * - The two temperatures give the least Brier score of the kind probabilities on the held-out seeds of the sim.
 * - The harmful cost is the least cost that keeps the harm of each class at the limit or under it, on each seed set.
 * - The needless cost is the least cost that keeps the false actions on healthy targets at the limit or under it.
 */
export const STANDARD_POLICY: ActionPolicy = { calibration: { cause: 0.354, variant: 1 }, costs: { none: 1, useless: 1, needless: 5, harmful: 40 } };
