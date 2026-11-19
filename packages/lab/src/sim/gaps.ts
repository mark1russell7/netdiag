import type { ParamValue } from "@mark1russell7/strategy-space";
import { faultMatches, faultsOf, NO_FAULT, type FaultTerm } from "../grammar.ts";
import type { SimHistory } from "./cases.ts";

// The known gaps of the simulated world. A known gap is a rule over the fault and the history of a case. The rule is in
// this file before a run. It is not a list of the cases that failed. The cases of a gap have the same facts as the cases
// of its twin, a fault of a different class. No method can tell the two apart. Thus the gate examines the cases of a gap
// apart from the other cases, with a bar of their own. A test holds the twin rule. When a new probe tells a gap from its
// twin, the test fails. Then remove the gap, and its cases go back to the bar of their class.

/** The twin of a known gap: a fault of a different class. Its cases have the same facts as the cases of the gap. */
export interface SimTwin {
  /** The class of the twin. */
  readonly label: string;
  /** The option of the grammar of the fault of the twin. */
  readonly option: string;
  /** The params of the fault of the twin. */
  readonly params: Readonly<Record<string, ParamValue>>;
}

/**
 * A known gap of the simulated world. It has the cases of one class with one fault of the grammar and a matching history.
 * It also has the cause of the failure and the work that ends it.
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
  /** The twin of the gap. A test holds that each case of the gap and its twin case give the same evidence. */
  readonly twin: SimTwin;
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
    twin: { label: "tls.proxy", option: "tls/intercept", params: { place: "remote" } },
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

/** This function gives the twin case of a case of a gap. The fault of the twin takes the place of the fault of the gap. */
export function twinCase<T extends { readonly truth: string; readonly term: FaultTerm }>(labCase: T, gap: SimGap): T {
  const choice = { option: gap.twin.option, params: gap.twin.params };
  const stages = Object.fromEntries(Object.entries(labCase.term.stages).map(([stage, each]) => [stage, each !== undefined && each !== null && faultMatches(each, gap.option, gap.when) ? choice : each]));
  return { ...labCase, truth: gap.twin.label, term: { ...labCase.term, stages } };
}
