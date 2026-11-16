import { CYMRU_ZONES, RDAP_REGISTRIES, decideScope, scopeOf, target, type Grant } from "@mark1russell7/netdiag";
import { DEFAULT_MTR_CYCLES, DEFAULT_PING_COUNT, MAX_MTR_CYCLES, MAX_PING_COUNT } from "@mark1russell7/netdiag/tools";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planCheck, type CheckOptions, type CheckPlan, type PlanSystem } from "./plan.ts";

// The plan is the scope rule of the command line. No test sends a packet.

const NO_RESOLVER: PlanSystem = { resolvers: [] };

function planned(options: CheckOptions, system: PlanSystem = NO_RESOLVER): CheckPlan {
  const plan = planCheck(options, system);
  if (plan.tag === "err") throw new Error(`The plan has problems: ${plan.error.join(" ")}`);
  return plan.value;
}

function problems(options: CheckOptions, system: PlanSystem = NO_RESOLVER): readonly string[] {
  const plan = planCheck(options, system);
  return plan.tag === "err" ? plan.error : [];
}

describe("the plan of a check", () => {
  it("searches the MTU of each address with mtu true, and never with mtu false", () => {
    expect(planned({ target: "example.com", mtu: true }).mtu).toBe("always");
    expect(planned({ target: "example.com", mtu: false }).mtu).toBe("never");
  });

  it("starts mtr with mtrCycles, and grants the registries of RDAP and the zones of Team Cymru only with owners", () => {
    const plain = planned({ target: "example.com" });
    expect([plain.mtrCycles, plain.owners]).toEqual([0, false]);
    expect(plain.visit.grants.some((grant) => grant.kind === "host" && RDAP_REGISTRIES.includes(grant.host))).toBe(false);
    expect(planned({ target: "example.com", mtrCycles: 5 }).mtrCycles).toBe(5);
    const owners = planned({ target: "example.com", owners: true });
    expect([owners.mtrCycles, owners.owners]).toEqual([DEFAULT_MTR_CYCLES, true]);
    const registries = owners.visit.grants.filter((grant) => grant.note === "a registry of RDAP for --owners");
    expect(registries.map((grant) => [grant.kind === "host" ? grant.host : grant.cidr, grant.basis])).toEqual(
      ["data.iana.org", ...RDAP_REGISTRIES].map((host) => [host, "named"]),
    );
    const zone = "a DNS zone of Team Cymru for --owners";
    const zones = owners.visit.grants.filter((grant) => grant.note === zone);
    expect(zones.map((grant) => [grant.kind === "host" ? grant.host : grant.cidr, grant.basis])).toEqual([
      ["origin.asn.cymru.com", "named"],
      ["origin6.asn.cymru.com", "named"],
    ]);
    expect(zones.map((grant) => (grant.kind === "host" ? grant.host : ""))).toEqual(Object.values(CYMRU_ZONES));
    expect(plain.visit.grants.some((grant) => grant.note === zone)).toBe(false);
  });

  it("refuses a number of cycles of mtr out of the range, and owners with no mtr", () => {
    expect(problems({ target: "example.com", mtrCycles: MAX_MTR_CYCLES + 1 })).toEqual([`The number of cycles of mtr ${MAX_MTR_CYCLES + 1} is not an integer from 0 to ${MAX_MTR_CYCLES}.`]);
    expect(problems({ target: "example.com", mtrCycles: 1.5 })).toHaveLength(1);
    expect(problems({ target: "example.com", owners: true, mtrCycles: 0 })[0]).toMatch(/--mtr-cycles 1 or more/);
  });

  it("reads a name with the defaults: https, the path /, the default ping count and no port", () => {
    const plan = planned({ target: "WWW.Example.COM." });
    expect(plan.target).toEqual({ host: "www.example.com", kind: "name" });
    expect([plan.scheme, plan.path, plan.pingCount, plan.mtu]).toEqual(["https", "/", DEFAULT_PING_COUNT, "auto"]);
    expect(plan.visit.target).toEqual({ host: "www.example.com" });
    expect(plan.visit.grants).toEqual([{ kind: "host", host: "www.example.com", basis: "named", note: "the target" }]);
  });

  it("takes the scheme, the path and only a named port from a URL", () => {
    const plain = planned({ target: "http://shop.example/cart?id=4" });
    expect([plain.scheme, plain.path, plain.target.port]).toEqual(["http", "/cart?id=4", undefined]);
    const ported = planned({ target: "https://[2001:db8::1]:8443/" });
    expect(ported.target).toEqual({ host: "2001:db8::1", kind: "ipv6", port: 8443 });
    expect(ported.visit.grants).toEqual([{ kind: "range", cidr: "2001:db8::1/128", basis: "named", note: "the target" }]);
  });

  it("gives the flags priority over the parts of a URL", () => {
    const plan = planned({ target: "http://shop.example:8080/a", scheme: "https", path: "/b", port: 8443 });
    expect([plan.scheme, plan.path, plan.target.port, plan.visit.target.port]).toEqual(["https", "/b", 8443, 8443]);
  });

  it("grants the resolver of the computer with the basis configured, and a named resolver with the basis named", () => {
    const system = planned({ target: "example.com" }, { resolvers: ["192.0.2.53", "192.0.2.54"] });
    expect(system.visit.resolver).toEqual({ address: "192.0.2.53" });
    expect(system.visit.grants[1]).toEqual({ kind: "range", cidr: "192.0.2.53/32", basis: "configured", note: "the DNS resolver" });
    const named = planned({ target: "example.com", resolver: "[2001:db8::53]:5353" }, { resolvers: ["192.0.2.53"] });
    expect(named.visit.resolver).toEqual({ address: "2001:db8::53", port: 5353 });
    expect(named.visit.grants[1]).toEqual({ kind: "range", cidr: "2001:db8::53/128", basis: "named", note: "the DNS resolver" });
  });

  it("grants each reference, the gateway and each range, in this order", () => {
    const plan = planned({ target: "example.com", reference: ["ref.example:8443", "198.51.100.7"], gateway: "192.0.2.1", grant: [" 10.0.0.0/8 "] });
    expect(plan.visit.references).toEqual([{ host: "ref.example", port: 8443 }, { host: "198.51.100.7" }]);
    expect(plan.visit.gateway).toBe("192.0.2.1");
    expect(plan.visit.grants.map((grant) => [grant.kind === "host" ? grant.host : grant.cidr, grant.basis])).toEqual([
      ["example.com", "named"],
      ["ref.example", "named"],
      ["198.51.100.7/32", "named"],
      ["192.0.2.1/32", "named"],
      ["10.0.0.0/8", "owned"],
    ]);
  });

  it("gives each problem of the options, and grants nothing", () => {
    const found = problems({
      target: "example.com",
      path: "status",
      port: 70000,
      pingCount: MAX_PING_COUNT + 1,
      reference: ["not a host"],
      resolver: "dns.example",
      gateway: "router.example",
      grant: ["10.0.0.0/33"],
    });
    expect(found).toHaveLength(7);
    expect(found.join("\n")).toMatch(/path "status"/);
    expect(found.join("\n")).toMatch(/port 70000/);
    expect(found.join("\n")).toMatch(/ping count 101/);
    expect(found.join("\n")).toMatch(/resolver "dns\.example" is not an IP address/);
    expect(found.join("\n")).toMatch(/gateway "router\.example" is not an IP address/);
  });

  it("refuses a URL with a scheme that is not http or https, and an empty target", () => {
    expect(problems({ target: "ftp://files.example/" })[0]).toMatch(/scheme ftp/);
    expect(problems({ target: "  " })).toHaveLength(1);
  });

  it("tells the user to give a resolver when the resolver of the computer is not valid", () => {
    expect(problems({ target: "example.com" }, { resolvers: ["resolver.example"] })[0]).toMatch(/The DNS resolver of the computer/);
  });
});

describe("the scope rule of a check", () => {
  // The named hosts are in 192.0.2.0/24, the ranges of --grant are in 10.0.0.0/8, and the other addresses are in
  // 198.51.100.0/24. Thus an address of 198.51.100.0/24 is never in the scope.
  const octet = fc.integer({ min: 1, max: 254 });
  const named = octet.map((last) => `192.0.2.${last}`);
  const range = fc.tuple(octet, fc.integer({ min: 16, max: 32 })).map(([second, bits]) => `10.${second}.0.0/${bits}`);
  const name = fc.constantFrom("example.com", "shop.example", "www.example.org");
  const host = fc.oneof(name, named);
  const options = fc.record({
    target: host,
    reference: fc.array(host, { maxLength: 3 }),
    resolver: fc.option(named, { nil: undefined }),
    gateway: fc.option(named, { nil: undefined }),
    grant: fc.array(range, { maxLength: 3 }),
  });

  it("grants only the target, the references, the resolver, the gateway and the ranges of --grant", () => {
    fc.assert(
      fc.property(options, fc.option(named, { nil: undefined }), (input, system) => {
        const plan = planned(input, { resolvers: system === undefined ? [] : [system] });
        const resolver = input.resolver ?? system;
        const expected = 1 + input.reference.length + (resolver === undefined ? 0 : 1) + (input.gateway === undefined ? 0 : 1) + input.grant.length;
        expect(plan.visit.grants).toHaveLength(expected);
        const owned = plan.visit.grants.filter((grant) => grant.basis === "owned");
        expect(owned.map((grant) => (grant.kind === "range" ? grant.cidr : ""))).toEqual(input.grant);
        // Each grant that is not of --grant has one host: a name, or one address.
        const single = (grant: Grant): boolean => grant.kind === "host" ? grant.subdomains !== true : /\/(32|128)$/.test(grant.cidr);
        expect(plan.visit.grants.filter((grant) => grant.basis !== "owned").every(single)).toBe(true);
      }),
      { seed: 20261115, numRuns: 200 },
    );
  });

  it("puts no address outside the named hosts and the ranges of --grant in the scope", () => {
    fc.assert(
      fc.property(options, octet, (input, last) => {
        const plan = planned(input, { resolvers: [] });
        const scope = scopeOf(plan.visit.grants);
        if (scope.tag === "err") throw new Error(scope.error.join(" "));
        expect(decideScope(scope.value, target(`198.51.100.${last}`)).allowed).toBe(false);
        expect(decideScope(scope.value, target("unnamed.example")).allowed).toBe(false);
        for (const address of [input.target, ...input.reference, ...(input.gateway === undefined ? [] : [input.gateway])]) {
          expect(decideScope(scope.value, target(address)).allowed).toBe(true);
        }
      }),
      { seed: 20261116, numRuns: 200 },
    );
  });
});
