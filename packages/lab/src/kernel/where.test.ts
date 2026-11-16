import { PATH_ORIGIN, PATH_OWNER, labBars, labGate, lookupGrants, lossOrigins, type Fact, type PathReport, type ReportHop, type VisitStep } from "@mark1russell7/netdiag";
import { readCheckReport } from "@mark1russell7/netdiag-cli/report";
import { wilson } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { runScore } from "../bars.ts";
import { visitRounds, type LabRound, type Visit } from "../run.ts";
import { SAMPLES_FORMAT, readSamples } from "../samples.ts";
import { KERNEL_PORT, TOWARD_CLIENT, faultPlan } from "./cases.ts";
import { LOOKUP_REASON, visitInputOf } from "./protocol.ts";
import {
  WHERE_CASES,
  WHERE_CATALOG,
  WHERE_CYCLES,
  checkPlanOf,
  partText,
  readWhere,
  samePart,
  whereMarkdown,
  whereRecalls,
  whereSample,
  whereScores,
  type WhereCase,
  type WhereRun,
} from "./where.ts";
import { kernelPlan, wherePlan } from "./world.ts";

// The where cases with fake visits: no world starts. The reports have the counts of mtr, and lossStart of netdiag reads them.

const GATEWAY = "172.21.0.2";
const TARGET = "172.22.0.3";
const ADDRESSES = { target: TARGET, reference: "172.22.0.4", resolver: "172.22.0.5", gateway: GATEWAY };

const byId = (id: string): WhereCase => {
  const found = WHERE_CASES.find((labCase) => labCase.id === id);
  if (found === undefined) throw new Error(`No where case ${id}.`);
  return found;
};
const LAST = byId("loss.last-link");
const FIRST = byId("loss.first-link");
const NONE = byId("none");

/** A hop with `lost` of `sent` probes lost. A hop with an address of `undefined` gave no answer. */
function hop(ttl: number, address: string | undefined, lost: number, sent = WHERE_CYCLES): ReportHop {
  return address === undefined ? { ttl, sent, received: 0 } : { ttl, address, sent, received: sent - lost };
}

function reportFact(id: string, hops: readonly ReportHop[], outcome: PathReport["outcome"] = "reached"): Fact {
  const value: PathReport = { address: TARGET, outcome, cycles: WHERE_CYCLES, hops };
  return { id, kind: "path.report", layer: "path", subject: { host: TARGET, kind: "ipv4" }, time: { start: 0, end: 1 }, source: { probe: "mtr", version: "1" }, value };
}

const visited = (facts: readonly Fact[], problems: readonly string[] = []): Visit => ({
  status: "visited",
  facts,
  read: { primary: (fact) => fact.id !== "reference", gateway: GATEWAY },
  problems,
});

const read = (labCase: WhereCase, visit: Visit): WhereRun => readWhere(labCase, 0, visit);

describe("the where cases", () => {
  it("have different ids, a fault on each link of the path, and a control", () => {
    expect(new Set(WHERE_CASES.map((labCase) => labCase.id)).size).toBe(WHERE_CASES.length);
    expect(LAST.fault).toEqual({ kind: "netem", at: "target", spec: "loss 30%" });
    expect(FIRST.fault).toEqual({ kind: "netem", at: TOWARD_CLIENT, spec: "loss 30%" });
    expect(NONE).toMatchObject({ fault: null, expect: null });
  });

  it("give the truth path.loss to each loss case, and none to the control", () => {
    expect(WHERE_CASES.map((labCase) => [labCase.id, labCase.truth])).toEqual([
      ["loss.last-link", "path.loss"],
      ["loss.first-link", "path.loss"],
      ["none", "none"],
    ]);
  });

  it("put netem on the router toward the client, and remove it", () => {
    expect(faultPlan(FIRST.fault, ADDRESSES)).toEqual({
      apply: [{ op: "netem", spec: "loss 30%", at: TOWARD_CLIENT }],
      lift: [{ op: "netem", spec: null, at: TOWARD_CLIENT }, { op: "forget" }],
    });
  });

  it("give the agent the address of the target, no reference host, no ping, 60 cycles of mtr and the lookups", () => {
    expect(wherePlan(ADDRESSES)).toEqual({ ...kernelPlan(ADDRESSES), target: TARGET, references: [], pingCount: 0, mtrCycles: 60, owners: true });
    expect(wherePlan(ADDRESSES).port).toBe(KERNEL_PORT);
    expect(kernelPlan(ADDRESSES).owners).toBe(false);
  });
});

describe("readWhere", () => {
  it("hits the last link when the router has no loss and the target loses 30%", () => {
    // The destination lost 18 of 60: the Wilson low end is 0.199, and the p of the router (0 of 60) is (1 - 0.199)^60 = 1.7e-6.
    const run = read(LAST, visited([reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 18)])]));
    expect(run).toMatchObject({ status: "read", format: "netdiag.lab-where/1", case: "loss.last-link", round: 0, hit: true });
    expect(run.status === "read" && run.answer).toEqual({ after: "gateway", hops: ["target"] });
    expect(run.status === "read" && run.hops).toEqual([
      { ttl: 1, hop: "gateway", sent: 60, received: 60 },
      { ttl: 2, hop: "target", sent: 60, received: 42 },
    ]);
  });

  it("hits the first link when the router and the target lose the same part", () => {
    // The router lost 17 of 60 and the destination 18 of 60. The p of the router is 0.96.
    const run = read(FIRST, visited([reportFact("r", [hop(1, GATEWAY, 17), hop(2, TARGET, 18)])]));
    expect(run).toMatchObject({ status: "read", hit: true, answer: { after: null, hops: ["gateway", "target"] } });
  });

  it("misses when lossStart puts the start after the router of a loss on the first link", () => {
    // The router lost 3 of 60. Against the low end 0.199 of the destination, its p is 0.0011.
    const run = read(FIRST, visited([reportFact("r", [hop(1, GATEWAY, 3), hop(2, TARGET, 18)])]));
    expect(run).toMatchObject({ status: "read", hit: false, answer: { after: "gateway", hops: ["target"] } });
  });

  it("misses when too few probes of the target are lost to tell the start", () => {
    // The destination lost 4 of 60: the low end is 0.026, and the p of the router is 0.20.
    const run = read(LAST, visited([reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 4)])]));
    expect(run).toMatchObject({ status: "read", hit: false, answer: { after: null, hops: ["gateway", "target"] } });
  });

  it("hits the control with no loss, and misses a loss case with no loss", () => {
    const clean = visited([reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 0)])]);
    expect(read(NONE, clean)).toMatchObject({ status: "read", hit: true, answer: null });
    expect(read(LAST, clean)).toMatchObject({ status: "read", hit: false, answer: null });
  });

  it("names an address that is not the gateway or the target with its text, and a hop with no answer with null", () => {
    const run = read(LAST, visited([reportFact("r", [hop(1, "10.9.9.9", 0), hop(2, undefined, 0), hop(3, TARGET, 18)])]));
    expect(run).toMatchObject({ status: "read", hit: false, answer: { after: "10.9.9.9", hops: ["target"] } });
    expect(run.status === "read" && run.hops.map((one) => one.hop)).toEqual(["10.9.9.9", null, "target"]);
  });

  it("reads only the reports of the target", () => {
    const facts = [reportFact("reference", [hop(1, GATEWAY, 0), hop(2, TARGET, 30)]), reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 0)])];
    expect(read(NONE, visited(facts))).toMatchObject({ status: "read", hit: true });
  });

  it("counts each fact as a fact of the target when the visit has no function primary", () => {
    const visit: Visit = { status: "visited", facts: [reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 18)])], read: { gateway: GATEWAY }, problems: [] };
    expect(read(LAST, visit)).toMatchObject({ status: "read", hit: true });
  });

  it("gives no read with no report, two reports, a report that did not reach the target, a problem or no visit", () => {
    const reason = (run: WhereRun) => (run.status === "no-read" ? run.reason : "read");
    expect(reason(read(LAST, visited([])))).toBe("The visit has 0 reports of mtr of the target, not 1.");
    const two = [reportFact("a", [hop(1, TARGET, 18)]), reportFact("b", [hop(1, TARGET, 18)])];
    expect(reason(read(LAST, visited(two)))).toBe("The visit has 2 reports of mtr of the target, not 1.");
    expect(reason(read(LAST, visited([reportFact("r", [hop(1, GATEWAY, 0), hop(2, undefined, 0)], "stopped")])))).toBe(
      'The report of mtr did not reach the target. Its outcome is "stopped".',
    );
    expect(reason(read(LAST, visited([reportFact("r", [hop(1, TARGET, 18)])], ["The agent did not end: time-out."])))).toBe("The agent did not end: time-out.");
    expect(reason(read(LAST, { status: "no-visit", reason: "The round did not start: no docker" }))).toBe("The round did not start: no docker");
  });
});

describe("samePart and partText", () => {
  it("compare the hop before the start and each hop after it", () => {
    expect(samePart(null, null)).toBe(true);
    expect(samePart(null, { after: null, hops: ["target"] })).toBe(false);
    expect(samePart({ after: "gateway", hops: ["target"] }, { after: "gateway", hops: ["target"] })).toBe(true);
    expect(samePart({ after: "gateway", hops: ["target"] }, { after: null, hops: ["target"] })).toBe(false);
    expect(samePart({ after: null, hops: ["gateway", "target"] }, { after: null, hops: ["target"] })).toBe(false);
  });

  it("give the text of a part", () => {
    expect(partText(null)).toBe("no loss");
    expect(partText({ after: "gateway", hops: ["target"] })).toBe("after `gateway`: `target`");
    expect(partText({ after: null, hops: ["gateway", "target"] })).toBe("from the first link: `gateway`, `target`");
  });
});

describe("the score of the where cases", () => {
  const runs: WhereRun[] = [
    read(LAST, visited([reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 18)])])),
    { ...read(LAST, visited([reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 4)])])), round: 1 },
    read(FIRST, { status: "no-visit", reason: "The visit did not end: no agent" }),
    read(NONE, visited([reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 0)])])),
  ];

  it("counts the reads, the hits and the runs with no read of each case, in the order of the cases", () => {
    const scores = whereScores(WHERE_CASES, runs);
    expect(scores.map(({ case: id, reads, hits, noReads }) => ({ id, reads, hits, noReads }))).toEqual([
      { id: "loss.last-link", reads: 2, hits: 1, noReads: 0 },
      { id: "loss.first-link", reads: 0, hits: 0, noReads: 1 },
      { id: "none", reads: 1, hits: 1, noReads: 0 },
    ]);
    // With no read, the Wilson interval is 0 to 1.
    expect(scores[1]?.rate).toMatchObject({ low: 0, high: 1 });
  });

  it("gives a table, the misses and the runs with no read as Markdown", () => {
    const markdown = whereMarkdown(whereScores(WHERE_CASES, runs), runs, 2);
    expect(markdown).toContain("3 cases, 2 rounds, 60 cycles of mtr: 3 reads and 1 runs with no read.");
    expect(markdown).toContain("| `loss.last-link` | 2 | 1 | 50% |");
    expect(markdown).toContain("| `loss.first-link` | 0 | 0 | – | 0% to 100% | 1 |");
    expect(markdown).toContain("- `loss.last-link#1`: the loss starts from the first link: `gateway`, `target`. The case expects after `gateway`: `target`.");
    expect(markdown).toContain("- `loss.first-link#0`: The visit did not end: no agent");
    expect(markdown).not.toContain("### The gate");
  });

  it("gives the recalls of the cases, and labGate of netdiag holds them", () => {
    const recalls = whereRecalls(whereScores(WHERE_CASES, runs));
    expect(recalls.catalog).toBe(WHERE_CATALOG);
    expect(recalls.classes.map(({ label, support }) => ({ label, support }))).toEqual([
      { label: "loss.last-link", support: 2 },
      { label: "loss.first-link", support: 0 },
      { label: "none", support: 1 },
    ]);
    expect(recalls.classes[0]?.recallInterval).toEqual(wilson(1, 2));
    // The low ends are 0.095 for 1 of 2 and 0.207 for 1 of 1. A case with no read gets no-read, so the gate fails.
    const gate = labGate(recalls, { "loss.last-link": 0.05, "loss.first-link": 0.5, none: 0.1 });
    expect(gate).toMatchObject({ tag: "ok", value: { pass: false } });
    expect(gate.tag === "ok" && gate.value.verdicts.map((verdict) => verdict.status)).toEqual(["pass", "no-read", "pass"]);
    if (gate.tag !== "ok") return;
    const markdown = whereMarkdown(whereScores(WHERE_CASES, runs), runs, 2, gate.value);
    expect(markdown).toContain("### The gate: fail");
    expect(markdown).toContain("| Case | Bar | Lower bound | Reads | Status |");
    expect(markdown).toContain("| `loss.first-link` | 50% | – | 0 | no-read |");
  });

  it("gives a score file that runScore of the bars reads, and refuses a run with no read", () => {
    const recalls = whereRecalls(whereScores(WHERE_CASES, runs));
    expect(runScore("where-1", { score: recalls, noReads: 1 })).toEqual({ tag: "err", error: "The run where-1 has 1 cases with no read." });
    expect(runScore("where-2", { score: recalls, noReads: 0 })).toEqual({ tag: "ok", value: recalls });
    // labBars gives no bar to a case with no read in each run. runScore refuses such runs before labBars reads them.
    const bars = labBars(Array.from({ length: 5 }, () => recalls));
    expect(bars.tag === "ok" && Object.keys(bars.value)).toEqual(["loss.last-link", "none"]);
  });
});

describe("visitRounds", () => {
  it("gives each visit to the reader, in the order of the round", async () => {
    const visits: Record<string, Visit> = { "loss.last-link": visited([reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 18)])]), none: visited([]) };
    const start = (): Promise<LabRound<WhereCase>> =>
      Promise.resolve({ visit: (labCase) => Promise.resolve(visits[labCase.id] ?? visited([])), close: () => Promise.resolve() });
    const runs = await visitRounds([LAST, NONE], 2, start, readWhere);
    expect(runs.map((run) => `${run.case}#${run.round} ${run.status}`)).toEqual(["loss.last-link#0 read", "none#0 no-read", "none#1 no-read", "loss.last-link#1 read"]);
  });
});

describe("the samples of the where cases", () => {
  const plan = wherePlan(ADDRESSES);
  const step = (fact: Fact): VisitStep => ({ kind: "fact", role: "target", host: TARGET, fact });
  const special = (id: string, kind: typeof PATH_OWNER.kind | typeof PATH_ORIGIN.kind, address: string): Fact => ({
    id,
    kind,
    layer: "path",
    subject: { host: address, kind: "ipv4" },
    time: { start: 1, end: 2 },
    source: { probe: kind === PATH_OWNER.kind ? "rdap.owner" : "dns.origin", version: "1" },
    value: { address, outcome: "special", class: "private" },
  });
  const facts = [
    reportFact("r", [hop(1, GATEWAY, 0), hop(2, TARGET, 18)]),
    special("o1", PATH_OWNER.kind, GATEWAY),
    special("o2", PATH_OWNER.kind, TARGET),
    special("g1", PATH_ORIGIN.kind, GATEWAY),
    special("g2", PATH_ORIGIN.kind, TARGET),
  ];
  const visit: Visit = { status: "visited", facts, read: { gateway: GATEWAY }, problems: [], steps: facts.map(step) };

  it("give the plan of the check from the plan of the agent, with the grants of the agent", () => {
    const check = checkPlanOf(plan);
    expect(check).toMatchObject({ target: { host: TARGET, kind: "ipv4", port: KERNEL_PORT }, scheme: "https", path: "/", pingCount: 0, mtrCycles: 60, owners: true, mtu: "auto" });
    expect(check.visit).toEqual(visitInputOf(plan));
    expect(check.visit.grants.slice(-lookupGrants(LOOKUP_REASON).length)).toEqual(lookupGrants(LOOKUP_REASON));
  });

  it("give the report of a read with its case, its truth and the start of the loss", () => {
    const run = read(LAST, visit);
    const sample = whereSample(LAST, run, plan, visit);
    expect(sample).toMatchObject({ id: "loss.last-link", truth: "path.loss", summary: LAST.summary });
    if (sample === undefined) return;
    expect(readCheckReport(JSON.parse(JSON.stringify(sample.report)))).toMatchObject({ tag: "ok" });
    expect(sample.report.target).toBe(`${TARGET}:443`);
    expect(sample.report.grants).toEqual(visitInputOf(plan).grants);
    expect(sample.report.facts.map((item) => `${item.role} ${item.host} ${item.fact.id}`)).toEqual(facts.map((fact) => `target ${TARGET} ${fact.id}`));
    const origins = lossOrigins(sample.report.facts.map((item) => item.fact));
    expect(origins.map((origin) => origin.networks.map((network) => [network.owner?.outcome, network.origin?.outcome]))).toEqual([[["special", "special"]]]);
    const file = { format: SAMPLES_FORMAT, commit: "0123abc", samples: [sample] };
    expect(readSamples(JSON.parse(JSON.stringify(file)))).toMatchObject({ tag: "ok" });
  });

  it("give no sample for a run with no read, or for a visit with no steps", () => {
    expect(whereSample(LAST, read(LAST, visited(facts, ["The agent did not end."])), plan, visit)).toBeUndefined();
    expect(whereSample(LAST, read(LAST, visited(facts)), plan, visited(facts))).toBeUndefined();
    expect(whereSample(LAST, read(LAST, { status: "no-visit", reason: "no docker" }), plan, { status: "no-visit", reason: "no docker" })).toBeUndefined();
  });
});
