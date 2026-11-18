import { LAB_RECORD_FORMAT, STANDARD_CATALOG, type Fact } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { LAB_VISITS, readVisit, reportMarkdown, labReport, runRounds, visitAgain, type CaseBase, type CaseRun, type LabRound, type Visit } from "./index.ts";

// The case loop with fake rounds: no world starts, and no assertion examines a time.

const TARGET = "203.0.113.10";

function connect(id: string, outcome: "connected" | "refused"): Fact {
  return {
    id,
    kind: "tcp.connect",
    layer: "tcp",
    subject: { host: TARGET, kind: "ipv4", port: 443 },
    time: { start: 0, end: 1 },
    source: { probe: "tcp", version: "1" },
    value: { address: TARGET, port: 443, family: 4, outcome, ms: 1 },
  };
}

const REFUSED: CaseBase = { id: "port.closed", truth: "port.closed", signs: [{ feature: "tcp.connect", primary: true, value: "refused" }] };
const OPEN: CaseBase = { id: "none", truth: "none", signs: [{ feature: "tcp.connect", primary: true, value: "connected" }] };

const visited = (facts: readonly Fact[], problems: readonly string[] = []): Visit => ({ status: "visited", facts, read: { primary: () => true }, problems });

describe("readVisit", () => {
  it("gives a read with the evidence when the world shows each sign", () => {
    const run = readVisit(REFUSED, 2, visited([connect("f1", "refused")]), STANDARD_CATALOG);
    expect(run.status).toBe("read");
    expect(run.evidence).toContain("tcp.connect=refused@target");
    if (run.status === "read") expect(run.record).toMatchObject({ case: "port.closed#2", truth: "port.closed" });
    if (run.status === "read") expect("alike" in run.record).toBe(false);
  });

  it("gives no read for a missing sign, a problem of a probe and no visit", () => {
    const missing = readVisit(REFUSED, 0, visited([connect("f1", "connected")]), STANDARD_CATALOG);
    expect(missing).toMatchObject({ status: "no-read", reason: "The world did not show the signs tcp.connect=refused@target." });
    const problem = readVisit(REFUSED, 0, visited([connect("f1", "refused")], ["The ping of x did not end."]), STANDARD_CATALOG);
    expect(problem).toMatchObject({ status: "no-read", reason: "The ping of x did not end." });
    const none = readVisit(REFUSED, 0, { status: "no-visit", reason: "no world" }, STANDARD_CATALOG);
    expect(none).toEqual({ status: "no-read", case: "port.closed", round: 0, visits: 1, reason: "no world", evidence: [] });
  });
});

/** A fake round that gives the visit of each case from a table, and counts its closes. */
function fakeRounds(visits: Readonly<Record<string, Visit | Error>>) {
  const log: string[] = [];
  const start = (round: number): Promise<LabRound<CaseBase>> => {
    log.push(`start ${round}`);
    return Promise.resolve({
      visit: (labCase) => {
        log.push(`visit ${labCase.id}`);
        const visit = visits[labCase.id];
        return visit instanceof Error || visit === undefined ? Promise.reject(visit ?? new Error("no visit")) : Promise.resolve(visit);
      },
      close: () => {
        log.push(`close ${round}`);
        return Promise.resolve();
      },
    });
  };
  return { log, start };
}

describe("runRounds", () => {
  it("visits each case once in each round, in the order of the round, and closes each round", async () => {
    const { log, start } = fakeRounds({ "port.closed": visited([connect("f1", "refused")]), none: visited([connect("f2", "connected")]) });
    const seen: CaseRun[] = [];
    const runs = await runRounds([REFUSED, OPEN], 2, start, STANDARD_CATALOG, (run) => seen.push(run));
    expect(log).toEqual(["start 0", "visit port.closed", "visit none", "close 0", "start 1", "visit none", "visit port.closed", "close 1"]);
    expect(runs.map((run) => `${run.case}#${run.round} ${run.status}`)).toEqual(["port.closed#0 read", "none#0 read", "none#1 read", "port.closed#1 read"]);
    expect(seen).toEqual(runs);
  });

  it("gives no read for each case of a round that does not start, and for a visit that throws", async () => {
    const { log, start } = fakeRounds({ "port.closed": new Error("the agent stopped"), none: visited([connect("f2", "connected")]) });
    const failing = (round: number): Promise<LabRound<CaseBase>> => (round === 0 ? Promise.reject(new Error("no docker")) : start(round));
    const runs = await runRounds([REFUSED, OPEN], 2, failing, STANDARD_CATALOG);
    expect(runs.map((run) => (run.status === "no-read" ? `${run.case}#${run.round}: ${run.reason}` : `${run.case}#${run.round} read`))).toEqual([
      "port.closed#0: The round did not start: no docker",
      "none#0: The round did not start: no docker",
      "none#1 read",
      "port.closed#1: The visit did not end: the agent stopped",
    ]);
    expect(log.at(-1)).toBe("close 1");
  });

  it("visits a case again when its world does not show each sign, LAB_VISITS times or fewer", async () => {
    // The world of port.closed shows the sign at the second visit. The world of none never shows it.
    const log: string[] = [];
    const counts = new Map<string, number>();
    const start = (): Promise<LabRound<CaseBase>> =>
      Promise.resolve({
        visit: (labCase: CaseBase) => {
          const count = (counts.get(labCase.id) ?? 0) + 1;
          counts.set(labCase.id, count);
          log.push(`visit ${labCase.id}`);
          if (labCase.id === "port.closed") return Promise.resolve(visited([connect("f1", count >= 2 ? "refused" : "connected")]));
          return Promise.resolve(visited([connect("f2", "refused")]));
        },
        close: () => Promise.resolve(),
      });
    const runs = await runRounds([REFUSED, OPEN], 1, start, STANDARD_CATALOG);
    expect(log).toEqual(["visit port.closed", "visit port.closed", ...Array.from({ length: LAB_VISITS }, () => "visit none")]);
    expect(runs.map((run) => `${run.case} ${run.status} ${run.visits}`)).toEqual(["port.closed read 2", `none no-read ${LAB_VISITS}`]);
    const report = labReport(STANDARD_CATALOG, runs, 1, 2);
    expect(report.revisited).toBe(2);
    expect(reportMarkdown(report)).toContain("2 runs visited their case again");
  });

  it("does not visit a case again after a problem of a probe or a visit that throws", async () => {
    const { log, start } = fakeRounds({ "port.closed": visited([connect("f1", "connected")], ["The ping of x did not end."]), none: new Error("the agent stopped") });
    const runs = await runRounds([REFUSED, OPEN], 1, start, STANDARD_CATALOG);
    expect(log).toEqual(["start 0", "visit port.closed", "visit none", "close 0"]);
    expect(runs.map((run) => run.visits)).toEqual([1, 1]);
    expect(visitAgain(REFUSED, visited([connect("f1", "connected")]))).toBe(true);
    expect(visitAgain(REFUSED, { status: "no-visit", reason: "no world" })).toBe(false);
  });

  it("refuses a number of rounds that is not a positive integer", async () => {
    const { start } = fakeRounds({});
    await expect(runRounds([OPEN], 0, start, STANDARD_CATALOG)).rejects.toThrow(RangeError);
  });
});

describe("reportMarkdown", () => {
  it("has the title of the lab and lists the classes for later with no bar", () => {
    const report = labReport(STANDARD_CATALOG, [], 1, 2);
    const text = reportMarkdown(report, undefined, { title: "The kernel lab", later: [{ hypothesis: "ipv6.broken", reason: "No IPv6." }] });
    expect(text.startsWith("## The kernel lab\n")).toBe(true);
    expect(text).toContain("- `ipv6.broken`: No IPv6.");
    expect(reportMarkdown(report)).toMatch(/^## The loopback lab\n/);
  });

  it("shows a hit of a cause with the same facts apart from the wrong diagnoses", () => {
    const run = (id: string, order: readonly string[]): CaseRun => ({
      status: "read",
      case: "filter.drop",
      round: 0,
      visits: 1,
      evidence: [],
      record: {
        format: LAB_RECORD_FORMAT,
        case: id,
        catalog: STANDARD_CATALOG.version,
        truth: "filter.drop",
        predicted: order[0] ?? "",
        rank: order.indexOf("filter.drop") + 1,
        causes: order.map((cause, i) => ({ id: cause, probability: [0.48, 0.47, 0.05][i] ?? 0 })),
        alike: ["host.down"],
      },
    });
    const report = labReport(STANDARD_CATALOG, [run("filter.drop#0", ["host.down", "filter.drop", "filter.icmp"]), run("filter.drop#1", ["host.down", "filter.icmp", "filter.drop"])], 2, 1);
    expect(report.score?.correct).toBe(1);
    const text = reportMarkdown(report);
    expect(text).toContain("### Hits of causes with the same facts\n\n- `filter.drop#0`: `filter.drop` got `host.down`. The causes `filter.drop`, `host.down` have the same facts in this world, and they are the first 2 causes.");
    expect(text).toContain("### Wrong diagnoses\n\n- `filter.drop#1`: `filter.drop` got `host.down` (rank of the truth: 3).\n\n### Hits");
  });
});
