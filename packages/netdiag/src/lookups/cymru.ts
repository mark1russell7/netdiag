/**
 * The data of the IP to ASN service of Team Cymru over DNS. A TXT query of the reversed address under a zone of the
 * service gives the BGP prefix of the address and the AS numbers that announce it.
 *
 * Each function is pure, and the module imports no module of Node. Thus a browser can read a record of a lookup.
 *
 * @packageDocumentation
 */
import { err, ok, type Result } from "@mark1russell7/optional";
import { truncate } from "@mark1russell7/text/length";
import { addressBytes, addressFamily, cidrContains, formatCidr, parseCidr, type AddressFamily, type Cidr } from "../address/index.ts";
import { MAX_REGISTRY_TEXT } from "./rdap.ts";

/** The DNS zones of the origin service of Team Cymru for each family of addresses. */
export const CYMRU_ZONES: Readonly<Record<AddressFamily, string>> = {
  ipv4: "origin.asn.cymru.com",
  ipv6: "origin6.asn.cymru.com",
};

/** The record of one origin of an address, from the TXT answer of Team Cymru. */
export interface CymruOrigin {
  /** The AS numbers that announce the prefix, in the order of the answer. */
  readonly originAs: readonly number[];
  /** The BGP prefix that holds the address, for example `216.90.108.0/24`. */
  readonly prefix: string;
  /** The regional registry of the prefix, for example `arin`. */
  readonly registry?: string | undefined;
  /** The country code of the record of the registry. Team Cymru tells that it is not a location of the address. */
  readonly country?: string | undefined;
  /** The date of the allocation, for example `1998-09-25`. */
  readonly allocated?: string | undefined;
}

/** The largest AS number: 32 bits (RFC 6793). */
const MAX_AS = 4_294_967_295;

/**
 * This function gives the name of the TXT query of the origin of an address.
 *
 * - For IPv4, the name has the 4 parts of the address in the reverse order, under `origin.asn.cymru.com`.
 * - For IPv6, the name has the 32 hexadecimal digits of the full address in the reverse order, under `origin6.asn.cymru.com`.
 *
 * A mapped IPv4 address gives the name of its IPv4 form. The function throws a `RangeError` for a text that is not an IP address.
 */
export function originQuery(address: string): string {
  const bytes = addressBytes(address);
  if (bytes === undefined) throw new RangeError(`"${address}" is not an IP address.`);
  if (bytes.length === 4) return [...[...bytes].reverse(), CYMRU_ZONES.ipv4].join(".");
  const digits = bytes.flatMap((byte) => [(byte >> 4).toString(16), (byte & 0xf).toString(16)]);
  return [...digits.reverse(), CYMRU_ZONES.ipv6].join(".");
}

/** The fields of one TXT record: the AS numbers, the prefix, the country, the registry and the date. */
type Fields = { readonly originAs: readonly number[]; readonly range: Cidr; readonly origin: CymruOrigin };

/** This function reads one TXT record of the format `AS numbers | prefix | country | registry | date`. */
function readRecord(text: string, address: string): Result<Fields, string> {
  const shown = JSON.stringify(truncate(text, MAX_REGISTRY_TEXT, { unit: "grapheme" }));
  const fields = text.split("|").map((field) => field.trim());
  if (fields.length !== 5) return err(`The TXT record ${shown} does not have 5 fields separated by "|".`);
  const [numbers = "", prefix = "", country = "", registry = "", allocated = ""] = fields;
  const words = numbers.split(/\s+/u).filter((word) => word !== "");
  if (words.length === 0 || !words.every((word) => /^\d{1,10}$/u.test(word) && Number(word) >= 1 && Number(word) <= MAX_AS)) {
    return err(`The TXT record ${shown} has no list of AS numbers from 1 to ${MAX_AS}.`);
  }
  const range = parseCidr(prefix);
  if (range.tag === "err" || !prefix.includes("/")) return err(`The TXT record ${shown} has no BGP prefix.`);
  if (!cidrContains(range.value, address)) return err(`The prefix ${formatCidr(range.value)} of the TXT record does not hold ${address}.`);
  if (country !== "" && !/^[A-Z]{2}$/u.test(country)) return err(`The TXT record ${shown} has no country code of 2 letters.`);
  if (registry !== "" && !/^[a-z]+$/u.test(registry)) return err(`The TXT record ${shown} has no name of a registry.`);
  if (allocated !== "" && !/^\d{4}-\d{2}-\d{2}$/u.test(allocated)) return err(`The TXT record ${shown} has no date in the form YYYY-MM-DD.`);
  const originAs = [...new Set(words.map(Number))];
  const origin: CymruOrigin = {
    originAs,
    prefix: formatCidr(range.value),
    ...(registry === "" ? {} : { registry }),
    ...(country === "" ? {} : { country }),
    ...(allocated === "" ? {} : { allocated }),
  };
  return ok({ originAs, range: range.value, origin });
}

/**
 * This function reads the TXT answer of Team Cymru for an address. Each TXT record is a list of strings, as
 * `resolveTxt` of `node:dns` gives it. The strings of one record join with no space.
 *
 * - Each record has the format `AS numbers | prefix | country | registry | date`. Spaces around a field do not change it.
 * - The prefix of each record must hold the address.
 * - With two or more records, the record with the longest prefix is the origin. The AS numbers of records with that prefix join.
 *
 * The function refuses an answer with no record, and an answer with a record that is not in this format.
 */
export function readOrigin(records: readonly (readonly string[])[], address: string): Result<CymruOrigin, string> {
  if (addressFamily(address) === undefined) return err(`"${address}" is not an IP address.`);
  if (records.length === 0) return err("The answer has no TXT record.");
  const read: Fields[] = [];
  for (const record of records) {
    const fields = readRecord(record.join(""), address);
    if (fields.tag === "err") return fields;
    read.push(fields.value);
  }
  const longest = Math.max(...read.map((fields) => fields.range.prefix));
  const best = read.filter((fields) => fields.range.prefix === longest);
  const first = best[0];
  if (first === undefined) return err("The answer has no TXT record.");
  const originAs = [...new Set(best.flatMap((fields) => fields.originAs))];
  return ok({ ...first.origin, originAs });
}
