import { readFileSync } from "node:fs";
import { DEFAULT_TIMEOUT_MS, DNS_TRIES, LOSS_STEPS, readEvidence, STANDARD_CATALOG, STANDARD_CONCENTRATIONS, STANDARD_POLICY, tryTimeoutOf, type Fact } from "@mark1russell7/netdiag";
import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { fault, faults, faultsOf, faultValues, GRAMMAR_ENGINE, NO_FAULT, termClasses, termNeeds, type FaultTerm } from "../grammar.ts";
import { REFERENCE_NAME, TARGET_NAME } from "../cases.ts";
import { DNS_TIMEOUT_MS, readVisit, type Visit } from "../run.ts";
import { BARS_FOLDER } from "../worlds.ts";
import { CASES_PER_CLASS, SIM_BANDS, SIM_CLASSES, SIM_HISTORY_SHARES, SIM_PING_COUNT, simCases, type SimCase, type SimHistory } from "./cases.ts";
import { gapOf, SIM_GAPS, twinCase } from "./gaps.ts";
import { baseRtt, SimNetwork, type Medium } from "./network.ts";
import { fitPolicy, policyText, SIM_FIT_SEEDS } from "./policy.ts";
import { MIN_RTO_MS, SYN_TRIES_MS } from "./probes.ts";
import { concentrationCatalog, concentrationRecord, concentrationsSource, repeatConcentrations, STANDARD_CONCENTRATIONS_FILE } from "./repeats.ts";
import {
  actionCalibration,
  actionLimits,
  actionRates,
  actionsText,
  barsText,
  calibrationText,
  closedGaps,
  falseActionProblems,
  gapSizeProblems,
  gapsText,
  gateCalibration,
  limitProblems,
  placeHits,
  SIM_HARM_LIMIT,
  silentVisits,
  simRuns,
  withCatalog,
  topForecast,
  type ActionLimits,
  type SimActionRate,
  type SimCalibration,
  type SimOutcome,
} from "./report.ts";
import { caseHistory, SIM_HASHER, SIM_VISITS, simVisit, visitSim } from "./world.ts";

/** The term with no fault. */
const HEALTHY: FaultTerm = { space: GRAMMAR_ENGINE, stages: {} };

/** This function gives a case of the simulated world for one term. */
function simCase(term: FaultTerm, medium: Medium = "wired", ipv6 = false, history: SimHistory = "unknown"): SimCase {
  return { id: "test", truth: termClasses(term)[0] ?? NO_FAULT, signs: [], term, medium, ipv6, history, seed: "sim-test:1" };
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
    // A private root that the client trusts by design is no fault: the handshake passes, and the trust is private.
    const term = fault("tls/wrong", { place: "server", kind: "private" });
    expect(termClasses(term)).toEqual([NO_FAULT]);
    const own = await visitSim(simCase(term));
    expect(values(own, "tls.handshake", TARGET)[0]).toMatchObject({ outcome: "ok", certificate: { trust: "private", issuer: "CN=Sim Private Root" } });
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
  it("have the concentrations of the repeats and the policy of the actions that the held-out seed sets give, in STANDARD_CONCENTRATIONS, bars/policy.json and STANDARD_POLICY", async () => {
    const runs = await simRuns(SIM_FIT_SEEDS);
    expect(runs.problems).toEqual([]);
    const concentrations = repeatConcentrations(runs.outcomes);
    expect(concentrationRecord(concentrations)).toEqual(STANDARD_CONCENTRATIONS);
    expect(concentrationsSource(concentrations)).toBe(readFileSync(STANDARD_CONCENTRATIONS_FILE, "utf8"));
    const fit = fitPolicy(withCatalog(runs.outcomes, concentrationCatalog(concentrations)));
    expect(fit.problems).toEqual([]);
    expect(policyText(fit)).toBe(readFileSync(new URL("policy.json", BARS_FOLDER), "utf8"));
    expect(STANDARD_POLICY).toEqual(fit.policy);
  }, 600_000);

  it("are in bars/sim.json. To change them, start pnpm --filter @netdiag/lab sim --write, and tell the reason", async () => {
    const runs = await simRuns();
    expect(runs.problems).toEqual([]);
    expect(runs.bars.tag).toBe("ok");
    if (runs.bars.tag !== "ok") return;
    expect(barsText(runs.bars.value)).toBe(readFileSync(new URL("sim.json", BARS_FOLDER), "utf8"));
    // Each known gap has its own bars, its cause and its end in bars/sim-gaps.json.
    expect(gapsText(runs)).toBe(readFileSync(new URL("sim-gaps.json", BARS_FOLDER), "utf8"));
    // A change of the world that makes the faults silent more often changes this count. Tell the reason in the PR.
    expect(silentVisits(runs.outcomes)).toBe(20);
    const labels = new Set(placeHits(runs.outcomes).map((each) => each.label));
    for (const label of SIM_CLASSES.filter((each) => each !== NO_FAULT)) expect(labels.has(label), label).toBe(true);
    // The actions with STANDARD_POLICY: the file bars/actions.json has the rates, and no class takes a harmful action too often.
    expect(actionsText(runs.outcomes)).toBe(readFileSync(new URL("actions.json", BARS_FOLDER), "utf8"));
    const rates = actionRates(runs.outcomes);
    for (const label of SIM_CLASSES) expect(rates[label]?.cases, label).toBeGreaterThan(0);
    for (const [label, rate] of Object.entries(rates)) expect(rate.harmHigh, label).toBeLessThanOrEqual(SIM_HARM_LIMIT);
    // The limits of the correct low end and of the calibration errors come from five seed sets. Change them only with --limits and a reason in the PR.
    expect(calibrationText(runs.outcomes)).toBe(readFileSync(new URL("calibration.json", BARS_FOLDER), "utf8"));
    const limits = JSON.parse(readFileSync(new URL("action-limits.json", BARS_FOLDER), "utf8")) as ActionLimits;
    expect(limitProblems(rates, gateCalibration(runs.outcomes), limits)).toEqual([]);
    expect(falseActionProblems(runs.outcomes)).toEqual([]);
    // The size of a gap can only fall. A wider gap fails here, also after --write.
    expect(gapSizeProblems(runs.outcomes, JSON.parse(readFileSync(new URL("sim-gaps.json", BARS_FOLDER), "utf8")) as { id: string; cases: number }[])).toEqual([]);
  }, 180_000);
});

describe("the known gaps of the simulated world", () => {
  const privateRoot = fault("tls/wrong", { place: "server", kind: "private" });
  const brokenChain = fault("tls/wrong", { place: "server", kind: "chain" });

  it("hold the healthy cases with a private root and no history or a rotated history, and no case of another class or of another kind", () => {
    expect(gapOf(simCase(privateRoot))?.id).toBe("none/private-root");
    expect(gapOf(simCase(privateRoot, "wired", false, "rotated"))?.id).toBe("none/private-root");
    expect(gapOf(simCase(privateRoot, "wired", false, "known"))).toBeUndefined();
    expect(gapOf({ truth: NO_FAULT, term: privateRoot })?.id).toBe("none/private-root");
    expect(gapOf(simCase(brokenChain))).toBeUndefined();
    expect(gapOf(simCase(HEALTHY))).toBeUndefined();
    expect(gapOf({ truth: "tls.proxy", term: privateRoot })).toBeUndefined();
  });

  it("have the facts of their twins: each case of a gap and its twin case give the same evidence", async () => {
    const evidenceOf = async (labCase: SimCase): Promise<string[]> => {
      const visit = await visitSim(labCase);
      if (visit.status !== "visited") throw new Error(`The case ${labCase.id} has no visit.`);
      return readEvidence(visit.facts, visit.read).evidence.map((each) => `${each.feature}=${each.value}@${each.primary ? 1 : 0}`).sort();
    };
    for (const gap of SIM_GAPS) {
      const mine = simCases(1).filter((each) => gapOf(each) === gap);
      expect(mine.length, gap.id).toBeGreaterThan(0);
      for (const each of mine) {
        const twin = twinCase(each, gap);
        expect(termClasses(twin.term), each.id).toEqual([gap.twin.label]);
        expect(await evidenceOf(twin), each.id).toEqual(await evidenceOf(each));
      }
    }
  }, 60_000);

  it("give a problem when a gap has more cases than its count, or no count", () => {
    const gap = SIM_GAPS[0];
    if (gap === undefined) throw new Error("SIM_GAPS has no gap.");
    const outcomes = [simCase(privateRoot), simCase(privateRoot, "wired", false, "rotated"), simCase(HEALTHY)].map((each) => ({ case: each }) as SimOutcome);
    expect(gapSizeProblems(outcomes, [{ id: gap.id, cases: 2 }])).toEqual([]);
    expect(gapSizeProblems(outcomes, [{ id: gap.id, cases: 1 }])).toEqual([`The gap ${gap.id} has 2 cases of the gate seeds, over its count 1 in bars/sim-gaps.json. The size of a gap can only fall.`]);
    expect(gapSizeProblems(outcomes, [])).toEqual([`The gap ${gap.id} is new, with 2 cases. Write its count in bars/sim-gaps.json by hand, and tell the reason in the PR.`]);
    expect(gapSizeProblems(outcomes, undefined)).toEqual([`The file bars/sim-gaps.json has no counts, thus the gate cannot read the size of the gap ${gap.id} (2 cases).`]);
    expect(gapSizeProblems([], undefined)).toEqual([]);
  });

  it("give a problem when the bar of a gap gets to the bar of its class", () => {
    const gap = SIM_GAPS[0];
    if (gap === undefined) throw new Error("SIM_GAPS has no gap.");
    const runsOf = (bar: number) => [{ gap, scores: [], bars: { tag: "ok" as const, value: { [gap.label]: bar } } }];
    const bars = { tag: "ok" as const, value: { [gap.label]: 0.95 } };
    expect(closedGaps(bars, runsOf(0))).toEqual([]);
    expect(closedGaps(bars, runsOf(0.95))).toEqual([`The gap ${gap.id} is closed: its bar 0.95 is at the bar 0.95 of its class or over it. Remove it from SIM_GAPS.`]);
  });
});

describe("the history of the simulated world", () => {
  const privateRoot = fault("tls/wrong", { place: "server", kind: "private" });
  const proxy = fault("tls/intercept", { place: "remote" });

  /** This function gives the values of a feature in the evidence of a visit of a case. */
  async function featureValues(labCase: SimCase, feature: string): Promise<string[]> {
    const visit = await visitSim(labCase);
    if (visit.status !== "visited") throw new Error("The case has no visit.");
    return readEvidence(visit.facts, visit.read).evidence.filter((each) => each.feature === feature).map((each) => each.value);
  }

  it("draws each history in each class, near its share, from a source that does not change the other draws", () => {
    const cases = simCases(1, 40);
    for (const label of SIM_CLASSES) {
      const mine = cases.filter((each) => each.truth === label);
      expect(new Set(mine.map((each) => each.history)).has("unknown"), label).toBe(true);
      expect(new Set(mine.map((each) => each.history)).has("known"), label).toBe(true);
    }
    for (const history of ["unknown", "known", "rotated"] as const) {
      const share = cases.filter((each) => each.history === history).length / cases.length;
      expect(Math.abs(share - SIM_HISTORY_SHARES[history]), history).toBeLessThan(0.05);
    }
    const strip = (each: SimCase) => ({ ...each, history: undefined });
    expect(simCases(1, 40).map(strip)).toEqual(cases.map(strip));
  });

  it("gives no history to a case with the history unknown, and the hashes of the roots of a good check to a known case", async () => {
    expect((await caseHistory(simCase(HEALTHY))).size).toBe(0);
    const known = await caseHistory(simCase(proxy, "wired", false, "known"));
    expect([...known.keys()].sort()).toEqual([REFERENCE_NAME, TARGET_NAME].sort());
    for (const history of known.values()) expect(history).toEqual({ checked: "2026-11-16T00:00:00.000Z", key: SIM_HASHER.id, values: { "tls.root": [SIM_HASHER.hash("SIM-ROOT:public:0")] } });
    // The good check of a world keeps its parts that are no fault: a private root that the clients trust.
    const own = await caseHistory(simCase(privateRoot, "wired", false, "known"));
    expect([...own.values()].map((each) => each.values["tls.root"])).toContainEqual([SIM_HASHER.hash("SIM-ROOT:private:0")]);
    const rotated = await caseHistory(simCase(proxy, "wired", false, "rotated"));
    for (const history of rotated.values()) expect(history.values["tls.root"]).toEqual([SIM_HASHER.hash("SIM-ROOT:public:1")]);
  });

  it("reads the root as the same in a healthy case with a private root, and as changed under an interception or a short chain", async () => {
    const own = await featureValues(simCase(privateRoot, "wired", false, "known"), "tls.root");
    expect(own.length).toBeGreaterThan(0);
    expect(new Set(own)).toEqual(new Set(["same"]));
    expect(await featureValues(simCase(privateRoot, "wired", false, "rotated"), "tls.root")).toContain("changed");
    expect(await featureValues(simCase(proxy, "wired", false, "known"), "tls.root")).toContain("changed");
    expect(await featureValues(simCase(fault("tls/wrong", { place: "server", kind: "chain" }), "wired", false, "known"), "tls.root")).toContain("changed");
    expect(await featureValues(simCase(fault("tls/expire", { place: "server" }), "wired", false, "known"), "tls.root")).not.toContain("changed");
    expect(await featureValues(simCase(privateRoot), "tls.root")).toEqual([]);
  });
});

describe("the limits of the actions", () => {
  const rate = (correctLow: number, harmHigh: number): SimActionRate => ({ correctLow, harmHigh }) as SimActionRate;
  const calibration = (top: number, kinds: number, unsure = 0.05): SimCalibration => ({ cases: 1, top, kinds, unsureCases: 1, unsure, bins: [] });

  it("take the worst low end minus the spread, and the highest error plus the spread", () => {
    const limits = actionLimits("test", [[1], [2]], [{ a: rate(0.7, 0.02) }, { a: rate(0.65, 0.03) }], [calibration(0.01, 0.002), calibration(0.015, 0.003)]);
    expect(limits.limits).toEqual({ a: 0.6 });
    expect(limits.errorLimits).toEqual({ top: 0.02, kinds: 0.004, unsure: 0.05 });
    expect(limits.unsureCases).toEqual([1, 1]);
    expect(limitProblems({ a: rate(0.6, 0) }, calibration(0.02, 0.004), limits)).toEqual([]);
    expect(limitProblems({ a: rate(0.59, 0), b: rate(1, 0) }, calibration(0.021, 0.004, 0.0501), limits)).toEqual([
      "The top-label calibration error is 0.021, over its limit 0.02.",
      "The calibration error of the unsure cases is 0.0501, over its limit 0.05.",
      "The class a has the correct low end 0.59, under its limit 0.6.",
      "The class b has no limit of the correct low end in bars/action-limits.json.",
    ]);
  });

  it("count the correct actions outside the known gaps, and the harm and the false actions of each case", () => {
    const privateRoot = fault("tls/wrong", { place: "server", kind: "private" });
    const outcome = (term: FaultTerm, history: SimHistory, taken: "none" | "back-off" | "stop", harmful = false): SimOutcome => ({
      seed: 1,
      case: simCase(term, "wired", false, history),
      predicted: undefined,
      visits: 1,
      action: { taken, correct: "none", harmful, confidence: 1, probabilities: { [taken]: 1 } },
    });
    // 100 healthy cases outside the gaps take none. 4 cases of the gap take back-off, and 1 takes a harmful stop.
    const outside = Array.from({ length: 100 }, () => outcome(HEALTHY, "known", "none"));
    const inGap = [...Array.from({ length: 4 }, () => outcome(privateRoot, "unknown", "back-off")), outcome(privateRoot, "rotated", "stop", true)];
    const rate = actionRates([...outside, ...inGap])[NO_FAULT];
    expect(rate?.cases).toBe(105);
    expect(rate?.counted).toBe(100);
    expect(rate?.correct).toBe(100);
    expect(rate?.harmful).toBe(1);
    expect(rate?.harmHigh).toBeGreaterThan(1 / 105);
    // The false actions count the cases of the gap: 5 of 105 is over the limit.
    expect(falseActionProblems(outside)).toEqual([]);
    expect(falseActionProblems([...outside, ...inGap])).toHaveLength(1);
    expect(falseActionProblems([])).toEqual(["The runs have no healthy case with an action, thus the gate has no false actions to examine."]);
    // A class with each case in a gap has no correct actions to examine. The gate does not pass it.
    const onlyGap = actionRates(inGap);
    const limits = actionLimits("test", [[1]], [{ [NO_FAULT]: { correctLow: 0.5, harmHigh: 0 } as SimActionRate }], [{ cases: 1, top: 1, kinds: 1, unsureCases: 1, unsure: 1, bins: [] }]);
    expect(limitProblems(onlyGap, { cases: 1, top: 0, kinds: 0, unsureCases: 0, unsure: 0, bins: [] }, limits)).toEqual([
      `The class ${NO_FAULT} has no case outside the known gaps, thus the gate has no correct actions to examine.`,
    ]);
  });

  it("give no calibration and a problem for runs with no action", () => {
    expect(actionCalibration([])).toEqual({ cases: 0, top: 0, kinds: 0, unsureCases: 0, unsure: 0, bins: [] });
    const limits = actionLimits("test", [[1]], [{}], [calibration(0, 0)]);
    expect(limitProblems({}, actionCalibration([]), limits)).toEqual(["The runs have no case with an action, thus the gate has no calibration to examine."]);
  });

  it("take the probability of the chosen kind as the top-label forecast", () => {
    expect(topForecast({ confidence: 0.8, taken: "retry", correct: "retry" })).toEqual({ p: 0.8, hit: true });
    expect(topForecast({ confidence: 0, taken: "back-off", correct: "stop" })).toEqual({ p: 0, hit: false });
  });
});
