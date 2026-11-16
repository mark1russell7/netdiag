import { describe, expect, it } from "vitest";
import type { Fact, FactKind } from "../fact.ts";
import { PATH_OWNER, PATH_REPORT, type OwnerNetwork, type PathOwner, type PathReport, type ReportHop } from "../kinds.ts";
import { target } from "../target.ts";
import { lossNetworks, lossOrigins, lossStart } from "./origin.ts";

// The start of the loss of a path, on reports of mtr with known counts. The p values of the tests are in the comments.

/** A hop with `lost` probes of `sent` lost. A hop with an address of `undefined` gave no answer. */
function hop(ttl: number, address: string | undefined, lost: number, sent = 100): ReportHop {
  return address === undefined ? { ttl, sent, received: 0 } : { ttl, address, sent, received: sent - lost };
}

function report(hops: readonly ReportHop[], outcome: PathReport["outcome"] = "reached"): PathReport {
  return { address: "203.0.113.7", outcome, cycles: hops[0]?.sent ?? 0, hops };
}

/**
 * A path of 100 cycles with a loss of 10 % at the destination. The router of hop 3 drops half of its answers, and
 * passes the other packets. Hop 4 has no loss, so the loss starts after it. Each p of hops 1, 2 and 4 is 0.0034.
 */
const PATH = report([
  hop(1, "192.168.1.1", 0),
  hop(2, "100.64.0.1", 0),
  hop(3, "198.51.100.1", 50),
  hop(4, "198.51.100.9", 0),
  hop(5, undefined, 0),
  hop(6, "203.0.113.1", 9),
  hop(7, "203.0.113.2", 11),
  hop(8, "203.0.113.7", 10),
]);

const ttls = (start: ReturnType<typeof lossStart>) => start?.hops.map((item) => item.ttl);

describe("the start of the loss of a path", () => {
  it("starts after the last hop with a clearly lower loss, and a router that drops its answers does not move it", () => {
    const start = lossStart(PATH);
    expect(start?.after?.ttl).toBe(4);
    expect(ttls(start)).toEqual([6, 7, 8]);
    expect(start?.loss).toMatchObject({ sent: 100, lost: 10, ratio: 0.1 });
    expect(start?.address).toBe("203.0.113.7");
  });

  it("gives the whole path when the cycles are too few to tell a lower loss", () => {
    // With 20 cycles and 4 lost at the destination, the p of each hop with no loss is 0.186.
    const short = report([hop(1, "192.168.1.1", 0, 20), hop(2, "198.51.100.1", 0, 20), hop(3, "203.0.113.1", 4, 20), hop(4, "203.0.113.7", 4, 20)]);
    const start = lossStart(short);
    expect(start?.after).toBeUndefined();
    expect(ttls(start)).toEqual([1, 2, 3, 4]);
  });

  it("gives no start without a loss at the destination, or when the report did not reach it", () => {
    expect(lossStart(report([hop(1, "192.168.1.1", 30), hop(2, "203.0.113.7", 0)]))).toBeUndefined();
    expect(lossStart(report([hop(1, "192.168.1.1", 0), hop(2, "198.51.100.1", 10)], "stopped"))).toBeUndefined();
    expect(lossStart(report([]))).toBeUndefined();
  });

  it("uses the order of the TTL, not the order of the hops in the report", () => {
    const shuffled = report([...PATH.hops].reverse());
    expect(ttls(lossStart(shuffled))).toEqual([6, 7, 8]);
  });

  it("finds fewer lower hops at a stricter level", () => {
    expect(lossStart(PATH, 0.001)?.after).toBeUndefined();
  });
});

const NETWORK: OwnerNetwork = { handle: "NET-203-0-113-0-1", name: "EXAMPLE-NET", start: "203.0.113.0", end: "203.0.113.255", cidrs: ["203.0.113.0/24"], originAs: [64500] };
const found = (address: string): PathOwner => ({ address, outcome: "found", registry: "rdap.arin.net", network: NETWORK });

describe("the networks where the loss can start", () => {
  it("puts next hops of one network in one item, and each hop without a found owner in an item of its own", () => {
    const start = lossStart(PATH);
    if (start === undefined) throw new Error("the path has a loss");
    const owners = [found("203.0.113.2"), found("203.0.113.7"), { address: "203.0.113.1", outcome: "failed", detail: "a time-out" } satisfies PathOwner];
    const networks = lossNetworks(start, owners);
    expect(networks.map((item) => [item.owner?.outcome, item.hops.map((one) => one.ttl)])).toEqual([
      ["failed", [6]],
      ["found", [7, 8]],
    ]);
    expect(lossNetworks(start, []).map((item) => item.hops.length)).toEqual([1, 1, 1]);
  });

  it("gives the origin of each report with a loss, from the facts of a visit", () => {
    const entries: readonly (readonly [FactKind<unknown>, unknown])[] = [
      [PATH_REPORT, PATH],
      [PATH_REPORT, report([hop(1, "192.168.1.1", 0), hop(2, "203.0.113.7", 0)])],
      [PATH_OWNER, found("203.0.113.1")],
      [PATH_OWNER, found("203.0.113.2")],
      [PATH_OWNER, found("203.0.113.7")],
    ];
    const facts: Fact[] = entries.map(([kind, value], index) => ({
      id: `f${index}`,
      kind: kind.kind,
      layer: kind.layer,
      subject: target("203.0.113.7"),
      time: { start: index, end: index + 1 },
      source: { probe: "test", version: "1" },
      value,
    }));
    const origins = lossOrigins(facts);
    expect(origins.map((item) => item.fact)).toEqual(["f0"]);
    expect(origins[0]?.networks.map((item) => [item.owner?.network?.name, item.hops.length])).toEqual([["EXAMPLE-NET", 3]]);
  });
});
