import { ipVersion } from "./address/index.ts";
import { err, ok, type Result } from "@mark1russell7/optional";

/** The kind of the host of a target: a DNS name, an IPv4 address or an IPv6 address. */
export type HostKind = "name" | "ipv4" | "ipv6";

/**
 * A host that a probe examines, and an optional port.
 *
 * The host is in its canonical form: lower case, with no final dot and no brackets around an IPv6 address.
 */
export interface Target {
  readonly host: string;
  readonly kind: HostKind;
  readonly port?: number | undefined;
}

/** The ports of the URL schemes that a target can have. */
const SCHEME_PORTS: ReadonlyMap<string, number> = new Map([
  ["http:", 80],
  ["https:", 443],
  ["ws:", 80],
  ["wss:", 443],
  ["dns:", 53],
  ["tls:", 443],
]);

/** This function gives the kind of a host in its canonical form. */
export function hostKind(host: string): HostKind {
  const family = ipVersion(host);
  if (family === 4) return "ipv4";
  if (family === 6) return "ipv6";
  return "name";
}

/** This function gives the canonical form of a host: lower case, with no final dot and no brackets. */
export function canonicalHost(host: string): string {
  let text = host.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  if (text.endsWith(".")) text = text.slice(0, -1);
  return text;
}

/** This function makes a target from a host and an optional port. */
export function target(host: string, port?: number): Target {
  const canonical = canonicalHost(host);
  return port === undefined ? { host: canonical, kind: hostKind(canonical) } : { host: canonical, kind: hostKind(canonical), port };
}

/** This function gives the text of a target: `host`, `host:port`, or `[address]:port` for an IPv6 address. */
export function formatTarget(t: Target): string {
  const host = t.kind === "ipv6" && t.port !== undefined ? `[${t.host}]` : t.host;
  return t.port === undefined ? host : `${host}:${t.port}`;
}

/** This function tells if two targets have the same host and the same port. */
export function sameTarget(a: Target, b: Target): boolean {
  return a.host === b.host && a.port === b.port;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function validName(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  return host.split(".").every((label) => LABEL.test(label) || label === "_" || /^_[a-z0-9-]{1,62}$/.test(label));
}

function portOf(text: string): number | undefined {
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : undefined;
}

/**
 * This function reads a target from the text that a user gives.
 *
 * It accepts a URL (`https://example.com/a`), a host (`example.com`) and a host with a port (`example.com:8443`).
 * It also accepts an IPv4 address, and an IPv6 address in brackets with a port (`[2001:db8::1]:443`).
 * A URL with a known scheme and no port gets the port of its scheme.
 */
export function parseTarget(text: string): Result<Target, string> {
  const input = text.trim();
  if (input.length === 0) return err("The target is empty.");
  if (input.includes("://")) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return err(`"${input}" is not a valid URL.`);
    }
    const host = canonicalHost(url.hostname);
    if (host.length === 0) return err(`The URL "${input}" has no host.`);
    const port = url.port === "" ? SCHEME_PORTS.get(url.protocol) : Number(url.port);
    return checked(host, port, input);
  }
  if (ipVersion(input) === 6) return checked(canonicalHost(input), undefined, input);
  const bracket = /^\[([^\]]+)\](?::(.*))?$/.exec(input);
  if (bracket !== null) {
    const host = bracket[1] ?? "";
    if (ipVersion(host) !== 6) return err(`"${host}" is not an IPv6 address.`);
    if (bracket[2] === undefined) return checked(canonicalHost(host), undefined, input);
    const port = portOf(bracket[2]);
    return port === undefined ? err(`"${bracket[2]}" is not a port from 1 to 65535.`) : checked(canonicalHost(host), port, input);
  }
  const colon = input.lastIndexOf(":");
  if (colon === -1) return checked(canonicalHost(input), undefined, input);
  const port = portOf(input.slice(colon + 1));
  if (port === undefined) return err(`"${input.slice(colon + 1)}" is not a port from 1 to 65535.`);
  return checked(canonicalHost(input.slice(0, colon)), port, input);
}

function checked(host: string, port: number | undefined, input: string): Result<Target, string> {
  const kind = hostKind(host);
  if (kind === "name" && !validName(host)) return err(`"${input}" has no valid host name.`);
  return ok(port === undefined ? { host, kind } : { host, kind, port });
}
