import { DNS_ANSWER, LAYERS, STANDARD_CATALOG, TCP_CONNECT, target, type Fact, type VisitRole, type VisitStep } from "@mark1russell7/netdiag";
import { PARTS, type Cause } from "@mark1russell7/netdiag/diagnosis";
import { planCheck, reportOf } from "@mark1russell7/netdiag-cli";
import { describe, expect, it } from "vitest";
import { flowOf, ringsOf, timelineOf, toneOf } from "./report-views.ts";

// The views of a report of fixed steps: the target refuses the connect, and the reference host accepts it.

let next = 0;
function fact(role: VisitRole, host: string, kind: string, layer: Fact["layer"], subject: string, start: number, end: number, value: unknown): VisitStep {
  next += 1;
  return { kind: "fact", role, host, fact: { id: `f${next}`, kind, layer, subject: target(subject), time: { start, end }, source: { probe: "test", version: "0" }, value } };
}

const STEPS: readonly VisitStep[] = [
  fact("target", "shop.example", DNS_ANSWER.kind, "dns", "shop.example", 1000, 1003, { name: "shop.example", record: "A", resolver: "192.0.2.53:53", outcome: "ok", addresses: ["192.0.2.10"], ms: 3 }),
  fact("target", "shop.example", TCP_CONNECT.kind, "tcp", "192.0.2.10", 1003, 1005, { address: "192.0.2.10", port: 443, family: 4, outcome: "refused", ms: 2 }),
  fact("reference", "example.org", TCP_CONNECT.kind, "tcp", "198.51.100.7", 1005, 1012, { address: "198.51.100.7", port: 443, family: 4, outcome: "connected", ms: 7 }),
];

const planned = planCheck({ target: "shop.example", reference: ["example.org"] }, { resolvers: ["192.0.2.53"] });
if (planned.tag === "err") throw new Error(planned.error.join(" "));
const report = reportOf(planned.value, STEPS);

describe("toneOf", () => {
  it("gives the tone of a value from the healthy distribution of its feature", () => {
    expect(toneOf("tcp.connect", "connected")).toBe("usual");
    expect(toneOf("tcp.connect", "refused")).toBe("unusual");
    expect(toneOf("tcp.connect", "later-value")).toBe("unknown");
    expect(toneOf("later.feature", "x")).toBe("unknown");
  });
});

describe("flowOf", () => {
  const flow = flowOf(report);

  it("gives each layer in the order of the layers", () => {
    expect(flow.map((row) => row.layer)).toEqual([...LAYERS]);
  });

  it("puts the refused connect of the target and the connect of the reference in the layer tcp", () => {
    const tcp = flow.find((row) => row.layer === "tcp");
    expect(tcp?.state).toBe("unusual");
    expect(tcp?.target.map((item) => [item.evidence.value, item.tone])).toContainEqual(["refused", "unusual"]);
    expect(tcp?.others.map((item) => [item.evidence.value, item.tone])).toContainEqual(["connected", "usual"]);
    expect(tcp?.facts).toBe(2);
  });

  it("gives the state none to a layer with no observation", () => {
    expect(flow.find((row) => row.layer === "wifi")).toEqual({ layer: "wifi", state: "none", target: [], others: [], facts: 0 });
  });

  it("shows each evidence of the report one time, used or ignored", () => {
    const shown = flow.flatMap((row) => [...row.target, ...row.others]);
    expect(shown).toHaveLength(report.evidence.length + report.ignored.length);
    expect(shown.filter((item) => item.ignored !== undefined)).toHaveLength(report.ignored.length);
  });
});

describe("ringsOf", () => {
  it("gives each part, and probabilities that sum to the sum of the causes", () => {
    const rings = ringsOf(report.causes);
    for (const part of PARTS) expect(rings.map((ring) => ring.ring)).toContain(part);
    const sum = rings.reduce((total, ring) => total + ring.probability, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("puts the closed port in the part service, as its most probable cause", () => {
    const service = ringsOf(report.causes).find((ring) => ring.ring === "service");
    expect(service?.top?.id).toBe("port.closed");
  });

  it("puts a fault with no part in other, and gives no empty group", () => {
    const fault: Cause = { id: "later.fault", kind: "fault", summary: "A fault of a later version.", step: "No step.", probability: 0.25 };
    const none = STANDARD_CATALOG.hypotheses.find((hypothesis) => hypothesis.kind === "none");
    if (none === undefined) throw new Error("The catalog has no hypothesis none.");
    const rings = ringsOf([{ ...none, probability: 0.75 }, fault]);
    expect(rings.filter((ring) => ring.probability > 0).map((ring) => [ring.ring, ring.probability])).toEqual([
      ["other", 0.25],
      ["none", 0.75],
    ]);
    expect(rings.map((ring) => ring.ring)).not.toContain("unknown");
  });
});

describe("timelineOf", () => {
  it("gives a lane for each role and host, and the times from the first fact", () => {
    const timeline = timelineOf(report);
    expect(timeline.lanes).toEqual(["target shop.example", "reference example.org"]);
    expect(timeline.bars.map((bar) => [bar.id, bar.lane, bar.start, bar.end])).toEqual([
      ["f1", 0, 0, 3],
      ["f2", 0, 3, 5],
      ["f3", 1, 5, 12],
    ]);
    expect(timeline.span).toBe(12);
  });

  it("gives an empty timeline for a report with no facts", () => {
    expect(timelineOf(reportOf(planned.value, []))).toEqual({ lanes: [], bars: [], span: 0 });
  });
});
