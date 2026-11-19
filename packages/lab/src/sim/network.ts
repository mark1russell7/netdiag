import type { Reach } from "@mark1russell7/netdiag/core";
import type { Random } from "@mark1russell7/rigor-generators";
import type { ParamValue } from "@mark1russell7/strategy-space";
import { PORTAL_NAME, PROXY_DELAY_MS, REFERENCE_NAME, TARGET_NAME } from "../cases.ts";
import { faultValues, faultsOf, type FaultPlace, type FaultTerm } from "../grammar.ts";

// The model of the simulated world of the lab (ND-17, the layer E0). It is not real software. It computes the fate of
// each packet from the faults of a term, and the tools and the probes of `tools.ts` and `probes.ts` give that fate
// in the form of real output. Thus the parsers, the readers and the diagnosis of netdiag operate unchanged.
// The kernel lab (E1) examines the same faults on real software.

/** The family of an address. */
export type Family = 4 | 6;

/** The medium of the link of the client. */
export type Medium = "wired" | "wifi";

/** The end of a path: the host that answers. */
export type End = "target" | "reference" | "gateway" | "portal" | "resolver";

/** One fault of a term at its place, with the value of each active param. */
export interface PlacedFault {
  readonly option: string;
  readonly place: FaultPlace;
  readonly values: Readonly<Record<string, ParamValue>>;
}

/** The setup of one simulated world: the term of its faults, the medium of the client, and if the world has IPv6. */
export interface SimSetup {
  readonly term: FaultTerm;
  readonly medium: Medium;
  readonly ipv6: boolean;
  /**
   * The epoch of the roots of the certificate authorities. A root changes from one epoch to the next, as when an authority
   * moves to a new root. The default is 0.
   */
  readonly epoch?: number | undefined;
}

/** The addresses of each host of the world, for each family. */
export type SimAddresses = Readonly<Record<"client" | "gateway" | "provider" | "resolver" | "portal" | "transit" | "remote" | "target" | "referenceTransit" | "referenceRemote" | "reference", Readonly<Record<Family, string>>>>;

/** The addresses of the simulated world. They are in the ranges for documentation and for private networks. */
export const SIM_ADDRESSES: SimAddresses = {
  client: { 4: "192.168.1.20", 6: "2001:db8:1::20" },
  gateway: { 4: "192.168.1.1", 6: "2001:db8:1::1" },
  provider: { 4: "100.64.0.1", 6: "2001:db8:ff::1" },
  resolver: { 4: "100.64.0.53", 6: "2001:db8:ff::53" },
  portal: { 4: "10.64.0.1", 6: "2001:db8:ff::80" },
  transit: { 4: "192.0.2.33", 6: "2001:db8:fe::1" },
  remote: { 4: "203.0.113.1", 6: "2001:db8:10::1" },
  target: { 4: "203.0.113.10", 6: "2001:db8:10::10" },
  referenceTransit: { 4: "192.0.2.65", 6: "2001:db8:fd::1" },
  referenceRemote: { 4: "198.51.100.1", 6: "2001:db8:20::1" },
  reference: { 4: "198.51.100.20", 6: "2001:db8:20::20" },
};

/** The ranges of the grants of a visit of the simulated world. */
export const SIM_RANGES: readonly string[] = ["192.168.1.0/24", "100.64.0.0/10", "10.0.0.0/8", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32"];

/** One hop of a path: its place, its delay in one direction, and the router at its end. */
export interface Hop {
  /** The place of the hop. A hop of the reference path after the provider has no place, so no fault of a term is on it. */
  readonly place: FaultPlace | undefined;
  readonly ms: number;
  readonly router?: Readonly<Record<Family, string>> | undefined;
}

/** The delay of the link of the client in one direction, for each medium. */
export const LINK_MS: Readonly<Record<Medium, number>> = { wired: 0.3, wifi: 2 };

/** The largest jitter of one hop in ms. The radio link has more jitter than a cable. */
const JITTER_MS: Readonly<Record<Medium, number>> = { wired: 0.05, wifi: 1.5 };

function sharedHops(medium: Medium): Hop[] {
  return [
    { place: "host", ms: 0 },
    { place: "link", ms: LINK_MS[medium] },
    { place: "lan", ms: 0.4 },
    { place: "gateway", ms: 0.3, router: SIM_ADDRESSES.gateway },
    { place: "provider", ms: 6, router: SIM_ADDRESSES.provider },
  ];
}

/** This function gives the hops of the path from the client to an end. */
export function pathOf(end: End, medium: Medium): readonly Hop[] {
  const shared = sharedHops(medium);
  switch (end) {
    case "target":
      return [...shared, { place: "transit", ms: 12, router: SIM_ADDRESSES.transit }, { place: "remote", ms: 15, router: SIM_ADDRESSES.remote }, { place: "server", ms: 0.5 }];
    case "reference":
      return [...shared, { place: undefined, ms: 9, router: SIM_ADDRESSES.referenceTransit }, { place: undefined, ms: 8, router: SIM_ADDRESSES.referenceRemote }, { place: undefined, ms: 0.5 }];
    case "gateway":
      return shared.slice(0, 4);
    case "portal":
    case "resolver":
      return shared;
  }
}

/**
 * The options whose fault the world applies only to the connections of the target. Each check of `SimNetwork` that
 * stops early for an end that is not the target names its option here.
 */
export const TARGET_ONLY_OPTIONS: ReadonlySet<string> = new Set(["tls/expire", "tls/wrong", "tls/mismatch", "tcp/refuse", "http/delay", "http/refuse"]);

/**
 * This function gives the reach of a fault in the world: the ends whose observations the fault changes.
 *
 * - A fault at a hop of the path to the gateway is shared. A fault of the resolver changes each lookup, so it is shared too.
 * - A fault at a hop of the path to the reference past the gateway is upstream.
 * - A fault at each other place, or of `TARGET_ONLY_OPTIONS`, changes only the target.
 */
export function simReach(option: string, place: FaultPlace): Reach {
  if (TARGET_ONLY_OPTIONS.has(option)) return "target";
  if (place === "resolver" || pathOf("gateway", "wired").some((hop) => hop.place === place)) return "shared";
  return pathOf("reference", "wired").some((hop) => hop.place === place) ? "upstream" : "target";
}

/** This function gives the round trip time of a path with no jitter and no fault. The bands of `cases.ts` use it. */
export function baseRtt(end: End, medium: Medium): number {
  return 2 * pathOf(end, medium).reduce((sum, hop) => sum + hop.ms, 0);
}

/** A packet of a flow. */
export interface Packet {
  readonly end: End;
  readonly family: Family;
  readonly kind: "echo" | "syn" | "data" | "dns";
  readonly size: number;
  /** The packet has the flag "do not fragment". TCP sets it, and ping sets it with `-M do`. */
  readonly df: boolean;
}

/**
 * The fate of a packet on its way in one direction. The time `ms` of an error starts at the send. It ends when the
 * ICMP message or the RST arrives at the client.
 */
export type Fate =
  | { readonly fate: "arrive"; readonly ms: number }
  | { readonly fate: "lost" }
  | { readonly fate: "unreachable"; readonly from: string; readonly code: "host" | "net" | "no-route"; readonly ms: number }
  | { readonly fate: "too-big"; readonly from: string; readonly mtu: number; readonly ms: number }
  | { readonly fate: "reset"; readonly from: string; readonly ms: number };

/** The time that a router waits for the link address of an absent host before it sends "host unreachable". */
export const ARP_WAIT_MS = 3000;

/** The time in ms that a server takes for its part of a TLS handshake, and for the head of an HTTP response. */
export const SERVER_TLS_MS = 2;
export const SERVER_HTTP_MS = 10;

/** The certificate problems of a TLS fault. */
export type CertFault = "expired" | "name" | "untrusted";

/** The TLS proxy on the path of a connection: the index of the hop where it ends the connection. */
export interface ProxyAt {
  readonly hop: number;
  /** The proxy answers with this HTTP status, in place of the server. */
  readonly status?: number | undefined;
}

const share = (values: PlacedFault["values"]): number => Number(values["share"] ?? 0);

/** This function gives the faults of a term, each at its place. */
export function placedFaults(term: FaultTerm): readonly PlacedFault[] {
  return faultsOf(term).map((choice) => {
    const values = faultValues(choice);
    return { option: choice.option, place: values["place"] as FaultPlace, values };
  });
}

/** The family of a param `family` of a fault. */
function familyOf(values: PlacedFault["values"]): Family {
  return values["family"] === "ipv6" ? 6 : 4;
}

/**
 * The simulated network of one visit. The random source gives the loss, the jitter and the draws of each fault. For one
 * setup and one seed, the visit gets the same output each time.
 */
export class SimNetwork {
  readonly faults: readonly PlacedFault[];
  readonly setup: SimSetup;
  private readonly random: Random;
  /** The draws of the share of each fault in the visit, and the draws where the fault acted. */
  private readonly tally = new Map<PlacedFault, { draws: number; acts: number }>();

  constructor(setup: SimSetup, random: Random) {
    this.setup = setup;
    this.random = random;
    this.faults = placedFaults(setup.term);
  }

  /**
   * This method draws if a fault with a share acts on one packet, query, connection or request, and it records the
   * draw. The share is the probability of an act.
   */
  private act(fault: PlacedFault): boolean {
    const acted = this.random.chance(share(fault.values));
    this.record(fault, acted);
    return acted;
  }

  private record(fault: PlacedFault, acted: boolean): void {
    const count = this.tally.get(fault) ?? { draws: 0, acts: 0 };
    this.tally.set(fault, { draws: count.draws + 1, acts: count.acts + (acted ? 1 : 0) });
  }

  /**
   * This method gives the faults that passed each of their draws in the visit. Such a fault gave no sign, so no diagnosis
   * of the visit can name it. A fault with no draw acts on each packet that gets to it, so it is not silent.
   */
  silent(): readonly PlacedFault[] {
    return this.faults.filter((fault) => {
      const count = this.tally.get(fault);
      return count !== undefined && count.acts === 0;
    });
  }

  /** This method tells if the term has a fault of the option, at one of the places when the list is not empty. */
  has(option: string, ...places: readonly FaultPlace[]): PlacedFault | undefined {
    return this.faults.find((each) => each.option === option && (places.length === 0 || places.includes(each.place)));
  }

  private at(place: FaultPlace | undefined): readonly PlacedFault[] {
    return place === undefined ? [] : this.faults.filter((each) => each.place === place);
  }

  /** The interface of the client is down at the host: the driver stopped, so the host has no route. */
  get adminDown(): boolean {
    return this.has("link/down", "host") !== undefined;
  }

  /** The link of the client has no carrier: the cable is out, or the port of the switch is down. */
  get carrierDown(): boolean {
    return this.has("link/down", "link", "lan") !== undefined;
  }

  /** This method tells why the client cannot send to a family, or `undefined` when it can. */
  localError(family: Family): string | undefined {
    if (this.adminDown) return "Network is unreachable";
    if (family === 6 && !this.setup.ipv6) return "Network is unreachable";
    return undefined;
  }

  /** The address of a host for a family, or `undefined` when the world has no address of that family. */
  addressOf(end: Exclude<End, "resolver">, family: Family): string | undefined {
    if (family === 6 && (!this.setup.ipv6 || end === "portal")) return undefined;
    if (end === "portal") return this.portalAt() === "gateway" ? SIM_ADDRESSES.gateway[4] : SIM_ADDRESSES.portal[4];
    return SIM_ADDRESSES[end][family];
  }

  /** The end of an address, or `undefined` for an address that is not in the world. */
  endOf(address: string): End | undefined {
    const portal = this.portalAt();
    if (portal === "gateway" && address === SIM_ADDRESSES.gateway[4]) return "portal";
    if (portal === "provider" && address === SIM_ADDRESSES.portal[4]) return "portal";
    for (const end of ["target", "reference", "gateway"] as const) {
      if (SIM_ADDRESSES[end][4] === address || SIM_ADDRESSES[end][6] === address) return end;
    }
    return undefined;
  }

  /** The place of the captive portal, or `undefined` when the term has none. */
  portalAt(): "gateway" | "provider" | undefined {
    const portal = this.has("http/intercept", "gateway", "provider");
    return portal === undefined ? undefined : (portal.place as "gateway" | "provider");
  }

  /** The hops of the path to an end. The portal of the gateway is at the end of the hop of the gateway. */
  hops(end: End): readonly Hop[] {
    const hops = pathOf(end, this.setup.medium);
    return end === "portal" && this.portalAt() === "gateway" ? hops.slice(0, 4) : hops;
  }

  private jitter(hop: Hop): number {
    return hop.place === "link" ? this.random.range(0, JITTER_MS[this.setup.medium]) : this.random.range(0, JITTER_MS.wired);
  }

  /** The router that sends the ICMP messages of a hop: the router of the hop, or the router of the nearest hop before it. */
  private routerOf(hops: readonly Hop[], index: number, family: Family): string {
    for (let i = index; i >= 0; i--) {
      const router = hops[i]?.router;
      if (router !== undefined) return router[family];
    }
    return SIM_ADDRESSES.gateway[family];
  }

  /** This method tells if a filter drops the ICMP messages "packet too big" of a family. */
  private tooBigDropped(family: Family): boolean {
    return this.faults.some((each) => each.option === "path/filter" && each.values["kind"] === "icmp-too-big" && familyOf(each.values) === family);
  }

  /**
   * This method gives the fate of a packet on the hops `from` to `to` (both included), in the direction `out` (to the end)
   * or `back` (to the client). The hops are in the order of the path from the client.
   */
  walk(packet: Packet, hops: readonly Hop[], direction: "out" | "back", from: number = 0, to: number = hops.length - 1): Fate {
    const order: number[] = [];
    if (direction === "out") for (let i = from; i <= to; i++) order.push(i);
    else for (let i = to; i >= from; i--) order.push(i);
    let ms = 0;
    for (const index of order) {
      const hop = hops[index];
      if (hop === undefined) continue;
      ms += hop.ms + this.jitter(hop);
      for (const fault of this.at(hop.place)) {
        const fate = this.faultFate(fault, packet, hops, index, direction, ms);
        if (fate !== undefined) return fate;
      }
    }
    return { fate: "arrive", ms };
  }

  /** The fate of a packet at one fault of its hop, or `undefined` when the fault does not change the packet. */
  private faultFate(fault: PlacedFault, packet: Packet, hops: readonly Hop[], index: number, direction: "out" | "back", ms: number): Fate | undefined {
    const toTarget = packet.end === "target";
    switch (fault.option) {
      case "route/down":
      case "link/down":
        return { fate: "lost" };
      case "wifi/loss":
        return fault.values["kind"] === "multicast" ? undefined : this.act(fault) ? { fate: "lost" } : undefined;
      case "path/loss": {
        const way = fault.values["direction"];
        const applies = way === "both" || way === direction;
        return applies && this.act(fault) ? { fate: "lost" } : undefined;
      }
      case "ip/filter":
        return toTarget && packet.kind === "echo" ? { fate: "lost" } : undefined;
      case "tcp/filter":
        // A client of Linux asks for no ECN by default (`tcp_ecn` = 2), so a filter of the ECN flags does not drop its SYN.
        return toTarget && fault.values["kind"] === "port" && (packet.kind === "syn" || packet.kind === "data") ? { fate: "lost" } : undefined;
      case "ip/missing":
        return packet.family === 6 && direction === "out" && packet.end !== "gateway" ? { fate: "unreachable", from: this.routerOf(hops, index, 6), code: "no-route", ms: 2 * ms } : undefined;
      case "path/size": {
        const mtu = Number(fault.values["mtu"]);
        if (familyOf(fault.values) !== packet.family || packet.size <= mtu || !packet.df) return undefined;
        return this.tooBigDropped(packet.family) ? { fate: "lost" } : { fate: "too-big", from: this.routerOf(hops, index, packet.family), mtu, ms: 2 * ms };
      }
      case "ip/down":
        return toTarget && direction === "out" && hops[index]?.place === "server" ? { fate: "unreachable", from: this.routerOf(hops, index - 1, packet.family), code: "host", ms: 2 * ms + ARP_WAIT_MS } : undefined;
      case "tcp/missing":
        return toTarget && direction === "out" && packet.kind === "syn" ? { fate: "reset", from: SIM_ADDRESSES.target[packet.family], ms: 2 * ms } : undefined;
      default:
        return undefined;
    }
  }

  /** The fate of a round trip: the packet out to the end, and its answer back. */
  roundTrip(out: Packet, back: Packet, hops: readonly Hop[], to: number = hops.length - 1): Fate {
    const there = this.walk(out, hops, "out", 0, to);
    if (there.fate !== "arrive") return there;
    const home = this.walk(back, hops, "back", 0, to);
    if (home.fate === "arrive") return { fate: "arrive", ms: there.ms + home.ms };
    return home.fate === "lost" ? home : { ...home, ms: there.ms + home.ms };
  }

  /** The TLS proxy on the path to an end, or `undefined`. A proxy at the host ends the connection on the client itself. */
  proxyOn(end: End): ProxyAt | undefined {
    const hops = this.hops(end);
    const reaches = (place: FaultPlace): number => hops.findIndex((hop) => hop.place === place);
    for (const fault of this.faults) {
      const index = reaches(fault.place);
      if (index < 0) continue;
      if (fault.option === "tls/intercept") return { hop: index };
      if (fault.option === "http/refuse" && (fault.place === "gateway" || fault.place === "provider") && end === "target" && fault.values["kind"] === "error") {
        // A device of the network can give an HTTP status for an HTTPS site only as a TLS proxy that the clients trust.
        return { hop: index, ...(this.act(fault) ? { status: 503 } : {}) };
      }
    }
    return undefined;
  }

  /** The certificate problem of a connection to an end, or `undefined` for a valid certificate. */
  certFault(end: End): CertFault | undefined {
    if (end === "portal") return "untrusted";
    if (end !== "target") return undefined;
    if (this.has("tls/expire", "host", "server") !== undefined) return "expired";
    const wrong = this.has("tls/wrong", "remote", "server");
    if (wrong === undefined || wrong.values["kind"] === "private") return undefined;
    return wrong.values["kind"] === "chain" ? "untrusted" : "name";
  }

  /** The certificate of an end comes from a private root that the client trusts, by design: no fault alone. */
  privateRoot(end: End): boolean {
    return end === "target" && this.has("tls/wrong", "remote", "server")?.values["kind"] === "private";
  }

  /** The TLS versions of the client and the server have nothing in common. */
  tlsMismatch(end: End): boolean {
    return end === "target" && this.has("tls/mismatch", "remote", "server") !== undefined;
  }

  /** The index of the hop of a firewall that resets this connection after its first data, or `undefined`. One draw for each connection. */
  resetHop(end: End): number | undefined {
    if (end !== "target") return undefined;
    const hops = this.hops(end);
    const fault = this.has("tcp/refuse", "gateway", "provider", "transit", "remote");
    if (fault === undefined || !this.act(fault)) return undefined;
    return hops.findIndex((hop) => hop.place === fault.place);
  }

  /** The extra time of the head of the response of an end, in ms. */
  serverDelay(end: End): number {
    if (end !== "target") return 0;
    const slow = this.has("http/delay", "remote", "server");
    return slow === undefined ? 0 : Number(slow.values["delay-ms"]);
  }

  /** The HTTP status of the server of an end, with one draw for each request. */
  serverStatus(end: End): number {
    if (end !== "target") return 200;
    const refuse = this.has("http/refuse", "remote", "server");
    if (refuse === undefined || refuse.values["kind"] !== "error") return 200;
    return this.act(refuse) ? 503 : 200;
  }

  /** The signal of the radio of the client in dBm. A weak signal is from -90 to -76 dBm. A weak signal is an act of its fault. */
  signalDbm(): number {
    const weak = this.faults.filter((each) => each.option === "wifi/loss" && each.values["signal"] === "weak" && each.values["kind"] === "all");
    for (const fault of weak) this.record(fault, true);
    return Math.round(weak.length > 0 ? this.random.range(-90, -76) : this.random.range(-58, -42));
  }

  /** The answer of the DNS of the world to one query of the client, with its time. */
  dns(name: string, record: "A" | "AAAA", eachMs: number, tries: number): DnsResult {
    if (this.localError(4) !== undefined) return { code: "ECONNREFUSED", addresses: [], ms: 0.1 };
    // As c-ares does, only a lost query or a lost answer starts the next try. An error answer ends the query.
    for (let done = 0; done < tries; done += 1) {
      const answer = this.dnsTry(name, record);
      if (answer !== undefined) return { ...answer, ms: done * eachMs + answer.ms };
    }
    return { code: "ETIMEOUT", addresses: [], ms: tries * eachMs };
  }

  /** The answer of one try of a DNS query, or `undefined` when the query, the answer or the resolver is silent. */
  private dnsTry(name: string, record: "A" | "AAAA"): DnsResult | undefined {
    const query: Packet = { end: "gateway", family: 4, kind: "dns", size: 80, df: false };
    const answer: Packet = { ...query, size: 120 };
    const gatewayHops = pathOf("gateway", this.setup.medium);
    const first = this.roundTrip(query, answer, gatewayHops);
    if (first.fate !== "arrive") return undefined;
    let ms = first.ms + 0.2;
    const portal = this.portalAt();
    const refused = (place: "gateway" | "resolver"): boolean => {
      const fault = this.has("dns/refuse", place);
      return fault !== undefined && this.act(fault);
    };
    if (this.has("dns/down", "gateway") !== undefined) return undefined;
    if (refused("gateway")) return { code: "EREFUSED", addresses: [], ms };
    if (portal === "gateway") return this.portalAnswer(record, ms);
    // The forwarder of the gateway asks the resolver of the provider. The query crosses the hop of the provider.
    const upstream = pathOf("resolver", this.setup.medium);
    const second = this.roundTrip({ ...query, end: "resolver" }, { ...answer, end: "resolver" }, upstream, upstream.length - 1);
    if (second.fate !== "arrive") return undefined;
    ms += second.ms - first.ms + 0.5;
    if (this.has("dns/down", "resolver") !== undefined) return undefined;
    if (refused("resolver")) return { code: "ESERVFAIL", addresses: [], ms };
    if (portal === "provider") return this.portalAnswer(record, ms);
    const end = name === TARGET_NAME ? "target" : name === REFERENCE_NAME ? "reference" : undefined;
    if (end === undefined || (end === "target" && this.has("dns/missing", "authority") !== undefined)) return { code: "ENOTFOUND", addresses: [], ms };
    const address = this.addressOf(end, record === "A" ? 4 : 6);
    return address === undefined ? { code: "ENODATA", addresses: [], ms } : { addresses: [address], ms, ttl: 300 };
  }

  private portalAnswer(record: "A" | "AAAA", ms: number): DnsResult {
    const address = this.addressOf("portal", record === "A" ? 4 : 6);
    return address === undefined ? { code: "ENODATA", addresses: [], ms } : { addresses: [address], ms, ttl: 60 };
  }

  /**
   * This method gives the fingerprint of the root of the chain of a server that sends a full chain. The root is the root
   * of the authority of the epoch, a private root, or the root of an inspection device. A self-signed or short chain has
   * no root.
   */
  rootOf(end: End, proxied: boolean): string {
    if (proxied) return "SIM-ROOT:inspection";
    const epoch = this.setup.epoch ?? 0;
    return this.privateRoot(end) ? `SIM-ROOT:private:${epoch}` : `SIM-ROOT:public:${epoch}`;
  }

  /** This method gives the name of the certificate of an end. */
  certificateName(end: End): string {
    if (end === "portal") return PORTAL_NAME;
    return end === "reference" ? REFERENCE_NAME : TARGET_NAME;
  }

  /** The time of the work of a TLS proxy, in ms. */
  get proxyMs(): number {
    return PROXY_DELAY_MS;
  }
}

/** The answer of the DNS of the world: the code of Node.js for a failure, the addresses, and the time. */
export interface DnsResult {
  readonly code?: string | undefined;
  readonly addresses: readonly string[];
  readonly ms: number;
  readonly ttl?: number | undefined;
}
