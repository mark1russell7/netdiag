/**
 * The IP addresses and the networks of netdiag: the family and the class of an address, CIDR ranges and sets of ranges.
 *
 * This entry uses no module of Node, so a browser can import it. An IPv4 address in IPv6 form (`::ffff:192.0.2.1`) is
 * its IPv4 address.
 */
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

/** A part of an IPv4 address: a number from 0 to 255 with no zero before it. */
const IPV4_PART = /^(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
/** A group of an IPv6 address: 1 to 4 hexadecimal digits. */
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;
/** The zone of an IPv6 address after `%`, for example `eth0`. */
const IPV6_ZONE = /^[0-9a-z.:-]+$/i;

/** This function gives the 4 bytes of an IPv4 address in dotted form, or `undefined`. */
function ipv4Bytes(text: string): number[] | undefined {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every((part) => IPV4_PART.test(part))) return undefined;
  return parts.map(Number);
}

/** This function gives the 16-bit groups of one side of `::`, or `undefined`. Only the last side can end in IPv4 form. */
function ipv6Groups(side: string, last: boolean): number[] | undefined {
  if (side === "") return [];
  const parts = side.split(":");
  const groups: number[] = [];
  for (const [index, part] of parts.entries()) {
    if (last && index === parts.length - 1 && part.includes(".")) {
      const bytes = ipv4Bytes(part);
      if (bytes === undefined) return undefined;
      groups.push((bytes[0] ?? 0) * 256 + (bytes[1] ?? 0), (bytes[2] ?? 0) * 256 + (bytes[3] ?? 0));
    } else if (IPV6_GROUP.test(part)) groups.push(Number.parseInt(part, 16));
    else return undefined;
  }
  return groups;
}

/** This function gives the 16 bytes of an IPv6 address, or `undefined`. The zone after `%` does not change the bytes. */
function ipv6Bytes(text: string): number[] | undefined {
  const percent = text.indexOf("%");
  if (percent !== -1 && !IPV6_ZONE.test(text.slice(percent + 1))) return undefined;
  const sides = (percent === -1 ? text : text.slice(0, percent)).split("::");
  if (sides.length > 2) return undefined;
  const head = ipv6Groups(sides[0] ?? "", sides.length === 1);
  const tail = sides.length === 2 ? ipv6Groups(sides[1] ?? "", true) : [];
  if (head === undefined || tail === undefined) return undefined;
  const given = head.length + tail.length;
  if (sides.length === 1 ? given !== 8 : given > 7) return undefined;
  const groups = [...head, ...Array<number>(8 - given).fill(0), ...tail];
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

/** This function gives the bytes of an IP address: 4 for IPv4, 16 for IPv6, or `undefined` for a text that is not an address. */
function addressBytes(text: string): number[] | undefined {
  return ipv4Bytes(text) ?? (text.includes(":") ? ipv6Bytes(text) : undefined);
}

/**
 * This function gives the version of an IP address: 4, 6, or 0 for a text that is not an IP address. It gives the
 * value of `isIP` of `node:net` with no module of Node. It does not trim the text or remove brackets.
 */
export function ipVersion(text: string): 0 | 4 | 6 {
  const bytes = addressBytes(text);
  return bytes === undefined ? 0 : bytes.length === 4 ? 4 : 6;
}

/** This function gives the family of an IP address, or `undefined` for a text that is not an IP address. */
export function addressFamily(address: string): AddressFamily | undefined {
  const family = ipVersion(canonicalAddress(address));
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

/** The first 12 bytes of an IPv4 address in IPv6 form (`::ffff:0:0/96`). */
const MAPPED_PREFIX: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];

/** This function gives the forms of an address to compare with the ranges: the address, and its IPv4 or IPv6 form for a mapped address. */
function formsOf(bytes: readonly number[]): (readonly number[])[] {
  if (bytes.length === 4) return [bytes, [...MAPPED_PREFIX, ...bytes]];
  const mapped = MAPPED_PREFIX.every((byte, index) => bytes[index] === byte);
  return mapped ? [bytes, bytes.slice(12)] : [bytes];
}

/** This function tells if the first `prefix` bits of two addresses of the same length are equal. */
function samePrefix(a: readonly number[], b: readonly number[], prefix: number): boolean {
  if (a.length !== b.length) return false;
  for (let bit = 0; bit < prefix; bit += 8) {
    const mask = prefix - bit >= 8 ? 0xff : (0xff << (8 - (prefix - bit))) & 0xff;
    if (((a[bit / 8] ?? 0) & mask) !== ((b[bit / 8] ?? 0) & mask)) return false;
  }
  return true;
}

/**
 * This function gives the set of some CIDR ranges. An IPv4 address is also in an IPv6 range that holds its IPv6 form
 * (`::ffff:192.0.2.1`), and the reverse, as for `BlockList` of `node:net`. The zone of an IPv6 address does not change it.
 */
export function cidrSet(ranges: readonly Cidr[]): CidrSet {
  const networks = ranges.flatMap((range) => {
    const bytes = addressBytes(range.address);
    return bytes === undefined ? [] : [{ bytes, prefix: range.prefix }];
  });
  return {
    ranges: [...ranges],
    has(address) {
      const bytes = addressBytes(canonicalAddress(address));
      if (bytes === undefined) return false;
      const forms = formsOf(bytes);
      return networks.some((network) => forms.some((form) => samePrefix(form, network.bytes, network.prefix)));
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
