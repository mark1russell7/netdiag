import { describe, expect, it } from "vitest";
import { decideScope, scopeOf } from "../index.ts";
import { CYMRU_ZONES } from "./cymru.ts";
import { lookupGrants } from "./grants.ts";
import { originProbe, type TxtResolve } from "./origin.ts";
import { ownerProbe, type RdapGet } from "./owner.ts";
import { RDAP_REGISTRIES } from "./rdap.ts";

// The grants of the lookups hold each peer of the two probes. The ports refuse each call, but `peers` calls no port.

const refuseGet: RdapGet = () => Promise.reject(new Error("no request in a test"));
const refuseResolve: TxtResolve = () => Promise.reject(new Error("no query in a test"));
const RESOLVER = "192.0.2.53";

describe("lookupGrants", () => {
  it("grants the bootstrap host of IANA, each registry of RDAP and each zone of Team Cymru by name", () => {
    const grants = lookupGrants("--owners");
    expect(grants.map((grant) => [grant.host, grant.basis, grant.subdomains])).toEqual(
      ["data.iana.org", ...RDAP_REGISTRIES, CYMRU_ZONES.ipv4, CYMRU_ZONES.ipv6].map((host) => [host, "named", undefined]),
    );
    expect(grants.slice(0, -2).every((grant) => grant.note === "a registry of RDAP for --owners")).toBe(true);
    expect(grants.slice(-2).every((grant) => grant.note === "a DNS zone of Team Cymru for --owners")).toBe(true);
  });

  it("holds each peer of the probes of the owners and of the origins, except the resolver", () => {
    const addresses = ["10.0.0.1", "8.8.8.8", "2001:4860::8888"];
    const peers = [...ownerProbe(refuseGet).peers({ addresses }), ...originProbe(refuseResolve).peers({ addresses, resolver: RESOLVER })];
    const scope = scopeOf(lookupGrants("a test"));
    if (scope.tag === "err") throw new Error(scope.error.join(" "));
    const refused = peers.filter((peer) => !decideScope(scope.value, peer).allowed).map((peer) => peer.host);
    expect(refused).toEqual([RESOLVER]);
    expect(peers.map((peer) => peer.host)).toEqual(expect.arrayContaining(["data.iana.org", CYMRU_ZONES.ipv4, CYMRU_ZONES.ipv6]));
  });
});
