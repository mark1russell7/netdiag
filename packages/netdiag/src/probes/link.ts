import { networkInterfaces } from "node:os";
import { canonicalAddress, cidrContains, parseCidr } from "../address/index.ts";
import { observe } from "../fact.ts";
import { LINK_STATE, type LinkInterface, type LinkState } from "../kinds.ts";
import { defineProbe, type Availability, type Probe } from "../probe.ts";
import { target } from "../target.ts";

// The link probe reads the interfaces of this computer. It sends no packet, so it needs no grant.
//
// Node.js reads the interfaces through libuv. On Linux and macOS, libuv lists only the interfaces with the flags IFF_UP
// and IFF_RUNNING. On Windows, it lists only the adapters with the state IfOperStatusUp. Thus an interface with no
// carrier, or a Wi-Fi adapter with no network, is not in the list.

/** One address of an interface, with the fields of `os.networkInterfaces()` that the link probe reads. */
export interface InterfaceAddress {
  readonly address: string;
  /** The address and the length of its prefix, for example `192.168.1.20/24`. It is `null` for a netmask that is not valid. */
  readonly cidr: string | null;
  readonly internal: boolean;
}

/** The interfaces of this computer by name, in the form of `os.networkInterfaces()`. */
export type InterfaceTable = Readonly<Record<string, readonly InterfaceAddress[] | undefined>>;

/** The input of the link probe. */
export interface LinkInput {
  /** The IP address of the default gateway. The state is `up` when an interface that is up has it in its network. */
  readonly gateway?: string | undefined;
}

/** The raw output of the link probe: the interfaces that it read, and the times of the read. */
export interface LinkRaw {
  readonly interfaces: readonly LinkInterface[];
  readonly gateway?: string | undefined;
  readonly start: number;
  readonly end: number;
}

/** The subject of a link fact with no gateway: this computer. */
export const LINK_SUBJECT = "localhost";

/** This function gives the interfaces of a table that are not loopback, each with the CIDR ranges of its addresses. */
export function upInterfaces(table: InterfaceTable): LinkInterface[] {
  const interfaces: LinkInterface[] = [];
  for (const [name, addresses] of Object.entries(table)) {
    const external = (addresses ?? []).filter((entry) => !entry.internal);
    if (external.length === 0) continue;
    interfaces.push({ name, addresses: external.map((entry) => entry.cidr ?? canonicalAddress(entry.address)) });
  }
  return interfaces.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * This function gives the interface that has the gateway in its network, or `undefined`. A gateway with a zone, for
 * example `fe80::1%eth0`, is on the interface of its zone.
 */
export function interfaceOf(interfaces: readonly LinkInterface[], gateway: string): string | undefined {
  const percent = gateway.indexOf("%");
  if (percent !== -1) {
    const zone = gateway.slice(percent + 1);
    return interfaces.some((entry) => entry.name === zone) ? zone : undefined;
  }
  for (const entry of interfaces) {
    for (const text of entry.addresses) {
      const range = parseCidr(text);
      if (range.tag === "ok" && cidrContains(range.value, gateway)) return entry.name;
    }
  }
  return undefined;
}

/** This function gives the link state of the interfaces that are up, to a gateway or to any network. */
export function linkStateOf(interfaces: readonly LinkInterface[], gateway?: string): LinkState {
  if (gateway === undefined) return { state: interfaces.length > 0 ? "up" : "down", interfaces };
  const via = interfaceOf(interfaces, gateway);
  return via === undefined ? { state: "down", interfaces, gateway } : { state: "up", interfaces, gateway, via };
}

const NATIVE: Availability = { available: true, version: process.versions.node };

/**
 * This function gives the link probe. The probe reads the interfaces from `read`, and the default is
 * `os.networkInterfaces()`. A test gives a table.
 */
export function linkProbe(read: () => InterfaceTable = networkInterfaces): Probe<LinkInput, LinkRaw> {
  return defineProbe<LinkInput, LinkRaw>({
    id: "link.state",
    version: "1",
    summary: "The interfaces of this computer that are up, and the interface of the network of the gateway.",
    layer: "link",
    mode: "passive",
    kinds: [LINK_STATE],
    peers: () => [],
    available: () => Promise.resolve(NATIVE),
    run(input, context) {
      const start = context.clock.now();
      const interfaces = upInterfaces(read());
      return Promise.resolve({ interfaces, ...(input.gateway === undefined ? {} : { gateway: input.gateway }), start, end: context.clock.now() });
    },
    parse(raw) {
      const state = linkStateOf(raw.interfaces, raw.gateway);
      return [observe(LINK_STATE, target(raw.gateway ?? LINK_SUBJECT), state, { start: raw.start, end: raw.end })];
    },
  });
}

/** The link probe on `os.networkInterfaces()`. */
export const LINK_PROBE: Probe<LinkInput, LinkRaw> = linkProbe();
