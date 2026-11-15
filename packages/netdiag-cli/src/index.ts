/**
 * The entry of `@mark1russell7/netdiag-cli`: the command line of netdiag.
 *
 * The program `netdiag` has the command `check`. The pure parts are also exports: the plan of a check with its scope
 * rule, the report, the text of the report and the choice of the next step.
 */
export { SCHEMES, planCheck, type CheckOptions, type CheckPlan, type PlanSystem, type Scheme } from "./plan.ts";
export { ADD_GATEWAY, ADD_REFERENCE, NEXT_PROBES, TOP_CAUSES, nextSteps, stepText, type NextProbe, type NextProbeKind, type NextStep } from "./next.ts";
export { CHECK_FORMAT, formatReport, percentOf, reportOf, subjectText, type CheckFact, type CheckProblem, type CheckReport } from "./report.ts";
export { check, systemDeps, type CheckDeps } from "./check.ts";
export { PROGRAM, createNetdiagCli, main, packageVersion, type NetdiagCliOptions } from "./cli.ts";
