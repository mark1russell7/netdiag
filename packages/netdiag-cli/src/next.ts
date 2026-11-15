import {
  DNS_ANSWER,
  GAIN_RESOLUTION,
  HTTP_RESPONSE,
  ICMP_ECHO,
  LOSS_MIN_SENT,
  STANDARD_CATALOG,
  TCP_CONNECT,
  TLS_HANDSHAKE,
  featuresOf,
  formatTarget,
  hostKind,
  rankProbes,
  type Candidate,
  type Diagnosis,
  type Evidence,
  type Observable,
  type VisitRole,
} from "@mark1russell7/netdiag";
import type { CheckPlan } from "./plan.ts";

// The choice of the next step. Each candidate is a probe of the visit for one role. Its features are the features that
// the facts of the probe give, and that the evidence does not have yet. `rankProbes` orders the candidates by the
// information that they can give about the most probable causes.

/** A probe of a visit: the DNS query, the ICMP echo requests, the TLS handshake, or the HTTP request. */
export type NextProbeKind = "dns" | "ping" | "tls" | "http";

/** A probe that the next step can start, for one role of the visit. */
export interface NextProbe {
  /** The id of the candidate: the role and the probe, for example `gateway.ping`. */
  readonly id: string;
  readonly role: VisitRole;
  readonly probe: NextProbeKind;
  /** The fact kinds that the probe gives. A TLS handshake and an HTTP request also give the TCP connect before them. */
  readonly kinds: readonly string[];
  /** An approximate time of the probe, in seconds. When two gains are equal, the lower cost comes first. */
  readonly cost: number;
}

/** The next step of a check: the instruction in plain words, its information gain, and the features that it observes. */
export interface NextStep {
  /** The id of the probe of the step, for example `gateway.ping`. */
  readonly id: string;
  /** The instruction to the user. */
  readonly step: string;
  /** The expected information gain over the most probable causes, in bits. */
  readonly gain: number;
  /** The features that the step observes and that the evidence does not have. */
  readonly observes: readonly Observable[];
}

/** The number of the most probable causes that the report shows, and that the gain of a next step tells apart. */
export const TOP_CAUSES = 3;

const PROBE_KINDS: Readonly<Record<NextProbeKind, readonly string[]>> = {
  dns: [DNS_ANSWER.kind],
  ping: [ICMP_ECHO.kind],
  tls: [TCP_CONNECT.kind, TLS_HANDSHAKE.kind],
  http: [TCP_CONNECT.kind, HTTP_RESPONSE.kind],
};

const PROBE_COSTS: Readonly<Record<NextProbeKind, number>> = { dns: 1, tls: 2, http: 3, ping: 5 };

const PROBE_NAMES: Readonly<Record<NextProbeKind, string>> = { dns: "DNS query", ping: "ping", tls: "TLS handshake", http: "HTTP request" };

function nextProbe(role: VisitRole, probe: NextProbeKind): NextProbe {
  return { id: `${role}.${probe}`, role, probe, kinds: PROBE_KINDS[probe], cost: PROBE_COSTS[probe] };
}

/**
 * The candidates of the next step: each probe of the target and of the reference hosts, and the ping of the gateway.
 * The TLS handshake and the HTTP request are two candidates, one for each stage. Each stage has its own conditions in
 * `ready`. One candidate for the whole HTTPS request is the next change of this list.
 */
export const NEXT_PROBES: readonly NextProbe[] = [
  ...(["target", "reference"] as const).flatMap((role) => (["dns", "ping", "tls", "http"] as const).map((probe) => nextProbe(role, probe))),
  nextProbe("gateway", "ping"),
];

/** The instruction to add a reference host. */
export const ADD_REFERENCE = "Add a host that works for you with --reference <host>, for example a large web site.";

/** The instruction to add the gateway. */
export const ADD_GATEWAY = "Give the address of your router with --gateway <address>.";

const keyOf = (item: Observable): string => `${item.feature}\u0000${item.primary ? 1 : 0}`;

/** This function tells if the evidence of a role has no value of a feature, or has the value `value`. */
function openOrIs(evidence: readonly Evidence[], primary: boolean, feature: string, value: string): boolean {
  const values = evidence.filter((item) => item.feature === feature && item.primary === primary).map((item) => item.value);
  return values.length === 0 || values.includes(value);
}

/**
 * The features that a probe gives only after a stage with one value. For example, a DNS answer gives addresses only
 * when its outcome is `ok`. A new check cannot give such a feature when the evidence has another value of the stage.
 */
const AFTER_STAGE: Readonly<Record<string, readonly [feature: string, value: string]>> = {
  "dns.address": ["dns.answer", "ok"],
};

/** This function tells if a new check can give a feature, from the stage before the feature. */
function observable(item: Observable, evidence: readonly Evidence[]): boolean {
  const stage = AFTER_STAGE[item.feature];
  return stage === undefined || openOrIs(evidence, item.primary, stage[0], stage[1]);
}

/** This function tells if the user can add the host of a role with an option. The step of such a role tells how. */
function absent(role: VisitRole, plan: CheckPlan): boolean {
  if (role === "reference") return (plan.visit.references ?? []).length === 0;
  return role === "gateway" && plan.visit.gateway === undefined;
}

/**
 * This function tells if a probe can give its facts in a new check. A probe after a stage that failed cannot: for
 * example, no TLS handshake follows a TCP connect that the server refused.
 */
function ready(probe: NextProbe, plan: CheckPlan, addressed: ReadonlySet<VisitRole>, evidence: readonly Evidence[]): boolean {
  const primary = probe.role === "target";
  if (absent(probe.role, plan)) return probe.probe !== "tls" || plan.scheme === "https";
  switch (probe.probe) {
    case "dns":
      return probe.role === "target" ? plan.target.kind === "name" : (plan.visit.references ?? []).some((host) => hostKind(host.host) === "name");
    case "ping":
      return probe.role === "gateway" || addressed.has(probe.role);
    case "tls":
      return addressed.has(probe.role) && openOrIs(evidence, primary, "tcp.connect", "connected");
    case "http":
      return (
        addressed.has(probe.role) &&
        openOrIs(evidence, primary, "tcp.connect", "connected") &&
        (plan.scheme === "http" || openOrIs(evidence, primary, "tls.handshake", "ok"))
      );
  }
}

/** This function gives the instruction of a next step in plain words. */
export function stepText(probe: NextProbe, observes: readonly Observable[], plan: CheckPlan): string {
  const morePings = `Run the check again with --ping-count ${LOSS_MIN_SENT}.`;
  if (probe.role === "reference" && absent("reference", plan)) return ADD_REFERENCE;
  if (probe.role === "gateway" && absent("gateway", plan)) return plan.pingCount === 0 ? `${ADD_GATEWAY} ${morePings}` : ADD_GATEWAY;
  const who = probe.role === "target" ? formatTarget(plan.target) : probe.role === "gateway" ? `the gateway ${plan.visit.gateway ?? ""}` : "the reference hosts";
  switch (probe.probe) {
    case "dns":
      if (plan.visit.resolver === undefined) return "Give the address of a DNS resolver with --resolver <address>.";
      break;
    case "ping":
      if (plan.pingCount === 0 || (plan.pingCount < LOSS_MIN_SENT && observes.every((item) => item.feature === "path.loss"))) return morePings;
      break;
    case "tls":
      if (plan.scheme === "http") return "Run the check again with --scheme https.";
      break;
    case "http":
      break;
  }
  const features = [...new Set(observes.map((item) => item.feature))].join(", ");
  return `The check has no value of ${features} from the ${PROBE_NAMES[probe.probe]} of ${who}. Look at the problems of the visit, then run the check again.`;
}

/**
 * This function gives the next steps of a check, from the largest information gain. The first step is the next step.
 *
 * - A candidate observes the features of its fact kinds that the evidence does not have, with the role of the probe.
 *   A feature after a stage that gave another value is not observable: no address follows an answer `nxdomain`.
 * - A probe that cannot give its facts is not a candidate. `addressed` has the roles with an address to probe: an IP
 *   address, or an address of a DNS answer.
 * - A step with a gain of `GAIN_RESOLUTION` or less tells nothing, so the list does not have it.
 * - Two probes with the same instruction give one step, with the larger gain. For example, each probe of a reference
 *   host that the user did not give has the instruction `ADD_REFERENCE`.
 */
export function nextSteps(diagnosis: Diagnosis, plan: CheckPlan, addressed: ReadonlySet<VisitRole>): NextStep[] {
  if (diagnosis.causes.length === 0) return [];
  const seen = new Set(diagnosis.used.map(keyOf));
  const probes = new Map(NEXT_PROBES.filter((probe) => ready(probe, plan, addressed, diagnosis.used)).map((probe) => [probe.id, probe]));
  const candidates: Candidate[] = [...probes.values()]
    .map((probe) => ({
      id: probe.id,
      cost: probe.cost,
      observes: featuresOf(probe.kinds, { gateway: probe.role === "gateway" })
        .map((feature) => ({ feature, primary: probe.role === "target" }))
        .filter((item) => !seen.has(keyOf(item)) && observable(item, diagnosis.used)),
    }))
    .filter((candidate) => candidate.observes.length > 0);
  if (candidates.length === 0) return [];
  const steps: NextStep[] = [];
  const said = new Set<string>();
  for (const choice of rankProbes(STANDARD_CATALOG, diagnosis, candidates, { top: TOP_CAUSES })) {
    const probe = probes.get(choice.candidate.id);
    if (probe === undefined || choice.gain <= GAIN_RESOLUTION) continue;
    const step = stepText(probe, choice.counted, plan);
    if (said.has(step)) continue;
    said.add(step);
    steps.push({ id: probe.id, step, gain: choice.gain, observes: choice.counted });
  }
  return steps;
}
