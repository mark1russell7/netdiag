/**
 * The data of RDAP, the registration data access protocol of the regional internet registries (RFC 9082, RFC 9083).
 * The bootstrap files of IANA (RFC 9224) give the registry of each range of addresses.
 *
 * Each function is pure, and the module imports no module of Node. Thus a browser can read a record of a lookup.
 *
 * @packageDocumentation
 */
import { err, ok, type Result } from "@mark1russell7/optional";
import { truncate } from "@mark1russell7/text/length";
import { addressFamily, canonicalAddress, cidrContains, formatCidr, parseCidr, type AddressFamily, type Cidr } from "../address/index.ts";
import { isRecord } from "../fact.ts";
import type { OwnerNetwork } from "../kinds.ts";

/** The URLs of the RDAP bootstrap files of IANA for the IP addresses (RFC 9224). */
export const RDAP_BOOTSTRAP: Readonly<Record<AddressFamily, string>> = {
  ipv4: "https://data.iana.org/rdap/ipv4.json",
  ipv6: "https://data.iana.org/rdap/ipv6.json",
};

/** The hosts of the RDAP servers of the five regional internet registries: ARIN, RIPE NCC, APNIC, LACNIC and AFRINIC. */
export const RDAP_REGISTRIES: readonly string[] = ["rdap.arin.net", "rdap.db.ripe.net", "rdap.apnic.net", "rdap.lacnic.net", "rdap.afrinic.net"];

/** The largest length of a text of a registry in a fact, in graphemes. */
export const MAX_REGISTRY_TEXT = 200;

/** One service of a bootstrap file: the ranges of addresses and the base URLs of their RDAP server. */
export interface RdapService {
  readonly ranges: readonly Cidr[];
  readonly urls: readonly string[];
}

/** A bootstrap file of IANA for one family of addresses. */
export interface RdapBootstrap {
  readonly family: AddressFamily;
  /** The time of the publication of the file, for example `2026-11-03T22:00:01Z`. */
  readonly publication?: string | undefined;
  readonly services: readonly RdapService[];
}

function isTextList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * This function reads a bootstrap file of IANA for one family of addresses. Each service of the file is a pair: a list
 * of CIDR ranges and a list of base URLs. The function refuses a file with a range of the other family.
 */
export function readBootstrap(text: string, family: AddressFamily): Result<RdapBootstrap, string> {
  const name = family === "ipv4" ? "IPv4" : "IPv6";
  const value = parseJson(text);
  if (!isRecord(value) || !Array.isArray(value["services"])) return err(`The bootstrap of ${name} is not a JSON object with a list of services.`);
  const services: RdapService[] = [];
  for (const service of value["services"] as readonly unknown[]) {
    if (!Array.isArray(service) || service.length < 2 || !isTextList(service[0]) || !isTextList(service[1])) {
      return err(`A service of the bootstrap of ${name} is not a pair of a list of ranges and a list of URLs.`);
    }
    const ranges: Cidr[] = [];
    for (const text of service[0]) {
      const range = parseCidr(text);
      if (range.tag === "err" || range.value.family !== family) return err(`The bootstrap of ${name} has the range "${truncate(text, 60)}", which is not an ${name} range.`);
      ranges.push(range.value);
    }
    services.push({ ranges, urls: [...service[1]] });
  }
  const publication = typeof value["publication"] === "string" ? value["publication"] : undefined;
  return ok({ family, publication, services });
}

/** This function gives the service of the longest range that holds an address, or `undefined` when no range holds it. */
export function serviceFor(bootstrap: RdapBootstrap, address: string): RdapService | undefined {
  let best: { readonly service: RdapService; readonly prefix: number } | undefined;
  for (const service of bootstrap.services) {
    for (const range of service.ranges) {
      if ((best === undefined || range.prefix > best.prefix) && cidrContains(range, address)) best = { service, prefix: range.prefix };
    }
  }
  return best?.service;
}

/** This function gives the first base URL of a service with the scheme `https`. netdiag sends no lookup without TLS. */
export function secureBase(service: RdapService): URL | undefined {
  for (const text of service.urls) {
    if (!URL.canParse(text)) continue;
    const url = new URL(text);
    if (url.protocol === "https:") return url;
  }
  return undefined;
}

/** This function gives the URL of the query of the network of an address: the path `ip/<address>` under the base URL (RFC 9082). */
export function networkQuery(base: URL, address: string): URL {
  const path = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return new URL(`${path}ip/${canonicalAddress(address)}`, base.origin);
}

/** This function gives a text of a registry with no control characters, with one space between words, and with `MAX_REGISTRY_TEXT` graphemes or fewer. */
function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/gu, " ").trim();
  return text === "" ? undefined : truncate(text, MAX_REGISTRY_TEXT, { unit: "grapheme" });
}

/** This function gives the `fn` of a vCard in the form `jCard` (RFC 7095): `["vcard", [[name, parameters, type, value], ...]]`. */
function fullName(vcard: unknown): string | undefined {
  if (!Array.isArray(vcard) || vcard[0] !== "vcard" || !Array.isArray(vcard[1])) return undefined;
  for (const property of vcard[1] as readonly unknown[]) {
    if (Array.isArray(property) && property[0] === "fn") return clean(property[3]);
  }
  return undefined;
}

/** This function gives the name of the first entity with the role `registrant`, at the top level or one level down. */
function registrant(entities: unknown, depth = 0): string | undefined {
  if (!Array.isArray(entities)) return undefined;
  for (const entity of entities as readonly unknown[]) {
    if (isRecord(entity) && isTextList(entity["roles"]) && entity["roles"].includes("registrant")) {
      const name = fullName(entity["vcardArray"]);
      if (name !== undefined) return name;
    }
  }
  if (depth > 0) return undefined;
  for (const entity of entities as readonly unknown[]) {
    const name = isRecord(entity) ? registrant(entity["entities"], depth + 1) : undefined;
    if (name !== undefined) return name;
  }
  return undefined;
}

/**
 * This function gives the first line of the description of a network. A remark with the title `description` comes
 * first, as APNIC gives it. Then comes a remark with no title, as RIPE NCC gives the `descr` of a network.
 */
function descriptionOf(remarks: unknown): string | undefined {
  if (!Array.isArray(remarks)) return undefined;
  const notes = (remarks as readonly unknown[]).filter(isRecord);
  const titled = notes.find((note) => typeof note["title"] === "string" && note["title"].toLowerCase() === "description");
  const untitled = notes.find((note) => note["title"] === undefined);
  for (const note of [titled, untitled]) {
    const lines = note?.["description"];
    if (!isTextList(lines)) continue;
    for (const line of lines) {
      const text = clean(line);
      if (text !== undefined) return text;
    }
  }
  return undefined;
}

/** This function gives the CIDR ranges of the extension `cidr0`: `[{ "v4prefix": "192.0.2.0", "length": 24 }]`. */
function cidrsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as readonly unknown[]).flatMap((item) => {
    if (!isRecord(item)) return [];
    const prefix = item["v4prefix"] ?? item["v6prefix"];
    const length = item["length"];
    if (typeof prefix !== "string" || typeof length !== "number") return [];
    const range = parseCidr(`${prefix}/${length}`);
    return range.tag === "ok" ? [formatCidr(range.value)] : [];
  });
}

function isAsNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4_294_967_295;
}

/**
 * This function reads the RDAP object of an IP network (RFC 9083, section 5.4). The object has the class `ip network`,
 * a handle, and a first and a last address. Each other field is optional. A text of the registry gets no control
 * characters and `MAX_REGISTRY_TEXT` graphemes or fewer.
 */
export function readNetwork(text: string): Result<OwnerNetwork, string> {
  const value = parseJson(text);
  if (!isRecord(value)) return err("The body is not a JSON object.");
  if (value["objectClassName"] !== "ip network") return err("The body is not an RDAP object of the class \"ip network\".");
  const handle = clean(value["handle"]);
  const start = typeof value["startAddress"] === "string" ? canonicalAddress(value["startAddress"]) : "";
  const end = typeof value["endAddress"] === "string" ? canonicalAddress(value["endAddress"]) : "";
  if (handle === undefined) return err("The network has no handle.");
  if (addressFamily(start) === undefined || addressFamily(end) === undefined) return err(`The network ${handle} has no valid first and last address.`);
  const country = clean(value["country"]);
  const origins = value["arin_originas0_originautnums"];
  return ok({
    handle,
    name: clean(value["name"]),
    start,
    end,
    cidrs: cidrsOf(value["cidr0_cidrs"]),
    holder: registrant(value["entities"]),
    description: descriptionOf(value["remarks"]),
    country: country !== undefined && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined,
    originAs: Array.isArray(origins) ? [...new Set((origins as readonly unknown[]).filter(isAsNumber))] : [],
  });
}
