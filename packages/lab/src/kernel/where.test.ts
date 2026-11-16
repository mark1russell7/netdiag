import type { Fact, PathReport, ReportHop } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { visitRounds, type LabRound, type Visit } from "../run.ts";
import { KERNEL_PORT, TOWARD_CLIENT, faultPlan } from "./cases.ts";
import { WHERE_CASES, WHERE_CYCLES, partText, readWhere, samePart, whereMarkdown, whereScores, type WhereCase, type WhereRun } from "./where.ts";
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

  it("put netem on the router toward the client, and remove it", () => {
    expect(faultPlan(FIRST.fault, ADDRESSES)).toEqual({
      apply: [{ op: "netem", spec: "loss 30%", at: TOWARD_CLIENT }],
      lift: [{ op: "netem", spec: null, at: TOWARD_CLIENT }, { op: "forget" }],
    });
  });

  it("give the agent the address of the target, no reference host, no ping and 60 cycles of mtr", () => {
    expect(wherePlan(ADDRESSES)).toEqual({ ...kernelPlan(ADDRESSES), target: TARGET, references: [], pingCount: 0, mtrCycles: 60 });
    expect(wherePlan(ADDRESSES).port).toBe(KERNEL_PORT);
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
