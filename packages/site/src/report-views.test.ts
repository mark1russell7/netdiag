import { DNS_ANSWER, LAYERS, PATH_ORIGIN, PATH_OWNER, PATH_REPORT, STANDARD_CATALOG, TCP_CONNECT, target, type Fact, type PathOrigin, type PathOwner, type ReportHop, type VisitRole, type VisitStep } from "@mark1russell7/netdiag";
import { PARTS, type Cause } from "@mark1russell7/netdiag/diagnosis";
import { planCheck, reportOf } from "@mark1russell7/netdiag-cli";
import { describe, expect, it } from "vitest";
import { flowOf, pathsOf, ringsOf, timelineOf, toneOf } from "./report-views.ts";

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

describe("pathsOf", () => {
  const DESTINATION = "192.0.2.10";
  /** A report of mtr to the destination, with the hops in the order of the TTL. */
  const path = (cycles: number, hops: readonly ReportHop[], outcome = "reached"): VisitStep =>
    fact("target", "shop.example", PATH_REPORT.kind, PATH_REPORT.layer, DESTINATION, 2000, 2100, { address: DESTINATION, outcome, cycles, hops });
  /** The hops of a report: `lost` probes of `sent` lost at each address. */
  const hops = (sent: number, losses: readonly (readonly [string, number])[]): ReportHop[] =>
    losses.map(([address, lost], index) => ({ ttl: index + 1, address, sent, received: sent - lost }));
  const owner = (value: PathOwner): VisitStep => fact("target", "shop.example", PATH_OWNER.kind, PATH_OWNER.layer, value.address, 2100, 2101, value);
  const origin = (value: PathOrigin): VisitStep => fact("target", "shop.example", PATH_ORIGIN.kind, PATH_ORIGIN.layer, value.address, 2101, 2102, value);
  const network = (handle: string, name: string, originAs: readonly number[]) => ({ handle, name, start: "0.0.0.0", end: "0.0.0.0", cidrs: [], originAs });
  const viewOf = (steps: readonly VisitStep[]) => pathsOf(reportOf(planned.value, [...STEPS, ...steps]));

  it("gives no view for a report with no report of mtr", () => {
    expect(pathsOf(report)).toEqual([]);
  });

  it("puts the start of a loss after the gateway, and names each network with the words of the CLI", () => {
    // With 100 cycles and 10 lost at the destination, each hop with no loss is clearly lower. So the loss starts after hop 2.
    const views = viewOf([
      path(100, hops(100, [["192.168.1.1", 0], ["198.51.100.1", 0], ["203.0.113.1", 10], [DESTINATION, 10]])),
      owner({ address: "203.0.113.1", outcome: "found", registry: "rdap.arin.net", network: network("NET-T", "TRANSIT-NET", [64501]) }),
      owner({ address: DESTINATION, outcome: "found", registry: "rdap.arin.net", network: network("NET-S", "SHOP-NET", []) }),
    ]);
    expect(views).toHaveLength(1);
    const view = views[0];
    expect(view).toMatchObject({ subject: "target shop.example", address: DESTINATION, outcome: "reached", cycles: 100 });
    expect(view?.summary).toBe("The loss of 10% to 192.0.2.10 starts in one of 2 networks: TRANSIT-NET (AS64501) or SHOP-NET.");
    expect(view?.notes).toEqual(["The loss starts after hop 2 (198.51.100.1), a hop with a clearly lower loss."]);
    expect(view?.networks).toEqual([
      { name: "TRANSIT-NET (AS64501)", hops: "hop 3 (203.0.113.1)" },
      { name: "SHOP-NET", hops: "hop 4 (192.0.2.10)" },
    ]);
    expect(view?.hops.map((hop) => [hop.ttl, hop.place, hop.lossText, hop.network])).toEqual([
      [1, "clear", "0%", "no lookup of the owner"],
      [2, "bound", "0%", "no lookup of the owner"],
      [3, "start", "10%", "TRANSIT-NET (NET-T), AS64501"],
      [4, "start", "10%", "SHOP-NET (NET-S)"],
    ]);
    expect(view?.hops[2]?.loss).toBeCloseTo(0.1, 9);
  });

  it("starts the loss on the first link when no hop has a clearly lower loss, with the hint of more cycles", () => {
    const view = viewOf([path(20, hops(20, [["192.168.1.1", 0], [DESTINATION, 4]]))])[0];
    expect(view?.hops.map((hop) => hop.place)).toEqual(["start", "start"]);
    expect(view?.notes).toEqual(["No hop has a clearly lower loss, so the loss can start on the first link.", "More cycles give a shorter part of the path. Give --mtr-cycles 100."]);
    expect(view?.networks.map((item) => item.name)).toEqual(["the network of 192.168.1.1", "the network of 192.0.2.10"]);
  });

  it("gives no start for a path with no loss at the destination, or a path that did not reach it", () => {
    const silent: ReportHop = { ttl: 2, sent: 100, received: 0 };
    const view = viewOf([path(100, [{ ttl: 1, address: "192.168.1.1", sent: 100, received: 60 }, silent, { ttl: 3, address: DESTINATION, sent: 100, received: 100 }])])[0];
    expect(view).toMatchObject({ summary: "The path to 192.0.2.10 has no loss at the destination.", notes: [], networks: [] });
    expect(view?.hops.map((hop) => [hop.place, hop.lossText, hop.address, hop.network])).toEqual([
      ["clear", "40%", "192.168.1.1", "no lookup of the owner"],
      ["clear", "100%", undefined, "no answer"],
      ["clear", "0%", DESTINATION, "no lookup of the owner"],
    ]);
    const stopped = viewOf([path(100, hops(100, [["192.168.1.1", 0]]), "stopped")])[0];
    expect(stopped).toMatchObject({ outcome: "stopped", summary: "The probes of mtr did not reach 192.0.2.10.", networks: [] });
    expect(viewOf([path(100, [{ ttl: 1, address: DESTINATION, sent: 0, received: 0 }])])[0]?.hops[0]).toMatchObject({ lossText: "no probe", loss: undefined });
  });

  it("names a private hop with special owners and origins, as the hops of the kernel lab", () => {
    const view = viewOf([
      path(60, hops(60, [["172.21.0.1", 0], [DESTINATION, 11]])),
      owner({ address: "172.21.0.1", outcome: "special", class: "private" }),
      origin({ address: "172.21.0.1", outcome: "special", class: "private" }),
      origin({ address: DESTINATION, outcome: "special", class: "documentation" }),
    ])[0];
    expect(view?.hops.map((hop) => [hop.place, hop.network])).toEqual([
      ["bound", "a special-purpose address (private), with no lookup"],
      ["start", "a special-purpose address (documentation), with no lookup"],
    ]);
    expect(view?.networks).toEqual([{ name: "the network of 192.0.2.10", hops: "hop 2 (192.0.2.10)" }]);
    expect(view?.summary).toBe("The loss of 18% to 192.0.2.10 starts in the network of 192.0.2.10.");
  });
});
