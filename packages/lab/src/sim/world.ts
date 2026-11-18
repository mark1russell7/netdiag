import { fakeClock } from "@mark1russell7/algebra/clock";
import { visitTarget, type Fact, type Grant, type LabBars, type VisitInput, type VisitStep } from "@mark1russell7/netdiag";
import { random } from "@mark1russell7/rigor-generators";
import { REFERENCE_NAME, TARGET_NAME } from "../cases.ts";
import type { CoverageWorld } from "../coverage.ts";
import { DNS_TIMEOUT_MS, HTTP_TIMEOUT_MS, type Visit } from "../run.ts";
import { SIM_PING_COUNT, simCases, type SimCase } from "./cases.ts";
import { SIM_ADDRESSES, SIM_RANGES, SimNetwork, type PlacedFault } from "./network.ts";
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

/**
 * The most visits of one case. A fault in its band passes each of its draws in 1 of 20 visits or fewer. Thus 10 visits
 * leave a silent fault in fewer than 1 of 10^13 cases.
 */
export const SIM_VISITS = 10;

/** A visit of a case, the number of visits of the case, and the faults that passed each of their draws in the last visit. */
export interface SimVisit {
  readonly visit: Visit;
  readonly visits: number;
  readonly silent: readonly PlacedFault[];
}

/**
 * This function visits one case of the simulated world. When a fault of the case passes each of its draws, the visit
 * has no sign of the fault. Thus no diagnosis can name the fault, and the function visits the case again with a new
 * seed, `SIM_VISITS` times or fewer. A fault that is silent in each visit gives a problem, so the case has no read.
 */
export async function simVisit(labCase: SimCase): Promise<SimVisit> {
  for (let visits = 1; ; visits += 1) {
    const { visit, silent } = await visitOnce(labCase, visits === 1 ? labCase.seed : `${labCase.seed}/visit-${visits}`);
    if (silent.length === 0) return { visit, visits, silent };
    if (visits >= SIM_VISITS) {
      const names = silent.map((fault) => `${fault.option} at ${fault.place}`).join(", ");
      const problem = `The faults ${names} passed each of their draws in ${SIM_VISITS} visits.`;
      return { visit: visit.status === "visited" ? { ...visit, problems: [...visit.problems, problem] } : visit, visits, silent };
    }
  }
}

/** This function visits one case of the simulated world as `simVisit` does, and gives only the last visit. */
export async function visitSim(labCase: SimCase): Promise<Visit> {
  return (await simVisit(labCase)).visit;
}

/** This function visits one case once. The random source of the network comes from the seed. */
async function visitOnce(labCase: SimCase, seed: string): Promise<{ visit: Visit; silent: readonly PlacedFault[] }> {
  const clock = fakeClock(0);
  const net = new SimNetwork({ term: labCase.term, medium: labCase.medium, ipv6: labCase.ipv6 }, random(seed));
  const facts: Fact[] = [];
  const primary = new Set<string>();
  const problems: string[] = [];
  const steps: VisitStep[] = [];
  const visit = visitTarget(SIM_INPUT, {
    clock,
    tools: simTools(net, clock),
    probes: { dns: simDnsProbe(net, clock), http: simHttpProbe(net, clock) },
    interfaces: () => interfacesOf(net),
    // A real visit reads the Wi-Fi tool on each computer. On a wired case, `iw dev` lists no interface.
    wifi: true,
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
  return { visit: { status: "visited", facts, read: { primary: (fact) => primary.has(fact.id), gateway: SIM_INPUT.gateway }, problems, steps }, silent: net.silent() };
}

/** This function gives the coverage world of the simulated network, with the cases of the plan of `SIM_PLAN_SEED`. */
export function simWorld(bars: LabBars): CoverageWorld {
  const cases = simCases(SIM_PLAN_SEED).map((each) => ({ id: each.id, truth: each.truth }));
  return { id: "sim", name: "Simulated network", layer: "E0", scores: "class", traits: ["ipv6", "wifi", "link"], cases, bars };
}
