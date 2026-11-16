import { addressFamily, canonicalAddress, ipVersion, type AddressFamily } from "../address/index.ts";

// The parts that the adapters share. The entry `@mark1russell7/netdiag/tools` does not export this module.

/** The environment that makes the output of a tool English on Linux and macOS. */
export const ENGLISH: Readonly<Record<string, string>> = { LC_ALL: "C" };

/** The end of a line of output, on each operating system. */
export const LINES: RegExp = /\r?\n/;

/** The messages of a local send that tell that the address is unreachable, on Linux and macOS. */
export const LOCAL_UNREACHABLE: RegExp = /\b(Network is unreachable|No route to host|Host is down|Network is down)\b/i;

/** The IP address of a probe of an outside tool: its canonical form and its family. */
export interface ToolAddress {
  readonly address: string;
  readonly family: AddressFamily;
}

/**
 * This function gives the canonical form and the family of an IP address. It throws a `TypeError` for a name, because
 * an adapter sends probes only to an address.
 */
export function toolAddress(address: string): ToolAddress {
  const family = addressFamily(address);
  if (family === undefined) throw new TypeError(`"${address}" is not an IP address. Get the addresses of a name with the DNS probe first.`);
  return { address: canonicalAddress(address), family };
}

/** This function throws a `RangeError` when a value is not an integer from `min` to `max`. It gives the value. */
export function integerIn(value: number, min: number, max: number, what: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${value} is not ${what} from ${min} to ${max}.`);
  return value;
}

/** This function tells if two IP addresses are the same address. */
export function sameAddress(a: string, b: string): boolean {
  return canonicalAddress(a) === canonicalAddress(b);
}

/** This function gives the first line of a text that is not empty, with no spaces at its ends. */
export function firstLine(text: string): string | undefined {
  return text
    .split(LINES)
    .find((line) => line.trim().length > 0)
    ?.trim();
}

/** This function removes the `:` or `,` after an address in a line of ping. An IPv6 address keeps its own last `:`. */
export function withoutSeparator(text: string): string {
  return ipVersion(text) === 0 ? text.replace(/[:,]$/, "") : text;
}
