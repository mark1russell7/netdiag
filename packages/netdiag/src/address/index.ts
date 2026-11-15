/**
 * The IP addresses and the networks of netdiag: the family and the class of an address, CIDR ranges and sets of ranges.
 *
 * This entry uses only the module `node:net`. An IPv4 address in IPv6 form (`::ffff:192.0.2.1`) is its IPv4 address.
 */
import { BlockList, isIP } from "node:net";
import { err, ok, type Result } from "@mark1russell7/optional";

/** The family of an IP address. */
export type AddressFamily = "ipv4" | "ipv6";

/**
 * The class of an IP address, from the special-purpose ranges of RFC 6890.
 *
 * - `unspecified`: `0.0.0.0/8` and `::`.
 * - `loopback`: `127.0.0.0/8` and `::1`.
 * - `private`: the ranges of RFC 1918.
 * - `shared`: `100.64.0.0/10`, the carrier-grade NAT range of RFC 6598.
 * - `link-local`: `169.254.0.0/16` and `fe80::/10`.
 * - `unique-local`: `fc00::/7`, the private range of IPv6 (RFC 4193).
 * - `documentation`: the ranges of RFC 5737 and RFC 3849 for examples.
 * - `benchmarking`: `198.18.0.0/15` (RFC 2544).
 * - `multicast`: `224.0.0.0/4` and `ff00::/8`.
 * - `reserved`: `240.0.0.0/4`, with the broadcast address.
 * - `public`: each other address.
 */
export type AddressClass =
  | "unspecified"
  | "loopback"
  | "private"
  | "shared"
  | "link-local"
  | "unique-local"
  | "documentation"
  | "benchmarking"
  | "multicast"
  | "reserved"
  | "public";

/** A CIDR range: an address of the network and the length of its prefix. */
export interface Cidr {
  readonly address: string;
  readonly prefix: number;
  readonly family: AddressFamily;
}

/** The special-purpose ranges, as data. An address that is in no range is `public`. */
export const ADDRESS_CLASSES: readonly { readonly cidr: string; readonly class: Exclude<AddressClass, "public"> }[] = [
  { cidr: "0.0.0.0/8", class: "unspecified" },
  { cidr: "10.0.0.0/8", class: "private" },
  { cidr: "100.64.0.0/10", class: "shared" },
  { cidr: "127.0.0.0/8", class: "loopback" },
  { cidr: "169.254.0.0/16", class: "link-local" },
  { cidr: "172.16.0.0/12", class: "private" },
  { cidr: "192.0.2.0/24", class: "documentation" },
  { cidr: "192.168.0.0/16", class: "private" },
  { cidr: "198.18.0.0/15", class: "benchmarking" },
  { cidr: "198.51.100.0/24", class: "documentation" },
  { cidr: "203.0.113.0/24", class: "documentation" },
  { cidr: "224.0.0.0/4", class: "multicast" },
  { cidr: "240.0.0.0/4", class: "reserved" },
  { cidr: "::/128", class: "unspecified" },
  { cidr: "::1/128", class: "loopback" },
  { cidr: "2001:db8::/32", class: "documentation" },
  { cidr: "fc00::/7", class: "unique-local" },
  { cidr: "fe80::/10", class: "link-local" },
  { cidr: "ff00::/8", class: "multicast" },
];

/** The classes of the addresses that the internet does not route to a host. */
const NOT_ROUTED: ReadonlySet<AddressClass> = new Set(["unspecified", "loopback", "private", "shared", "link-local", "unique-local"]);

/** This function gives the canonical form of an address: no spaces, no brackets, lower case, and IPv4 for a mapped IPv4 address. */
export function canonicalAddress(address: string): string {
  let text = address.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  return mapped ?? text;
}

/** This function gives the family of an IP address, or `undefined` for a text that is not an IP address. */
export function addressFamily(address: string): AddressFamily | undefined {
  const family = isIP(canonicalAddress(address));
  return family === 4 ? "ipv4" : family === 6 ? "ipv6" : undefined;
}

/** This function gives the CIDR range of a text, for example `192.0.2.0/24` or `2001:db8::/32`. An address alone is a range of one address. */
export function parseCidr(text: string): Result<Cidr, string> {
  const slash = text.indexOf("/");
  const address = canonicalAddress(slash === -1 ? text : text.slice(0, slash));
  const family = addressFamily(address);
  if (family === undefined) return err(`"${text}" is not an IP address or a CIDR range.`);
  const max = family === "ipv4" ? 32 : 128;
  const prefix = slash === -1 ? String(max) : text.slice(slash + 1).trim();
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > max) return err(`"${text}" has no prefix from 0 to ${max}.`);
  return ok({ address, prefix: Number(prefix), family });
}

/** This function gives the text of a CIDR range. */
export function formatCidr(cidr: Cidr): string {
  return `${cidr.address}/${cidr.prefix}`;
}

/** A set of CIDR ranges. */
export interface CidrSet {
  readonly ranges: readonly Cidr[];
  /** This function tells if an address is in a range of the set. A text that is not an IP address is in no set. */
  has(address: string): boolean;
}

/** This function gives the set of some CIDR ranges. */
export function cidrSet(ranges: readonly Cidr[]): CidrSet {
  const list = new BlockList();
  for (const range of ranges) list.addSubnet(range.address, range.prefix, range.family);
  return {
    ranges: [...ranges],
    has(address) {
      const host = canonicalAddress(address);
      const family = addressFamily(host);
      return family !== undefined && list.check(host, family);
    },
  };
}

/** This function tells if an address is in a CIDR range. */
export function cidrContains(cidr: Cidr, address: string): boolean {
  return cidrSet([cidr]).has(address);
}

let classSets: readonly { readonly class: Exclude<AddressClass, "public">; readonly set: CidrSet }[] | undefined;

function classes(): NonNullable<typeof classSets> {
  classSets ??= ADDRESS_CLASSES.map((entry) => {
    const range = parseCidr(entry.cidr);
    if (range.tag === "err") throw new Error(range.error);
    return { class: entry.class, set: cidrSet([range.value]) };
  });
  return classSets;
}

/** This function gives the class of an IP address, or `undefined` for a text that is not an IP address. */
export function addressClass(address: string): AddressClass | undefined {
  if (addressFamily(address) === undefined) return undefined;
  return classes().find((entry) => entry.set.has(address))?.class ?? "public";
}

/**
 * This function tells if the internet routes to an address. A `private` address is unspecified, loopback, private,
 * shared, link-local or unique-local. Each other address is `public`, also an address for documentation.
 */
export function addressKind(address: string): "public" | "private" | undefined {
  const found = addressClass(address);
  if (found === undefined) return undefined;
  return NOT_ROUTED.has(found) ? "private" : "public";
}
