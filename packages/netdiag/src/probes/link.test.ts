import { networkInterfaces } from "node:os";
import { fakeClock } from "@mark1russell7/algebra/clock";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LINK_STATE, createRunner, isFactOf, scopeOf } from "../index.ts";
import { interfaceOf, linkProbe, linkStateOf, upInterfaces, type InterfaceAddress, type InterfaceTable } from "./link.ts";

// The link probe on tables of interfaces. One test reads the interfaces of this computer, and it asserts only the check
// of the fact, not a state.

const TABLE: InterfaceTable = {
  lo: [
    { address: "127.0.0.1", cidr: "127.0.0.1/8", internal: true },
    { address: "::1", cidr: "::1/128", internal: true },
  ],
  wlan0: [
    { address: "192.168.1.20", cidr: "192.168.1.20/24", internal: false },
    { address: "fe80::a", cidr: "fe80::a/64", internal: false },
  ],
  eth0: [{ address: "10.0.0.5", cidr: null, internal: false }],
  down0: [],
};

describe("the link probe", () => {
  it("lists the interfaces that are not loopback, by name, with their CIDR ranges", () => {
    expect(upInterfaces(TABLE)).toEqual([
      { name: "eth0", addresses: ["10.0.0.5"] },
      { name: "wlan0", addresses: ["192.168.1.20/24", "fe80::a/64"] },
    ]);
    expect(upInterfaces({ lo: TABLE["lo"], gone: undefined })).toEqual([]);
  });

  it("finds the interface of the network of the gateway, and the interface of a zone", () => {
    const up = upInterfaces(TABLE);
    expect(interfaceOf(up, "192.168.1.1")).toBe("wlan0");
    expect(interfaceOf(up, "fe80::1")).toBe("wlan0");
    expect(interfaceOf(up, "fe80::1%eth0")).toBe("eth0");
    expect(interfaceOf(up, "fe80::1%wlan9")).toBeUndefined();
    expect(interfaceOf(up, "10.0.0.1")).toBeUndefined();
    expect(interfaceOf(up, "10.0.0.5")).toBe("eth0");
    expect(interfaceOf(up, "not an address")).toBeUndefined();
  });

  it("gives up or down, to a gateway or to any network", () => {
    const up = upInterfaces(TABLE);
    expect(linkStateOf(up, "192.168.1.1")).toEqual({ state: "up", interfaces: up, gateway: "192.168.1.1", via: "wlan0" });
    expect(linkStateOf(up, "172.16.0.1")).toEqual({ state: "down", interfaces: up, gateway: "172.16.0.1" });
    expect(linkStateOf(up)).toEqual({ state: "up", interfaces: up });
    expect(linkStateOf([])).toEqual({ state: "down", interfaces: [] });
  });

  it("gives a state that passes the check of the kind for each table and gateway", () => {
    const entry: fc.Arbitrary<InterfaceAddress> = fc.record({
      address: fc.ipV4(),
      cidr: fc.option(fc.tuple(fc.ipV4(), fc.integer({ min: 0, max: 32 })).map(([address, prefix]) => `${address}/${prefix}`), { nil: null }),
      internal: fc.boolean(),
    });
    const table = fc.dictionary(fc.constantFrom("lo", "eth0", "wlan0", "en0", "utun3"), fc.array(entry, { maxLength: 3 }));
    fc.assert(
      fc.property(table, fc.option(fc.ipV4(), { nil: undefined }), (t, gateway) => {
        const state = linkStateOf(upInterfaces(t), gateway);
        expect(LINK_STATE.check(state)).toBe(true);
        if (state.via !== undefined) expect(state.interfaces.map((i) => i.name)).toContain(state.via);
      }),
    );
  });

  it("runs as a passive probe with no grant, and gives one fact of the gateway", async () => {
    const scope = scopeOf([]);
    if (scope.tag === "err") throw new Error(scope.error.join(" "));
    const runner = createRunner({ scope: scope.value, clock: fakeClock(0) });
    const outcome = await runner.run(linkProbe(() => TABLE), { gateway: "192.168.1.1" });
    expect(outcome.status).toBe("done");
    if (outcome.status !== "done") return;
    expect(outcome.facts).toHaveLength(1);
    const fact = outcome.facts[0];
    expect(fact !== undefined && isFactOf(LINK_STATE, fact) && [fact.subject.host, fact.value.state, fact.value.via]).toEqual(["192.168.1.1", "up", "wlan0"]);
    const plain = await runner.run(linkProbe(() => TABLE), {});
    expect(plain.status === "done" && plain.facts[0]?.subject.host).toBe("localhost");
  });

  it("reads the interfaces of this computer into a fact that passes the check", () => {
    const state = linkStateOf(upInterfaces(networkInterfaces()));
    expect(LINK_STATE.check(state)).toBe(true);
  });
});
