import type { Fact } from "./fact.ts";
import type { Grant } from "./scope.ts";

// The data of a visit: its hosts, its input, the roles of its hosts and its steps. This module imports no probe, so a
// browser can read the steps of a visit.

/** A host of a visit: a DNS name or an IP address, and the port of its web service. */
export interface VisitHost {
  readonly host: string;
  /** The port of the HTTP request. The default is the port of the scheme. */
  readonly port?: number | undefined;
}

/** The DNS resolver of the names of a visit. */
export interface VisitResolver {
  readonly address: string;
  /** The default is 53. */
  readonly port?: number | undefined;
}

/** The hosts of a visit, and the grants of its scope. */
export interface VisitInput {
  readonly target: VisitHost;
  readonly references?: readonly VisitHost[] | undefined;
  /** The address of the default gateway, when the caller knows it. The visit sends it ICMP echo requests only. */
  readonly gateway?: string | undefined;
  /** A name of the visit needs a resolver. Without it, the visit gives a problem for each name. */
  readonly resolver?: VisitResolver | undefined;
  /** The grants of the scope. Each probe sends packets only to a peer in the scope. */
  readonly grants: readonly Grant[];
}

/**
 * The role of a host in a visit. The caller gives the role, and the caller decides which facts are about the target.
 *
 * - `target`: the host that the user diagnoses.
 * - `reference`: a host that works, for a comparison.
 * - `gateway`: the default gateway of this computer.
 * - `local`: this computer, for example the state of its link.
 */
export type VisitRole = (typeof VISIT_ROLES)[number];

/** The roles of a host in a visit. The type `VisitRole` is one of them. */
export const VISIT_ROLES: readonly ["target", "reference", "gateway", "local"] = ["target", "reference", "gateway", "local"];

/** One step of a visit: a fact, or a problem of a probe that did not end. `host` is the host of the role. */
export type VisitStep =
  | { readonly kind: "fact"; readonly role: VisitRole; readonly host: string; readonly fact: Fact }
  | { readonly kind: "problem"; readonly role: VisitRole; readonly host: string; readonly problem: string };

/**
 * When a visit searches the MTU of the path to an address.
 *
 * - `auto`: after a TLS handshake or an HTTP response that timed out after a TCP connect. A path that drops large
 *   packets with no message gives this sign: the small packets of the connect pass, and the large packets do not.
 * - `always`: after the HTTP request to each address.
 * - `never`: the visit does not search.
 */
export type MtuSearch = "auto" | "always" | "never";

/** The values of `MtuSearch`. */
export const MTU_SEARCHES: readonly MtuSearch[] = ["auto", "always", "never"];
