import {
  DNS_ANSWER,
  STANDARD_CATALOG,
  diagnose,
  formatTarget,
  hostKind,
  isFactOf,
  readEvidence,
  type Cause,
  type Diagnosis,
  type Evidence,
  type Fact,
  type Grant,
  type Skipped,
  type VisitRole,
  type VisitStep,
} from "@mark1russell7/netdiag";
import { countOf } from "@mark1russell7/text";
import { pad } from "@mark1russell7/text/length";
import { TOP_CAUSES, nextSteps, type NextStep } from "./next.ts";
import type { CheckPlan, Scheme } from "./plan.ts";

// The report of a check: the steps of the visit, changed into evidence, the causes and the next step. Each function of
// this module is pure: the same plan and the same steps give the same report.

/** The format of the JSON report of a check. A change to the shape of `CheckReport` changes the format. */
export const CHECK_FORMAT = "netdiag-check/1";

/** A fact of a visit, with the role and the host of the step that gave it. */
export interface CheckFact {
  readonly role: VisitRole;
  readonly host: string;
  readonly fact: Fact;
}

/** A problem of a visit: a probe that did not end, with the role and the host of the step. */
export interface CheckProblem {
  readonly role: VisitRole;
  readonly host: string;
  readonly problem: string;
}

/** The report of a check. `--json` writes this object. */
export interface CheckReport {
  readonly format: typeof CHECK_FORMAT;
  /** The target, as `host` or `host:port`. */
  readonly target: string;
  readonly scheme: Scheme;
  readonly path: string;
  /** The grants of the scope of the check. */
  readonly grants: readonly Grant[];
  /** Each cause, from the most probable. */
  readonly causes: readonly Cause[];
  /** The next step, or `null` when no probe can tell more about the most probable causes. */
  readonly next: NextStep | null;
  /** Each next step with a gain, from the largest gain. The first one is `next`. */
  readonly choices: readonly NextStep[];
  readonly problems: readonly CheckProblem[];
  /** The evidence that the diagnosis used. A fact of the role `target` gives primary evidence. */
  readonly evidence: readonly Evidence[];
  /** The evidence that the diagnosis did not use, with the reason. */
  readonly ignored: Diagnosis["ignored"];
  /** The facts that gave no evidence, with the reason. */
  readonly skipped: readonly Skipped[];
  readonly facts: readonly CheckFact[];
}

/** This function gives the roles with an address to probe: an IP address of the plan, or an address of a DNS answer. */
function addressedRoles(plan: CheckPlan, facts: readonly CheckFact[]): Set<VisitRole> {
  const roles = new Set<VisitRole>();
  if (plan.target.kind !== "name") roles.add("target");
  if ((plan.visit.references ?? []).some((host) => hostKind(host.host) !== "name")) roles.add("reference");
  if (plan.visit.gateway !== undefined) roles.add("gateway");
  for (const { role, fact } of facts) if (isFactOf(DNS_ANSWER, fact) && fact.value.addresses.length > 0) roles.add(role);
  return roles;
}

/**
 * This function gives the report of the steps of a visit.
 *
 * - A fact of the role `target` gives primary evidence. A fact of each other role gives reference evidence.
 * - The report finds the facts of the target by their role, not by their position. Thus a first step of the role
 *   `local` is not a problem.
 * - The causes come from `diagnose` with `STANDARD_CATALOG`. The next steps come from `nextSteps`.
 */
export function reportOf(plan: CheckPlan, steps: readonly VisitStep[]): CheckReport {
  const facts: CheckFact[] = steps.flatMap((step) => (step.kind === "fact" ? [{ role: step.role, host: step.host, fact: step.fact }] : []));
  const problems: CheckProblem[] = steps.flatMap((step) => (step.kind === "problem" ? [{ role: step.role, host: step.host, problem: step.problem }] : []));
  const primary = new Set(facts.filter((item) => item.role === "target").map((item) => item.fact.id));
  const reading = readEvidence(
    facts.map((item) => item.fact),
    { primary: (fact) => primary.has(fact.id), gateway: plan.visit.gateway },
  );
  const diagnosis = diagnose(STANDARD_CATALOG, reading.evidence);
  const choices = nextSteps(diagnosis, plan, addressedRoles(plan, facts));
  return {
    format: CHECK_FORMAT,
    target: formatTarget(plan.target),
    scheme: plan.scheme,
    path: plan.path,
    grants: plan.visit.grants,
    causes: diagnosis.causes,
    next: choices[0] ?? null,
    choices,
    problems,
    evidence: diagnosis.used,
    ignored: diagnosis.ignored,
    skipped: reading.skipped,
    facts,
  };
}

/** This function gives a probability as a percent for a person: `<1%` for a probability above 0 that rounds to 0. */
export function percentOf(probability: number): string {
  const value = Math.round(probability * 100);
  return value === 0 && probability > 0 ? "<1%" : `${value}%`;
}

/**
 * This function gives the role and the host of a step for a person. A step of the role `local` is a passive read of
 * this computer, so its text is `this computer`.
 */
export function subjectText(role: string, host: string): string {
  return role === "local" ? "this computer" : `${role} ${host}`;
}

/** The indent of the lines under a cause. */
const UNDER = " ".repeat(8);

/**
 * This function gives the lines of the text report of a check: the most probable causes with their probabilities, the
 * next step with its gain, the problems of the visit and the count of the evidence.
 */
export function formatReport(report: CheckReport): string[] {
  const lines = [`netdiag check ${report.target} (${report.scheme}, path ${report.path})`, "", "The probable causes"];
  for (const cause of report.causes.slice(0, TOP_CAUSES)) {
    lines.push(`  ${pad(percentOf(cause.probability), 4, { side: "start" })}  ${cause.summary}`, `${UNDER}To do: ${cause.step}`);
  }
  if (report.evidence.length === 0) lines.push("  The visit gave no evidence. These probabilities are the probabilities before a probe.");
  lines.push("");
  if (report.next === null) lines.push("The next step", "  netdiag has no probe that can tell more about these causes.");
  else lines.push(`The next step (it can give ${report.next.gain.toFixed(2)} bits of information about the causes)`, `  ${report.next.step}`);
  if (report.problems.length > 0) {
    lines.push("", `The problems of the visit (${report.problems.length})`);
    for (const item of report.problems) lines.push(`  ${subjectText(item.role, item.host)}: ${item.problem}`);
  }
  lines.push("", `${countOf(report.evidence.length, "observation")} from ${countOf(report.facts.length, "fact")}. The option --json gives each fact.`);
  return lines;
}
