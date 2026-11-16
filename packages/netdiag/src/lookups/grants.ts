import type { HostGrant } from "../scope.ts";
import { CYMRU_ZONES } from "./cymru.ts";
import { RDAP_BOOTSTRAP, RDAP_REGISTRIES } from "./rdap.ts";

// The grants of the lookups. The probes of the owners and of the origins send the addresses of a path to hosts that
// the user does not name as a target. Thus a check grants these hosts by name only when the user turns the lookups on.

/**
 * This function gives the grants by name of each host that the lookups reach. The hosts are the bootstrap host of IANA,
 * each registry of `RDAP_REGISTRIES` and each zone of `CYMRU_ZONES`. The text `reason` ends the note of each grant.
 */
export function lookupGrants(reason: string): HostGrant[] {
  const registries = [...new Set(Object.values(RDAP_BOOTSTRAP).map((url) => new URL(url).hostname)), ...RDAP_REGISTRIES];
  return [
    ...registries.map((host): HostGrant => ({ kind: "host", host, basis: "named", note: `a registry of RDAP for ${reason}` })),
    ...Object.values(CYMRU_ZONES).map((host): HostGrant => ({ kind: "host", host, basis: "named", note: `a DNS zone of Team Cymru for ${reason}` })),
  ];
}
