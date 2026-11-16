import {
  DNS_ANSWER,
  NATIVE_KINDS,
  STANDARD_CATALOG,
  TOOL_KINDS,
  VISIT_ROLES,
  diagnose,
  formatTarget,
  hostKind,
  isFactOf,
  readEvidence,
  readFact,
  type Cause,
  type Diagnosis,
  type Evidence,
  type Fact,
  type Grant,
  type Skipped,
  type VisitRole,
  type VisitStep,
} from "@mark1russell7/netdiag";
import { err, ok, type Result } from "@mark1russell7/optional";
import { countOf } from "@mark1russell7/text";
import { pad } from "@mark1russell7/text/length";
import { TOP_CAUSES, nextSteps, type NextStep } from "./next.ts";
import type { CheckPlan } from "./plan.ts";
import { isScheme, type Scheme } from "./scheme.ts";

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
 * This function gives the lines of the text report of a check. The lines show the most probable causes with their
 * probabilities and the next step with its gain. They also show the problems of the visit and the count of the evidence.
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

// The reader of a JSON report. A page reads a report that a user gives, so the reader checks each field that a view uses.

/** The largest number of problems that `readCheckReport` gives. A file of another format has many problems, and the first ones tell enough. */
export const MAX_REPORT_PROBLEMS = 20;

/** The largest difference of the sum of the probabilities of the causes from 1. */
const SUM_TOLERANCE = 1e-6;

const CAUSE_KINDS: ReadonlySet<unknown> = new Set(["none", "fault", "unknown"]);
const ROLES: ReadonlySet<unknown> = new Set(VISIT_ROLES);
const FACT_KINDS = [...NATIVE_KINDS, ...TOOL_KINDS];

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isPart(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isGrant(value: unknown): boolean {
  if (!isFields(value) || !isName(value["basis"])) return false;
  return (value["kind"] === "host" && isName(value["host"])) || (value["kind"] === "range" && isName(value["cidr"]));
}

function isCause(value: unknown): value is Cause {
  return isFields(value) && isName(value["id"]) && CAUSE_KINDS.has(value["kind"]) && typeof value["summary"] === "string" && typeof value["step"] === "string" && isPart(value["probability"]);
}

function isNextStep(value: unknown): value is NextStep {
  if (!isFields(value) || !isName(value["id"]) || typeof value["step"] !== "string") return false;
  const gain = value["gain"];
  const observes = value["observes"];
  return (
    typeof gain === "number" &&
    Number.isFinite(gain) &&
    gain >= 0 &&
    Array.isArray(observes) &&
    observes.every((each) => isFields(each) && isName(each["feature"]) && typeof each["primary"] === "boolean")
  );
}

function isEvidence(value: unknown): value is Evidence {
  if (!isFields(value) || !isName(value["feature"]) || !isName(value["value"]) || typeof value["primary"] !== "boolean") return false;
  const facts = value["facts"];
  return facts === undefined || (Array.isArray(facts) && facts.every(isName));
}

function isProblem(value: unknown): boolean {
  return isFields(value) && ROLES.has(value["role"]) && typeof value["host"] === "string" && isName(value["problem"]);
}

/**
 * This function reads a report of the format `netdiag-check/1`, for example the output of `--json`, and checks it.
 *
 * - Each field of `CheckReport` has its type. Each fact passes `readFact` of netdiag with the fact kinds of netdiag.
 * - The causes go from the most probable, and their probabilities sum to 1. `next` is the first of `choices`.
 * - Each fact id of the evidence and of `skipped` is the id of a fact of the report, and each fact id is unique.
 *
 * The result is the same object with the type `CheckReport`, or at most `MAX_REPORT_PROBLEMS` problems. This module
 * starts no probe, so a browser can read a report with it.
 */
export function readCheckReport(value: unknown): Result<CheckReport, string[]> {
  if (!isFields(value)) return err(["The report is not a JSON object."]);
  if (value["format"] !== CHECK_FORMAT) return err([`The format of the report is ${JSON.stringify(value["format"] ?? null)}, not "${CHECK_FORMAT}".`]);
  const problems: string[] = [];
  const need = (pass: boolean, problem: string): void => {
    if (!pass) problems.push(problem);
  };
  const list = (field: string, check: (item: unknown) => boolean, what: string): readonly unknown[] => {
    const items = value[field];
    if (!Array.isArray(items)) {
      problems.push(`The field ${field} of the report is not a list.`);
      return [];
    }
    items.forEach((item: unknown, at) => need(check(item), `The item ${at + 1} of ${field} is not ${what}.`));
    return items;
  };
  need(isName(value["target"]), "The report has no target.");
  need(isScheme(value["scheme"]), "The scheme of the report is not http or https.");
  need(typeof value["path"] === "string" && value["path"].startsWith("/"), "The path of the report does not start with /.");
  list("grants", isGrant, "a grant");
  const causes = list("causes", isCause, "a cause").filter(isCause);
  if (causes.length > 0) {
    const sum = causes.reduce((total, cause) => total + cause.probability, 0);
    need(Math.abs(sum - 1) <= SUM_TOLERANCE, `The probabilities of the causes sum to ${sum}, not 1.`);
    need(
      causes.every((cause, at) => at === 0 || (causes[at - 1]?.probability ?? 0) >= cause.probability),
      "The causes do not go from the most probable.",
    );
  }
  const choices = list("choices", isNextStep, "a next step").filter(isNextStep);
  const next = value["next"];
  need(next === null || isNextStep(next), "The field next of the report is not a next step or null.");
  need((next === null && choices.length === 0) || (isNextStep(next) && next.id === choices[0]?.id), "The next step is not the first of the choices.");
  list("problems", isProblem, "a problem of a probe");
  const evidence = list("evidence", isEvidence, "evidence").filter(isEvidence);
  const ignored = list("ignored", (item) => isFields(item) && isEvidence(item["evidence"]) && isName(item["reason"]), "evidence with a reason");
  const skipped = list("skipped", (item) => isFields(item) && isName(item["fact"]) && isName(item["reason"]), "a fact with a reason");
  const ids = new Set<string>();
  list(
    "facts",
    (item) => isFields(item) && ROLES.has(item["role"]) && typeof item["host"] === "string" && isFields(item["fact"]),
    "a fact with a role and a host",
  ).forEach((item, at) => {
    if (!isFields(item)) return;
    const read = readFact(item["fact"], FACT_KINDS);
    if (read.tag === "err") {
      problems.push(...read.error.map((problem) => `The item ${at + 1} of facts: ${problem}`));
      return;
    }
    need(!ids.has(read.value.id), `The fact id ${read.value.id} is not unique.`);
    ids.add(read.value.id);
  });
  const cited = [
    ...evidence.flatMap((item) => item.facts ?? []),
    ...ignored.flatMap((item) => (isFields(item) && isEvidence(item["evidence"]) ? (item["evidence"].facts ?? []) : [])),
    ...skipped.flatMap((item) => (isFields(item) && isName(item["fact"]) ? [item["fact"]] : [])),
  ];
  for (const id of new Set(cited)) need(ids.has(id), `The report names the fact ${id}, and has no fact with this id.`);
  if (problems.length > 0) return err(problems.slice(0, MAX_REPORT_PROBLEMS));
  return ok(value as unknown as CheckReport);
}
