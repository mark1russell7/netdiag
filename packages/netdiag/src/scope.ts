import { err, ok, type Result } from "@mark1russell7/optional";
import { cidrContains, ipVersion, parseCidr } from "./address/index.ts";
import { canonicalHost, formatTarget, type Target } from "./target.ts";

/**
 * The basis of a grant: why a target is in the scope.
 *
 * - `named`: the user named the target for this diagnosis.
 * - `owned`: the user declares that the user owns the network or the host.
 * - `configured`: the configuration of the computer of the user names it, for example the gateway or the DNS resolver.
 * - `resolved`: a DNS answer for a granted name gave this address.
 */
export type GrantBasis = "named" | "owned" | "configured" | "resolved";

/**
 * A grant puts targets in the scope.
 *
 * A `host` grant puts a DNS name in the scope, and with `subdomains` each name under it. A `range` grant puts the
 * addresses of a CIDR range in the scope, for example `192.0.2.0/24` or `2001:db8::/32`.
 */
export type Grant = HostGrant | RangeGrant;

/** A grant of a DNS name, and with `subdomains` of each name under it. */
export interface HostGrant {
  readonly kind: "host";
  readonly host: string;
  readonly subdomains?: boolean | undefined;
  readonly basis: GrantBasis;
  readonly note?: string | undefined;
}

/** A grant of the addresses of a CIDR range, for example `192.0.2.0/24` or `2001:db8::/32`. */
export interface RangeGrant {
  readonly kind: "range";
  readonly cidr: string;
  readonly basis: GrantBasis;
  readonly note?: string | undefined;
}

/**
 * The scope of a diagnosis: the grants, and the largest number of ports for each host.
 *
 * An active probe sends packets only to a peer in the scope. The limit of ports stops a port scan: netdiag does no
 * vulnerability scan.
 */
export interface Scope {
  readonly grants: readonly Grant[];
  readonly maxPortsPerHost: number;
}

/** The default limit of the different ports of one host in one runner. */
export const DEFAULT_MAX_PORTS_PER_HOST = 8;

/** The decision of the scope for one peer of an active probe. A refusal has the reason in plain words. */
export type ScopeDecision =
  | { readonly allowed: true; readonly grant: Grant }
  | { readonly allowed: false; readonly reason: string };

/** The ports that a runner sent packets to, for each host. */
export type PortLedger = ReadonlyMap<string, ReadonlySet<number>>;

/** This function gives the problems of a grant, or an empty list for a correct grant. */
export function grantProblems(grant: Grant): string[] {
  if (grant.kind === "range") {
    const range = parseCidr(grant.cidr);
    return range.tag === "err" ? [range.error] : [];
  }
  const host = canonicalHost(grant.host);
  if (host.length === 0) return ["A host grant has an empty host."];
  if (ipVersion(host) !== 0) return [`The host grant "${grant.host}" is an IP address. Use a range grant for an address.`];
  return [];
}

/**
 * This function makes a scope from grants. It refuses a grant with a problem, so a typing error cannot widen the scope.
 *
 * The default limit of ports is `DEFAULT_MAX_PORTS_PER_HOST`.
 */
export function scopeOf(grants: readonly Grant[], options: { readonly maxPortsPerHost?: number } = {}): Result<Scope, string[]> {
  const problems = grants.flatMap(grantProblems);
  const maxPortsPerHost = options.maxPortsPerHost ?? DEFAULT_MAX_PORTS_PER_HOST;
  if (!Number.isInteger(maxPortsPerHost) || maxPortsPerHost < 1) problems.push("The limit of ports for each host is not a positive integer.");
  if (problems.length > 0) return err(problems);
  return ok({ grants: [...grants], maxPortsPerHost });
}

/**
 * This function gives the grant for a target that the user names. A name gets a host grant. An IP address gets a
 * range grant of one address.
 */
export function namedGrant(t: Target, note?: string): Grant {
  if (t.kind === "name") return { kind: "host", host: t.host, basis: "named", note };
  return { kind: "range", cidr: `${t.host}/${t.kind === "ipv4" ? 32 : 128}`, basis: "named", note };
}

/** This function gives the grant of one address that a DNS answer for a granted name gave. */
export function resolvedGrant(name: string, address: string, factId?: string): RangeGrant {
  const host = canonicalHost(address);
  const family = ipVersion(host);
  if (family === 0) throw new RangeError(`"${address}" is not an IP address`);
  const note = factId === undefined ? `${canonicalHost(name)} resolved to it` : `${canonicalHost(name)} resolved to it (fact ${factId})`;
  return { kind: "range", cidr: `${host}/${family === 4 ? 32 : 128}`, basis: "resolved", note };
}

/** This function gives a scope with more grants. The limit of ports does not change. */
export function widen(scope: Scope, grants: readonly Grant[]): Result<Scope, string[]> {
  return scopeOf([...scope.grants, ...grants], { maxPortsPerHost: scope.maxPortsPerHost });
}

function grantFor(scope: Scope, peer: Target): Grant | undefined {
  const host = canonicalHost(peer.host);
  const family = ipVersion(host);
  for (const grant of scope.grants) {
    if (grant.kind === "host") {
      if (family !== 0) continue;
      const granted = canonicalHost(grant.host);
      if (host === granted || (grant.subdomains === true && host.endsWith(`.${granted}`))) return grant;
      continue;
    }
    if (family === 0) continue;
    const range = parseCidr(grant.cidr);
    if (range.tag === "ok" && cidrContains(range.value, host)) return grant;
  }
  return undefined;
}

/**
 * This function decides if an active probe can send packets to a peer.
 *
 * The peer must match a grant of the scope. A new port of a host must also stay in the limit of ports for each host.
 * The ledger has the ports that the runner sent packets to before.
 */
export function decideScope(scope: Scope, peer: Target, ledger: PortLedger = new Map()): ScopeDecision {
  const grant = grantFor(scope, peer);
  if (grant === undefined) {
    return {
      allowed: false,
      reason: `${formatTarget(peer)} is not in the scope. Name it, or add a grant for a network that you own.`,
    };
  }
  if (peer.port !== undefined) {
    const ports = ledger.get(canonicalHost(peer.host)) ?? new Set<number>();
    if (!ports.has(peer.port) && ports.size >= scope.maxPortsPerHost) {
      return {
        allowed: false,
        reason: `${formatTarget(peer)} is a new port after ${ports.size} ports of the same host. netdiag does no port scan.`,
      };
    }
  }
  return { allowed: true, grant };
}
