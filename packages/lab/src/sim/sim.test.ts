import { readFileSync } from "node:fs";
import { DEFAULT_TIMEOUT_MS, DNS_TRIES, LOSS_STEPS, STANDARD_CATALOG, tryTimeoutOf, type Fact } from "@mark1russell7/netdiag";
import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { fault, faults, faultsOf, faultValues, GRAMMAR_ENGINE, NO_FAULT, termClasses, termNeeds, type FaultTerm } from "../grammar.ts";
import { DNS_TIMEOUT_MS, readVisit, type Visit } from "../run.ts";
import { BARS_FOLDER } from "../worlds.ts";
import { CASES_PER_CLASS, SIM_BANDS, SIM_CLASSES, SIM_PING_COUNT, simCases, type SimCase } from "./cases.ts";
import { baseRtt, SimNetwork, type Medium } from "./network.ts";
import { MIN_RTO_MS, SYN_TRIES_MS } from "./probes.ts";
import { barsText, placeHits, silentVisits, simRuns } from "./report.ts";
import { SIM_VISITS, simVisit, visitSim } from "./world.ts";

/** The term with no fault. */
const HEALTHY: FaultTerm = { space: GRAMMAR_ENGINE, stages: {} };

/** This function gives a case of the simulated world for one term. */
function simCase(term: FaultTerm, medium: Medium = "wired", ipv6 = false): SimCase {
  return { id: "test", truth: termClasses(term)[0] ?? NO_FAULT, signs: [], term, medium, ipv6, seed: "sim-test:1" };
}

/** This function gives the values of the facts of one kind, for one address or for each address. */
function values(visit: Visit, kind: string, address?: string): Record<string, unknown>[] {
  if (visit.status !== "visited") throw new Error("The case has no visit.");
  return visit.facts
    .filter((fact: Fact) => fact.kind === kind)
    .map((fact) => fact.value as Record<string, unknown>)
    .filter((value) => address === undefined || value["address"] === address);
}

/** This function visits one case, and gives the visit and the class that netdiag gives. */
async function visitAndRead(labCase: SimCase): Promise<{ visit: Visit; predicted: string | undefined }> {
  const visit = await visitSim(labCase);
  const run = readVisit(labCase, 0, visit, STANDARD_CATALOG);
  return { visit, predicted: run.status === "read" ? run.record.predicted : undefined };
}

const TARGET = "203.0.113.10";

describe("the visits of the simulated world", () => {
  it("give the facts of a healthy path through the real readers of netdiag", async () => {
    const { visit, predicted } = await visitAndRead(simCase(HEALTHY));
    expect(visit.status === "visited" && visit.problems).toEqual([]);
    const [echo] = values(visit, "icmp.echo", TARGET);
    expect(echo).toMatchObject({ outcome: "reply", sent: SIM_PING_COUNT, received: SIM_PING_COUNT });
    for (const rtt of echo!["rttMs"] as number[]) expect(rtt).toBeGreaterThanOrEqual(baseRtt("target", "wired") - 0.5);
    expect(values(visit, "tls.handshake", TARGET)[0]).toMatchObject({ outcome: "ok", certificate: { trust: "public" } });
    expect(values(visit, "http.response", TARGET)[0]).toMatchObject({ outcome: "response", status: 200 });
    expect(values(visit, "path.mtu")).toEqual([]);
    expect(predicted).toBe(NO_FAULT);
  });

  it("give the same facts for the same seed", async () => {
    const labCase = simCase(fault("path/loss", { place: "remote", direction: "both", share: 0.2 }), "wifi");
    expect(JSON.stringify(await visitSim(labCase))).toBe(JSON.stringify(await visitSim(labCase)));
  });

  it("give the errors of Linux for an interface that is down, and a timeout for a link with no carrier", async () => {
    const admin = await visitSim(simCase(fault("link/down", { place: "host" })));
    expect(values(admin, "link.state")[0]).toMatchObject({ state: "down", interfaces: [] });
    // c-ares gives ECONNREFUSED when it cannot send the query to a server.
    expect(values(admin, "dns.answer").map((each) => each["code"])).toEqual(["ECONNREFUSED", "ECONNREFUSED", "ECONNREFUSED", "ECONNREFUSED"]);
    expect(values(admin, "icmp.echo")[0]).toMatchObject({ outcome: "unreachable", detail: "Network is unreachable" });
    const carrier = await visitSim(simCase(fault("link/down", { place: "link" })));
    expect(new Set(values(carrier, "dns.answer").map((each) => each["outcome"]))).toEqual(new Set(["timeout"]));
  });

  it("send each DNS query again after a loss, as c-ares does, and keep the time limit of the query", async () => {
    const each = tryTimeoutOf(DNS_TIMEOUT_MS, DNS_TRIES);
    const healthy = values(await visitSim(simCase(HEALTHY)), "dns.answer");
    expect(healthy.every((answer) => answer["tries"] === DNS_TRIES && Number(answer["ms"]) < each)).toBe(true);
    const down = values(await visitSim(simCase(fault("dns/down", { place: "resolver" }))), "dns.answer");
    expect(down.map((answer) => [answer["outcome"], answer["ms"]])).toEqual(down.map(() => ["timeout", DNS_TRIES * each]));
    expect(DNS_TRIES * each).toBeLessThanOrEqual(DNS_TIMEOUT_MS);
  });

  it("find an MTU black hole with the search of netdiag, after the TLS handshake times out", async () => {
    const term = faults(fault("path/size", { place: "transit", family: "ipv4", mtu: 1200 }), fault("path/filter", { place: "gateway", kind: "icmp-too-big", family: "ipv4" }));
    expect(termClasses(term)).toEqual(["path.mtu"]);
    const visit = await visitSim(simCase(term));
    expect(values(visit, "tls.handshake", TARGET)[0]).toMatchObject({ outcome: "timeout" });
    expect(values(visit, "path.mtu", TARGET)[0]).toMatchObject({ outcome: "measured", mtu: 1200, stop: "silent" });
  });

  it("give the answer of each part: a weak radio, a closed port, a missing name and a broken chain", async () => {
    const weak = await visitSim(simCase(fault("wifi/loss", { place: "link", kind: "all", signal: "weak", share: 0.1 }), "wifi"));
    const radio = values(weak, "wifi.link")[0]!;
    expect(radio["signalDbm"]).toBeLessThan(-75);
    expect(radio["txMbps"]).toBe(29.3);
    const closed = await visitSim(simCase(fault("tcp/missing", { place: "server" })));
    expect(values(closed, "tcp.connect", TARGET)[0]).toMatchObject({ outcome: "refused" });
    const missing = await visitSim(simCase(fault("dns/missing", { place: "authority" })));
    expect(values(missing, "dns.answer").filter((each) => each["name"] === "www.shop-lab.net").map((each) => each["outcome"])).toEqual(["nxdomain", "nxdomain"]);
    const chain = await visitSim(simCase(fault("tls/wrong", { place: "server", kind: "chain" })));
    expect(values(chain, "tls.handshake", TARGET)[0]).toMatchObject({ outcome: "cert-error", certificate: { trust: "none" } });
  });
});

describe("the loss model of the catalog", () => {
  it("has the tries of the probes of the simulated world", () => {
    const tries = (feature: string): number | undefined => LOSS_STEPS.find((step) => step.feature === feature)?.tries;
    const syns = SYN_TRIES_MS.filter((at) => at < DEFAULT_TIMEOUT_MS);
    // A TLS or HTTP exchange sends again after an RTO from MIN_RTO_MS that doubles, in the time after the last SYN.
    const rest = DEFAULT_TIMEOUT_MS - Math.max(...syns);
    const sends = Array.from({ length: 10 }, (_, index) => MIN_RTO_MS * (2 ** index - 1)).filter((at) => at < rest);
    expect(tries("dns.answer")).toBe(DNS_TRIES);
    expect(tries("tcp.connect")).toBe(syns.length);
    expect(tries("tls.handshake")).toBe(sends.length);
    expect(tries("http.status")).toBe(sends.length);
  });
});

describe("the plan of the simulated world", () => {
  const plan = simCases(1);

  it("has the cases of each class of the catalog that a fault gives, and of none", () => {
    expect(SIM_CLASSES).toContain(NO_FAULT);
    expect(SIM_CLASSES).not.toContain("unknown");
    expect(SIM_CLASSES).toHaveLength(22);
    expect(plan).toHaveLength(SIM_CLASSES.length * CASES_PER_CLASS);
    expect(new Set(plan.map((each) => each.id)).size).toBe(plan.length);
  });

  it("gives each case a term with its class as the only class, and the traits that the term needs", () => {
    for (const each of plan) {
      expect(termClasses(each.term), each.id).toEqual([each.truth]);
      const needs = termNeeds(each.term);
      if (needs.includes("wifi")) expect(each.medium, each.id).toBe("wifi");
      if (needs.includes("ipv6")) expect(each.ipv6, each.id).toBe(true);
    }
  });

  it("keeps each banded param in its band", () => {
    for (const each of plan) {
      for (const choice of faultsOf(each.term)) {
        const params = faultValues(choice);
        for (const band of SIM_BANDS.filter((one) => one.option === choice.option)) {
          const value = Number(params[band.param]);
          expect(value, `${each.id} ${band.param}`).toBeGreaterThanOrEqual(band.min);
          expect(value, `${each.id} ${band.param}`).toBeLessThanOrEqual(band.max);
        }
      }
    }
  });

  it("is the same for the same seed, and different for a different seed", () => {
    expect(simCases(1)).toEqual(plan);
    expect(simCases(2)).not.toEqual(plan);
  });
});

describe("the draws of the faults", () => {
  const network = (term: FaultTerm): SimNetwork => new SimNetwork({ term, medium: "wired", ipv6: false }, random("sim-test:silent"));
  const refuse = (share: number): FaultTerm => fault("http/refuse", { place: "server", kind: "error", share });

  it("give each fault with a share that passed each of its draws, and never a fault with no draw", () => {
    const rare = network(refuse(0.001));
    expect(rare.silent()).toEqual([]);
    expect(rare.serverStatus("target")).toBe(200);
    expect(rare.silent().map((each) => each.option)).toEqual(["http/refuse"]);
    const sure = network(refuse(1));
    expect(sure.serverStatus("target")).toBe(503);
    expect(sure.silent()).toEqual([]);
    expect(network(fault("tcp/missing", { place: "server" })).silent()).toEqual([]);
  });

  it("count a weak signal as an act of its fault", () => {
    const weak = network(fault("wifi/loss", { place: "link", kind: "all", signal: "weak", share: 0.1 }));
    expect(weak.signalDbm()).toBeLessThanOrEqual(-76);
    expect(weak.silent()).toEqual([]);
  });

  it("give a visit again when a fault passed each of its draws", async () => {
    // In the plan of the seed 2, the first two visits of this case got a status 200.
    const labCase = simCases(2).find((each) => each.id === "server.error#11")!;
    const result = await simVisit(labCase);
    expect([result.visits, result.silent]).toEqual([3, []]);
    expect(readVisit(labCase, 0, result.visit, STANDARD_CATALOG)).toMatchObject({ status: "read", record: { predicted: "server.error" } });
  });

  it("give no read when a fault is silent in each of SIM_VISITS visits", async () => {
    const labCase = simCase(refuse(0.001));
    const result = await simVisit(labCase);
    expect(result.visits).toBe(SIM_VISITS);
    expect(result.silent.map((each) => each.option)).toEqual(["http/refuse"]);
    expect(readVisit(labCase, 0, result.visit, STANDARD_CATALOG)).toMatchObject({ status: "no-read", reason: "The faults http/refuse at server passed each of their draws in 10 visits." });
  });
});

describe("the bars of the simulated world", () => {
  it("are in bars/sim.json. To change them, start pnpm --filter @netdiag/lab sim --write, and tell the reason", async () => {
    const runs = await simRuns();
    expect(runs.problems).toEqual([]);
    expect(runs.bars.tag).toBe("ok");
    if (runs.bars.tag !== "ok") return;
    expect(barsText(runs.bars.value)).toBe(readFileSync(new URL("sim.json", BARS_FOLDER), "utf8"));
    // A change of the world that makes the faults silent more often changes this count. Tell the reason in the PR.
    expect(silentVisits(runs.outcomes)).toBe(20);
    const labels = new Set(placeHits(runs.outcomes).map((each) => each.label));
    for (const label of SIM_CLASSES.filter((each) => each !== NO_FAULT)) expect(labels.has(label), label).toBe(true);
  }, 180_000);
});
