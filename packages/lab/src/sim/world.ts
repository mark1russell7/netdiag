import { fakeClock } from "@mark1russell7/algebra/clock";
import { visitTarget, type Fact, type Grant, type LabBars, type VisitInput, type VisitStep } from "@mark1russell7/netdiag";
import { random } from "@mark1russell7/rigor-generators";
import { REFERENCE_NAME, TARGET_NAME } from "../cases.ts";
import type { CoverageWorld } from "../coverage.ts";
import { DNS_TIMEOUT_MS, HTTP_TIMEOUT_MS, type LabRound, type Visit } from "../run.ts";
import { SIM_PING_COUNT, simCases, type SimCase } from "./cases.ts";
import { SIM_ADDRESSES, SIM_RANGES, SimNetwork } from "./network.ts";
import { interfacesOf, simDnsProbe, simHttpProbe } from "./probes.ts";
import { simTools } from "./tools.ts";

// The world of the simulated network (ND-17, the layer E0). Each visit is the real `visitTarget` of netdiag with the
// tools and the probes of the model. The visit uses a fake clock, so a plan of 252 cases takes seconds and needs no lab.

/** The seed of the plan of the cases of the coverage table. */
export const SIM_PLAN_SEED = 1;

/** The fixed wall-clock time of each visit, so that two runs of one seed give the same facts. */
const SIM_WALL = "2026-11-17T00:00:00.000Z";

const grants: readonly Grant[] = SIM_RANGES.map((cidr) => ({ kind: "range", cidr, basis: "owned", note: "a network of the simulated world" }));

/** The input of each visit: the target, one reference host, the gateway, and the gateway as the resolver. */
export const SIM_INPUT: VisitInput = {
  target: { host: TARGET_NAME, port: 443 },
  references: [{ host: REFERENCE_NAME, port: 443 }],
  gateway: SIM_ADDRESSES.gateway[4],
  resolver: { address: SIM_ADDRESSES.gateway[4], port: 53 },
  grants,
};

/** This function visits one case of the simulated world. The random source of the network comes from the seed of the case. */
export async function visitSim(labCase: SimCase): Promise<Visit> {
  const clock = fakeClock(0);
  const net = new SimNetwork({ term: labCase.term, medium: labCase.medium, ipv6: labCase.ipv6 }, random(labCase.seed));
  const facts: Fact[] = [];
  const primary = new Set<string>();
  const problems: string[] = [];
  const steps: VisitStep[] = [];
  const visit = visitTarget(SIM_INPUT, {
    clock,
    tools: simTools(net, clock),
    probes: { dns: simDnsProbe(net, clock), http: simHttpProbe(net, clock) },
    interfaces: () => interfacesOf(net),
    wifi: labCase.medium === "wifi",
    pingCount: SIM_PING_COUNT,
    mtrCycles: 0,
    mtu: "auto",
    dnsTimeoutMs: DNS_TIMEOUT_MS,
    httpTimeoutMs: HTTP_TIMEOUT_MS,
    wall: SIM_WALL,
  });
  for await (const step of visit) {
    steps.push(step);
    if (step.kind === "problem") problems.push(step.problem);
    else {
      facts.push(step.fact);
      if (step.role === "target") primary.add(step.fact.id);
    }
  }
  return { status: "visited", facts, read: { primary: (fact) => primary.has(fact.id), gateway: SIM_INPUT.gateway }, problems, steps };
}

/** The round of the simulated world. It starts no process, so `close` has no work. */
export const SIM_ROUND: LabRound<SimCase> = { visit: visitSim, close: () => Promise.resolve() };

/** This function gives the coverage world of the simulated network, with the cases of the plan of `SIM_PLAN_SEED`. */
export function simWorld(bars: LabBars): CoverageWorld {
  const cases = simCases(SIM_PLAN_SEED).map((each) => ({ id: each.id, truth: each.truth }));
  return { id: "sim", name: "Simulated network", layer: "E0", scores: "class", traits: ["ipv6", "wifi", "link"], cases, bars };
}
