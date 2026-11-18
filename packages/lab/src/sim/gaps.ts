import type { ParamValue } from "@mark1russell7/strategy-space";
import { faultMatches, faultsOf, NO_FAULT, type FaultTerm } from "../grammar.ts";
import type { SimHistory } from "./cases.ts";

// The known gaps of the simulated world. A known gap is a cell where netdiag fails for a known cause. The gate examines
// the cases of a gap apart from the other cases, with a bar of their own. Thus the bars of the other cells keep their
// gains, and the gap shows with its cause and its end.

/**
 * A known gap: the cases of one class with one fault of the grammar and a history that matches, the cause of the failure,
 * and the work that ends it.
 */
export interface SimGap {
  /** The id of the gap, for example `none/private-root`. */
  readonly id: string;
  /** The class of the cases of the gap. */
  readonly label: string;
  /** The option of the grammar of a fault of each case of the gap. */
  readonly option: string;
  /** For each named param of the option, the values that match. Without `when`, each fault of the option matches. */
  readonly when?: Readonly<Record<string, readonly ParamValue[]>> | undefined;
  /** The histories of the cases of the gap. Without `histories`, each history matches. */
  readonly histories?: readonly SimHistory[] | undefined;
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
    histories: ["unknown", "rotated"],
    cause:
      "With no history, or a history of an old root, a certificate from a private root that the clients trust has the facts of an interception at a remote hop. The trust is private at the target and public at the reference. With the history of the root, the baseline stage tells the two apart.",
    end: "A probe of the logs of Certificate Transparency (ND-23): a name with public certificates in the logs and a private root at the check is an interception.",
  },
];

/** This function gives the known gap of a case, or `undefined` for a case in no gap. */
export function gapOf(labCase: { readonly truth: string; readonly term: FaultTerm; readonly history?: SimHistory | undefined }, gaps: readonly SimGap[] = SIM_GAPS): SimGap | undefined {
  // A record of a run before the baseline stage has no history. Its cases had no history.
  const history = labCase.history ?? "unknown";
  return gaps.find(
    (gap) => gap.label === labCase.truth && (gap.histories === undefined || gap.histories.includes(history)) && faultsOf(labCase.term).some((choice) => faultMatches(choice, gap.option, gap.when)),
  );
}
