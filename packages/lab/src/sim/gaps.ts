import type { ParamValue } from "@mark1russell7/strategy-space";
import { faultMatches, faultsOf, NO_FAULT, type FaultTerm } from "../grammar.ts";

// The known gaps of the simulated world. A known gap is a cell where netdiag fails for a known cause. The gate examines
// the cases of a gap apart from the other cases, with a bar of their own. Thus the bars of the other cells keep their
// gains, and the gap shows with its cause and its end.

/** A known gap: the cases of one class with one fault of the grammar, the cause of the failure, and the work that ends it. */
export interface SimGap {
  /** The id of the gap, for example `none/private-root`. */
  readonly id: string;
  /** The class of the cases of the gap. */
  readonly label: string;
  /** The option of the grammar of a fault of each case of the gap. */
  readonly option: string;
  /** For each named param of the option, the values that match. Without `when`, each fault of the option matches. */
  readonly when?: Readonly<Record<string, readonly ParamValue[]>> | undefined;
  /** The cause of the failure. */
  readonly cause: string;
  /** The work that ends the gap. When the bar of the gap gets to the bar of its class, the sim tells you to remove the gap. */
  readonly end: string;
}

/** The known gaps of the simulated world. Each gap has a cause and an end. */
export const SIM_GAPS: readonly SimGap[] = [
  {
    id: "none/private-root",
    label: NO_FAULT,
    option: "tls/wrong",
    when: { kind: ["private"] },
    cause:
      "A certificate from a private root that the clients trust has the same facts as an interception at a remote hop. The trust is private at the target and public at the reference. The model gives these cases a probability of no fault near 0.01.",
    end: "A baseline stage of the facts: the issuer of the target is the same as in the last good check, changed, or unknown.",
  },
];

/** This function gives the known gap of a case, or `undefined` for a case in no gap. */
export function gapOf(labCase: { readonly truth: string; readonly term: FaultTerm }, gaps: readonly SimGap[] = SIM_GAPS): SimGap | undefined {
  return gaps.find((gap) => gap.label === labCase.truth && faultsOf(labCase.term).some((choice) => faultMatches(choice, gap.option, gap.when)));
}
