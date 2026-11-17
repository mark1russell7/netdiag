import { LAYERS, type Layer } from "@mark1russell7/netdiag/core";
import {
  checkConfig,
  checkSpace,
  enumerateSpace,
  paramActive,
  spaceSize,
  type ParamValue,
  type SpaceParam,
  type SpaceSize,
  type StageChoice,
  type StageOption,
  type StrategyConfig,
  type StrategySpace,
} from "@mark1russell7/strategy-space";
import type { WorldTrait } from "./coverage.ts";

// The fault grammar (ND-17, step 2): each fault of a network is a term of the grammar. A term has a layer, a mode, a
// place, a severity and an optional second fault. The grammar is a space of the schema `strategy-space/1`, so each term
// has an id, and the space has a count and seeded samples. Each pair of a layer and a mode is an option of the grammar,
// an alias of an option, or a reason. The fault atlas checks the grammar: each fault of a real network is a term.

/**
 * The modes of a fault: the ways that a part of a network fails. Each option of the grammar has one layer and one mode.
 * `MODE_FACTS` tells each mode.
 */
export const FAULT_MODES = [
  "down",
  "flap",
  "loss",
  "corrupt",
  "delay",
  "jitter",
  "reorder",
  "duplicate",
  "rate",
  "queue",
  "size",
  "filter",
  "refuse",
  "missing",
  "wrong",
  "stale",
  "rogue",
  "exhaust",
  "expire",
  "loop",
  "intercept",
  "mismatch",
  "skew",
  "stall",
] as const;

/** A mode of a fault. The list `FAULT_MODES` gives each mode in its order. */
export type FaultMode = (typeof FAULT_MODES)[number];

/**
 * The places of a fault: the part of the network that has the fault, from the client to the target.
 * `PLACE_SUMMARIES` tells each place.
 */
export const FAULT_PLACES = ["host", "link", "lan", "gateway", "provider", "transit", "remote", "server", "resolver", "authority"] as const;

/** A place of a fault. The list `FAULT_PLACES` gives each place in its order. */
export type FaultPlace = (typeof FAULT_PLACES)[number];

/** The text of each place of a fault. */
export const PLACE_SUMMARIES: Readonly<Record<FaultPlace, string>> = {
  host: "The client computer: its network stack, its settings, its clock and its trusted roots.",
  link: "The link of the client: the cable, the port or the radio.",
  lan: "The other devices of the local network: switches, access points and other hosts.",
  gateway: "The router of the local network, with its NAT, its DHCP server, its DNS forwarder and its firewall.",
  provider: "The access network of the provider of the client, with its NAT and its resolver.",
  transit: "The networks between the provider of the client and the network of the target.",
  remote: "The network of the target: its edge, its load balancers, its CDN and its firewall.",
  server: "The target host and its program.",
  resolver: "The recursive DNS resolver of the client.",
  authority: "The authoritative DNS servers of the zone of the target.",
};

/** The class of a term with no fault: the control of the lab. A term with only such faults has this class. */
export const NO_FAULT = "none";

/** The name of the space of the grammar. Each term names the space with this value. */
export const GRAMMAR_ENGINE = "netdiag-faults";

/** A rule that gives the class of a fault. The first rule whose `when` matches the values of the params gives the class. */
export interface LabelRule {
  /** For each named param, the values that match. Without `when`, the rule matches each fault of its option. */
  readonly when?: Readonly<Record<string, readonly ParamValue[]>> | undefined;
  /** The id of the fault class, or `NO_FAULT` for a fault that is no fault alone. */
  readonly label: string;
}

/** One option of the grammar: a pair of a layer and a mode, with its places, its params and the rules of its class. */
export interface GrammarOption {
  readonly layer: Layer;
  readonly mode: FaultMode;
  /** One sentence that tells the fault. */
  readonly summary: string;
  /** The places where the fault can be, in the order of `FAULT_PLACES`. The param `place` has these values. */
  readonly places: readonly FaultPlace[];
  /** The params of the severity and of the kind of the fault, after the param `place`. */
  readonly params?: readonly SpaceParam[] | undefined;
  /** The traits that a world needs for each fault of the option. `PARAM_NEEDS` adds the traits of some param values. */
  readonly needs?: readonly WorldTrait[] | undefined;
  /** For some values of the params of the option, the traits that a world needs too. */
  readonly valueNeeds?: Readonly<Record<string, Readonly<Record<string, readonly WorldTrait[]>>>> | undefined;
  /** The rules of the class. The last rule has no `when`, so each fault gets a class. */
  readonly labels: readonly LabelRule[];
}

/** A fault of a rule of two faults: an option, and for each named param the values that match. */
export interface FaultMatch {
  readonly option: string;
  readonly when?: Readonly<Record<string, readonly ParamValue[]>> | undefined;
}

/** A rule that gives one class to a term of two faults. The two faults match in either order. */
export interface PairRule {
  readonly faults: readonly [FaultMatch, FaultMatch];
  /** The params that have one value in the two faults. */
  readonly same?: readonly string[] | undefined;
  readonly label: string;
  /** One sentence that tells why the two faults make one fault. */
  readonly summary: string;
}

/** The facts of a mode: its text, and the decision for each layer with no option of the mode. */
export interface ModeFacts {
  readonly summary: string;
  /** The decision for each layer with no option of the mode and no entry in `at`: an option id, or a key of `GRAMMAR_REASONS`. */
  readonly others: string;
  /** The decision for some layers with no option of the mode. */
  readonly at?: Partial<Record<Layer, string>> | undefined;
}

const share = (fallback: number): SpaceParam => ({ name: "share", kind: "real", min: 0.001, max: 1, scale: "log", default: fallback });
const real = (name: string, min: number, max: number, fallback: number): SpaceParam => ({ name, kind: "real", min, max, scale: "log", default: fallback });
const kinds = (...values: readonly string[]): SpaceParam => ({ name: "kind", kind: "enum", values, default: values[0] ?? "" });
const PERIOD = real("period-s", 1, 3600, 30);
const DIRECTION: SpaceParam = { name: "direction", kind: "enum", values: ["both", "out", "back"], default: "both" };
const FAMILY: SpaceParam = { name: "family", kind: "enum", values: ["ipv4", "ipv6"], default: "ipv4" };
const PATH: readonly FaultPlace[] = ["lan", "gateway", "provider", "transit", "remote"];
const one = (label: string): readonly LabelRule[] => [{ label }];

/** The traits that a world needs for some values of a param, for each option with the param. */
export const PARAM_NEEDS: Readonly<Record<string, Readonly<Record<string, readonly WorldTrait[]>>>> = {
  family: { ipv6: ["ipv6"] },
};

/**
 * The options of the grammar, in the order of `LAYERS`. Each option is one pair of a layer and a mode. The id of an
 * option is `<layer>/<mode>`.
 */
export const GRAMMAR_OPTIONS: readonly GrammarOption[] = [
  // The link: the network interface and its physical link.
  { layer: "link", mode: "down", summary: "The interface has no link: the cable is out, the port of the switch is down, or the driver stopped.", places: ["host", "link", "lan"], needs: ["link"], labels: one("interface.down") },
  { layer: "link", mode: "flap", summary: "The link goes down and comes up again and again.", places: ["host", "link", "lan"], params: [PERIOD], needs: ["link"], labels: one("link.flap") },
  { layer: "link", mode: "corrupt", summary: "A bad cable or a bad port damages frames, so the receiver drops them for their checksum.", places: ["link", "lan"], params: [share(0.01)], labels: one("link.errors") },
  { layer: "link", mode: "rate", summary: "The link runs at a low rate, for example 10 Mbit/s after a bad negotiation.", places: ["link", "lan"], params: [real("rate-kbps", 100, 10_000_000, 10_000)], labels: one("link.slow") },
  { layer: "link", mode: "mismatch", summary: "The two ends of the link do not agree on the duplex, so frames collide and drop under load.", places: ["link"], needs: ["nic"], labels: one("link.duplex") },
  { layer: "link", mode: "loop", summary: "A loop of switch ports with no spanning tree sends broadcast frames around, and they fill the network.", places: ["lan"], labels: one("link.storm") },
  { layer: "link", mode: "wrong", summary: "The port or the radio puts the client on a wrong network, for example a wrong VLAN.", places: ["link", "lan"], labels: one("link.vlan") },
  { layer: "link", mode: "exhaust", summary: "The MAC table of a switch is full, so the switch sends each frame to each port.", places: ["lan"], labels: one("link.mac-table") },
  { layer: "link", mode: "size", summary: "The host sends frames that are larger than a switch of the network carries, and the switch drops them.", places: ["host", "lan"], params: [{ name: "mtu", kind: "int", min: 1501, max: 9216, default: 9000 }], labels: one("link.mtu") },
  { layer: "link", mode: "filter", summary: "The port of the switch blocks the client, for example after a failed 802.1X sign-in or a port security rule.", places: ["lan"], labels: one("link.port-blocked") },
  // The Wi-Fi link: the signal, the channel and the rate.
  { layer: "wifi", mode: "down", summary: "The access point stops, so the client finds no network.", places: ["lan"], needs: ["wifi"], labels: one("wifi.down") },
  { layer: "wifi", mode: "flap", summary: "The client leaves the access point and joins it again and again.", places: ["host", "lan"], params: [PERIOD], needs: ["wifi"], labels: one("wifi.flap") },
  {
    layer: "wifi",
    mode: "loss",
    summary: "The radio link loses frames: for a weak signal, for other radios on the channel, or for multicast frames only.",
    places: ["link", "lan"],
    params: [kinds("all", "multicast"), { name: "signal", kind: "enum", values: ["weak", "strong"], default: "weak", when: { param: "kind", in: ["all"] } }, share(0.05)],
    needs: ["wifi"],
    labels: [{ when: { kind: ["multicast"] }, label: "wifi.multicast" }, { when: { signal: ["weak"] }, label: "wifi.weak" }, { label: "wifi.busy" }],
  },
  { layer: "wifi", mode: "delay", summary: "The radio of the client or of the access point sleeps to save power, so frames wait.", places: ["host", "lan"], params: [real("delay-ms", 10, 1000, 100)], needs: ["wifi"], labels: one("wifi.power-save") },
  { layer: "wifi", mode: "refuse", summary: "The access point refuses the client: a wrong passphrase, a refused 802.1X sign-in, a MAC filter, or a full access point.", places: ["lan"], needs: ["wifi"], labels: one("wifi.refused") },
  { layer: "wifi", mode: "rogue", summary: "A second access point with the same network name takes the client.", places: ["lan"], needs: ["wifi"], labels: one("wifi.rogue") },
  // The addresses of the interfaces.
  { layer: "ip", mode: "down", summary: "The part stops: the DHCP server gives no address, or the target host is off.", places: ["lan", "gateway", "server"], labels: [{ when: { place: ["server"] }, label: "host.down" }, { label: "dhcp.none" }] },
  { layer: "ip", mode: "rogue", summary: "A second device answers for the real one: a second DHCP server, or false ARP answers for the address of the gateway.", places: ["lan"], params: [kinds("dhcp", "arp")], labels: [{ when: { kind: ["arp"] }, label: "arp.spoof" }, { label: "dhcp.rogue" }] },
  { layer: "ip", mode: "duplicate", summary: "Two hosts of the link have the same IPv4 address.", places: ["lan"], labels: one("address.conflict") },
  { layer: "ip", mode: "exhaust", summary: "The address pool of the DHCP server is full, so new clients get no address.", places: ["lan", "gateway"], labels: one("dhcp.full") },
  { layer: "ip", mode: "wrong", summary: "The host has a wrong address or a wrong mask, from its own settings or from wrong DHCP options.", places: ["host", "gateway"], labels: one("address.wrong") },
  { layer: "ip", mode: "filter", summary: "A filter drops ICMP echo, and the host is up.", places: ["gateway", "provider", "transit", "remote", "server"], labels: one("filter.icmp") },
  { layer: "ip", mode: "stale", summary: "A neighbor cache keeps an old link address after a device changes, so frames go to the old device.", places: ["host", "lan", "gateway"], labels: one("arp.stale") },
  { layer: "ip", mode: "missing", summary: "The host has IPv6, and a router on the path has no IPv6 route to the target.", places: ["gateway", "provider", "transit"], needs: ["ipv6"], labels: one("ipv6.broken") },
  // The routes of this computer and its gateway.
  { layer: "route", mode: "down", summary: "The gateway does not forward packets, and the link stays up.", places: ["gateway"], labels: one("gateway.down") },
  { layer: "route", mode: "missing", summary: "No router of the link sends router advertisements, so the host has no IPv6 default router.", places: ["lan", "gateway"], needs: ["ipv6"], labels: one("ipv6.no-router") },
  { layer: "route", mode: "wrong", summary: "A route of the host or of the gateway sends packets to a wrong next hop, for example a route that a VPN left.", places: ["host", "gateway"], labels: one("route.wrong") },
  { layer: "route", mode: "rogue", summary: "A second device sends router advertisements, so hosts use a wrong default router or a wrong prefix.", places: ["lan"], needs: ["ipv6"], labels: one("ipv6.rogue-router") },
  { layer: "route", mode: "exhaust", summary: "The NAT has no free external port, so it drops the first packet of each new flow.", places: ["gateway", "provider"], labels: one("nat.full") },
  { layer: "route", mode: "filter", summary: "The NAT does not hairpin, so a host cannot reach a host of its own network through the external address.", places: ["gateway"], labels: one("nat.hairpin") },
  { layer: "route", mode: "flap", summary: "The default route changes again and again, for example when two routers of the link both take the gateway address.", places: ["lan", "gateway"], params: [PERIOD], labels: one("gateway.flap") },
  // The hops through the provider networks to the remote host.
  { layer: "path", mode: "loss", summary: "A congested or damaged link on the path drops a share of the packets.", places: PATH, params: [DIRECTION, share(0.05)], labels: one("path.loss") },
  { layer: "path", mode: "delay", summary: "The path is long, for example a satellite link or a detour through a far network, so each packet is late.", places: PATH, params: [DIRECTION, real("delay-ms", 1, 5000, 200)], labels: one("path.delay") },
  { layer: "path", mode: "jitter", summary: "The delay of the packets changes from packet to packet.", places: PATH, params: [real("jitter-ms", 1, 1000, 50)], labels: one("path.jitter") },
  { layer: "path", mode: "reorder", summary: "Packets arrive in a different order, for example over two links of different delay.", places: PATH, params: [share(0.05)], labels: one("path.reorder") },
  { layer: "path", mode: "duplicate", summary: "A device on the path sends some packets two times.", places: PATH, params: [share(0.01)], labels: one("path.duplicate") },
  { layer: "path", mode: "corrupt", summary: "A device on the path changes bits of the packets, so the receivers drop them for their checksum.", places: PATH, params: [share(0.01)], labels: one("path.corrupt") },
  { layer: "path", mode: "rate", summary: "A slow link or a shaper on the path carries the packets at a low rate.", places: PATH, params: [DIRECTION, real("rate-kbps", 8, 10_000_000, 1000)], labels: one("path.rate") },
  { layer: "path", mode: "queue", summary: "A device on the path has a large buffer, so under load its queue stays full and the delay rises.", places: PATH, params: [real("queue-ms", 10, 5000, 500)], labels: one("path.queue") },
  {
    layer: "path",
    mode: "size",
    summary: "A link on the path has a small MTU. Alone it is no fault, because Path MTU Discovery finds the size.",
    places: PATH,
    params: [FAMILY, { name: "mtu", kind: "int", min: 576, max: 1499, default: 1400 }],
    labels: one(NO_FAULT),
  },
  {
    layer: "path",
    mode: "filter",
    summary: "A filter on the path drops a kind of packets: ICMP Packet Too Big messages, or replies that come back on another path.",
    places: PATH,
    params: [kinds("icmp-too-big", "reverse-path"), { ...FAMILY, when: { param: "kind", in: ["icmp-too-big"] } }],
    labels: [{ when: { kind: ["icmp-too-big"] }, label: NO_FAULT }, { label: "path.asymmetric" }],
  },
  { layer: "path", mode: "down", summary: "A route sends the packets of a prefix to a network that drops them, with no ICMP message.", places: ["provider", "transit", "remote"], labels: one("path.black-hole") },
  {
    layer: "path",
    mode: "loop",
    summary: "Routers forward the packets of a prefix in a loop: two static routes send it to each other, or the routes converge after a failure.",
    places: ["gateway", "provider", "transit", "remote"],
    params: [kinds("static", "converge")],
    valueNeeds: { kind: { converge: ["routing"] } },
    labels: one("path.loop"),
  },
  { layer: "path", mode: "rogue", summary: "A different network announces the prefix of the target, so the traffic of the prefix goes to that network.", places: ["transit"], needs: ["routing"], labels: one("path.hijack") },
  { layer: "path", mode: "wrong", summary: "A network passes routes beyond their scope, so traffic goes through a network that cannot carry it.", places: ["transit"], needs: ["routing"], labels: one("path.leak") },
  { layer: "path", mode: "flap", summary: "A route on the path is withdrawn and announced again and again, so the path changes and drops packets.", places: ["provider", "transit", "remote"], params: [PERIOD], needs: ["routing"], labels: one("path.flap") },
  { layer: "path", mode: "exhaust", summary: "The route table of a router on the path is full, so the router drops the packets of the prefixes that it cannot hold.", places: ["provider", "transit"], labels: one("path.black-hole") },
  { layer: "path", mode: "missing", summary: "A router on the path has no route to the target, and it answers with an ICMP unreachable message.", places: ["gateway", "provider", "transit", "remote"], labels: one("path.no-route") },
  // The resolution of names to addresses.
  { layer: "dns", mode: "down", summary: "The DNS server does not answer: the resolver, the forwarder of the gateway, or each authoritative server of the zone.", places: ["gateway", "resolver", "authority"], labels: [{ when: { place: ["authority"] }, label: "zone.unreachable" }, { label: "resolver.down" }] },
  { layer: "dns", mode: "refuse", summary: "The resolver answers with an error for each name, for example when it reaches no authoritative server.", places: ["gateway", "resolver"], params: [share(1)], labels: one("resolver.failing") },
  { layer: "dns", mode: "missing", summary: "The name does not exist, for example after a typing error or a deleted record.", places: ["authority"], labels: one("name.missing") },
  { layer: "dns", mode: "wrong", summary: "The DNS data is wrong: the parent zone delegates to a server that does not serve the zone, or a record has a wrong address.", places: ["authority"], params: [kinds("delegation", "record")], labels: [{ when: { kind: ["delegation"] }, label: "zone.lame" }, { label: "dns.wrong-record" }] },
  { layer: "dns", mode: "intercept", summary: "A device of the network answers the queries for other resolvers, or it changes their answers.", places: ["gateway", "provider"], labels: one("dns.intercept") },
  { layer: "dns", mode: "rogue", summary: "A false answer gets into the cache of the resolver, so the resolver gives a wrong address for the name.", places: ["resolver"], labels: one("dns.poison") },
  { layer: "dns", mode: "stale", summary: "A cache keeps an old record after the zone changes it, until its TTL ends.", places: ["host", "resolver"], labels: one("cache.stale") },
  { layer: "dns", mode: "expire", summary: "The DNSSEC signatures of the zone expire, because its signer stopped.", places: ["authority"], labels: one("dnssec.bogus") },
  { layer: "dns", mode: "mismatch", summary: "The DS record of the parent does not match the keys of the zone, so validating resolvers reject its answers.", places: ["authority"], labels: one("dnssec.bogus") },
  { layer: "dns", mode: "filter", summary: "A filter drops DNS traffic: the queries to resolvers outside the network, or DNS over TCP.", places: ["gateway", "provider", "transit"], params: [kinds("port", "tcp")], labels: [{ when: { kind: ["tcp"] }, label: "dns.tcp-blocked" }, { label: "dns.blocked" }] },
  { layer: "dns", mode: "delay", summary: "The resolver answers late.", places: ["gateway", "resolver"], params: [real("delay-ms", 10, 5000, 500)], labels: one("resolver.slow") },
  { layer: "dns", mode: "loss", summary: "The resolver drops a share of the queries, so lookups wait for a retry.", places: ["gateway", "resolver"], params: [share(0.1)], labels: one("resolver.lossy") },
  { layer: "dns", mode: "exhaust", summary: "The resolver or the forwarder of the gateway gets too many queries, so it drops or refuses the new ones.", places: ["gateway", "resolver"], labels: one("resolver.limit") },
  { layer: "dns", mode: "skew", summary: "The clock of a validating resolver is wrong, so it rejects valid DNSSEC signatures.", places: ["gateway", "resolver"], labels: one("resolver.clock") },
  { layer: "dns", mode: "size", summary: "A filter on the path drops IP fragments, so a large DNS answer over UDP does not arrive.", places: ["gateway", "provider", "transit", "remote"], labels: one("dns.fragments") },
  { layer: "dns", mode: "loop", summary: "Two forwarders send queries to each other, or a chain of aliases comes back to its start.", places: ["gateway", "resolver", "authority"], labels: one("dns.loop") },
  // The connections to a port.
  { layer: "tcp", mode: "missing", summary: "No program listens on the port, so the host resets the connect.", places: ["server"], labels: one("port.closed") },
  { layer: "tcp", mode: "filter", summary: "A firewall drops the packets to the port with no message, or a middlebox drops a SYN with the ECN flags.", places: ["host", "gateway", "provider", "transit", "remote", "server"], params: [kinds("port", "ecn")], labels: [{ when: { kind: ["ecn"] }, label: "filter.ecn" }, { label: "filter.drop" }] },
  { layer: "tcp", mode: "refuse", summary: "A firewall or a load balancer on the path resets connections that it does not accept.", places: ["gateway", "provider", "transit", "remote"], params: [share(1)], labels: one("filter.reset") },
  { layer: "tcp", mode: "expire", summary: "A NAT or a firewall removes the state of an idle connection before its ends close it.", places: ["gateway", "provider", "remote"], params: [real("idle-s", 10, 7200, 300)], labels: one("nat.timeout") },
  { layer: "tcp", mode: "exhaust", summary: "A table is full: the queue of new connections of the server, or the connection table of a NAT or a firewall.", places: ["gateway", "provider", "server"], labels: [{ when: { place: ["server"] }, label: "server.backlog" }, { label: "nat.full" }] },
  { layer: "tcp", mode: "stall", summary: "The server or a proxy accepts the connection and then sends nothing.", places: ["remote", "server"], labels: one("server.stall") },
  { layer: "tcp", mode: "mismatch", summary: "A middlebox removes or changes TCP options, for example the window scale, so the connection is slow or stops.", places: ["gateway", "provider", "transit", "remote"], labels: one("tcp.options") },
  { layer: "tcp", mode: "intercept", summary: "A transparent proxy ends the TCP connection and opens its own connection to the server.", places: ["gateway", "provider", "remote"], labels: one("tcp.proxy") },
  // The handshake and the certificate of the server.
  { layer: "tls", mode: "expire", summary: "A certificate of the chain expires: the certificate of the server, or a root that old clients trust.", places: ["host", "server"], params: [kinds("leaf", "root")], labels: one("tls.cert-invalid") },
  { layer: "tls", mode: "wrong", summary: "The server gives a certificate for a different name, or a chain with no intermediate certificate.", places: ["remote", "server"], params: [kinds("name", "chain")], labels: one("tls.cert-invalid") },
  { layer: "tls", mode: "mismatch", summary: "The client and the server have no TLS version or cipher in common.", places: ["remote", "server"], labels: one("tls.mismatch") },
  { layer: "tls", mode: "intercept", summary: "A device ends the TLS connection and gives a certificate from a root that the clients were made to trust.", places: ["host", "gateway", "provider", "remote"], labels: one("tls.proxy") },
  { layer: "tls", mode: "skew", summary: "The clock of the client is wrong, so valid certificates seem not yet valid or expired.", places: ["host"], params: [real("skew-s", 60, 3_000_000_000, 31_536_000), { name: "ahead", kind: "bool", default: false }], labels: one("clock.wrong") },
  { layer: "tls", mode: "filter", summary: "A middlebox reads the server name of the handshake, and it blocks or resets the connections to some names.", places: ["gateway", "provider", "transit"], labels: one("tls.blocked") },
  { layer: "tls", mode: "size", summary: "A middlebox drops a ClientHello that needs more than one packet, for example with post-quantum key shares.", places: ["gateway", "provider", "transit", "remote"], labels: one("tls.large-hello") },
  // The request and the response.
  { layer: "http", mode: "intercept", summary: "A captive portal holds the traffic and changes the answers until the user signs in.", places: ["gateway", "provider"], labels: one("captive.portal") },
  { layer: "http", mode: "delay", summary: "The server is slow, so the answer comes late, or a proxy before it times out.", places: ["remote", "server"], params: [real("delay-ms", 100, 60_000, 5000)], labels: one("server.slow") },
  {
    layer: "http",
    mode: "refuse",
    summary: "The server answers with errors, or a proxy of the network asks for credentials before it sends requests on.",
    places: ["gateway", "provider", "remote", "server"],
    params: [kinds("error", "auth"), { ...share(1), when: { param: "kind", in: ["error"] } }],
    labels: [{ when: { kind: ["auth"] }, label: "proxy.auth" }, { label: "server.error" }],
  },
  { layer: "http", mode: "stale", summary: "A cache or a CDN gives an old version of the page after the server changes it.", places: ["remote"], labels: one("cdn.stale") },
  { layer: "http", mode: "loop", summary: "The redirects of the server come back to their start, so the client never gets a page.", places: ["remote", "server"], labels: one("http.redirect-loop") },
  { layer: "http", mode: "exhaust", summary: "The server limits the rate of the client, and it refuses the requests above the limit.", places: ["remote", "server"], labels: one("server.limit") },
  { layer: "http", mode: "mismatch", summary: "A newer HTTP version fails on the path, for example HTTP/3 when a filter drops UDP, so the client waits before it falls back.", places: ["gateway", "provider", "remote"], labels: one("http.version") },
  { layer: "http", mode: "wrong", summary: "A cache or a CDN gives the page of a different site or of a different user.", places: ["remote"], labels: one("cdn.wrong-content") },
];

/** The rules of the terms of two faults that make one fault. */
export const PAIR_RULES: readonly PairRule[] = [
  {
    faults: [{ option: "path/size" }, { option: "path/filter", when: { kind: ["icmp-too-big"] } }],
    same: ["family"],
    label: "path.mtu",
    summary: "A small MTU on the path and a filter of the ICMP message that tells the size make a black hole for large packets.",
  },
];

/** The reasons of the pairs of a layer and a mode with no option and no alias. */
export const GRAMMAR_REASONS: Readonly<Record<string, string>> = {
  program: "A missing page is a fault of the program of the server or of the address, not of the network.",
  clock: "The parts of this layer measure only intervals. They do not compare the time of a clock with a time in the data.",
  connection: "Only a connection can stall: a part accepts it and then sends nothing. This layer has no connection.",
};

/**
 * The facts of each mode. For a layer with no option of the mode, `at` or `others` gives the decision. An option id is
 * an alias: the fault of the pair is that option. A key of `GRAMMAR_REASONS` tells why the pair has no fault.
 */
export const MODE_FACTS: Readonly<Record<FaultMode, ModeFacts>> = {
  down: { summary: "The part stops: it sends nothing and answers nothing.", others: "tcp/missing", at: { http: "http/refuse" } },
  flap: { summary: "The part stops and starts again and again.", others: "tcp/missing", at: { ip: "ip/rogue", dns: "dns/loss", http: "http/refuse" } },
  loss: { summary: "The part drops a share of the units that it carries.", others: "path/loss", at: { link: "link/corrupt" } },
  corrupt: { summary: "The part changes bits of the units that it carries.", others: "path/corrupt", at: { wifi: "wifi/loss", dns: "dns/wrong", http: "http/wrong" } },
  delay: { summary: "The part holds each unit for a time.", others: "path/delay", at: { link: "path/queue", tcp: "tcp/exhaust", tls: "http/delay" } },
  jitter: { summary: "The delay of the units changes from unit to unit.", others: "path/jitter", at: { wifi: "wifi/loss" } },
  reorder: { summary: "The units arrive in a different order.", others: "path/reorder" },
  duplicate: { summary: "The part sends some units two times, or two parts have one identity.", others: "path/duplicate", at: { link: "link/loop" } },
  rate: { summary: "The part carries the units at a low rate.", others: "path/rate", at: { wifi: "wifi/loss", dns: "dns/exhaust", http: "http/exhaust" } },
  queue: { summary: "A large buffer of the part fills under load, so the delay rises with the load.", others: "path/queue" },
  size: { summary: "The part carries no unit above a size.", others: "path/size", at: { wifi: "link/size", http: "http/refuse" } },
  filter: { summary: "A rule of the part drops a kind of units, with no message.", others: "path/filter", at: { wifi: "wifi/refuse", http: "http/refuse" } },
  refuse: { summary: "The part refuses the units with a message.", others: "path/missing", at: { link: "link/filter", tls: "tls/mismatch" } },
  missing: { summary: "The part works, and it has no entry for the request: no route, no record, no listener.", others: "program", at: { link: "link/down", wifi: "wifi/down", tls: "tls/wrong" } },
  wrong: { summary: "The part answers with a wrong value.", others: "dns/wrong", at: { wifi: "link/wrong" } },
  stale: { summary: "The part answers with an old value.", others: "ip/stale", at: { route: "route/wrong", path: "path/down", tcp: "tcp/expire", tls: "tls/expire" } },
  rogue: { summary: "A second part answers in place of the real part.", others: "ip/rogue", at: { tcp: "tcp/refuse", tls: "tls/intercept", http: "http/intercept" } },
  exhaust: { summary: "A table or a quota of the part is full.", others: "http/exhaust", at: { wifi: "wifi/refuse" } },
  expire: {
    summary: "A time limit of the part ends.",
    others: "tcp/expire",
    at: { link: "link/filter", wifi: "wifi/flap", ip: "ip/down", route: "route/missing", path: "path/flap" },
  },
  loop: { summary: "The units go around a loop and do not arrive.", others: "path/loop", at: { wifi: "link/loop" } },
  intercept: { summary: "A part between the ends speaks for the far end.", others: "ip/rogue", at: { wifi: "wifi/rogue", route: "route/rogue", path: "path/rogue" } },
  mismatch: { summary: "The two ends do not agree on a version, a mode or a key.", others: "ip/wrong", at: { wifi: "wifi/refuse", route: "route/wrong", path: "path/size" } },
  skew: { summary: "A clock of the part is wrong.", others: "clock", at: { wifi: "tls/skew", http: "tls/skew" } },
  stall: { summary: "The part accepts a connection and then sends nothing.", others: "connection", at: { wifi: "wifi/loss", dns: "dns/down", tls: "tcp/stall", http: "tcp/stall" } },
};

/** This function gives the id of an option: `<layer>/<mode>`. */
export function optionId(option: Pick<GrammarOption, "layer" | "mode">): string {
  return `${option.layer}/${option.mode}`;
}

const OPTIONS: ReadonlyMap<string, GrammarOption> = new Map(GRAMMAR_OPTIONS.map((option) => [optionId(option), option]));

/** This function gives the params of an option in the space: the param `place`, then the params of the option. */
export function optionParams(option: GrammarOption): readonly SpaceParam[] {
  return [{ name: "place", kind: "enum", values: option.places, default: option.places[0] ?? "host" }, ...(option.params ?? [])];
}

const STAGE_OPTIONS: readonly StageOption[] = GRAMMAR_OPTIONS.map((option) => ({ id: optionId(option), params: optionParams(option) }));

/**
 * The fault grammar as a space of `strategy-space/1`. The stage `fault` has the first fault. The optional stage `second`
 * has a second fault. A term with one fault leaves out the stage `second`, so its id is the same in `ONE_FAULT_GRAMMAR`.
 */
export const FAULT_GRAMMAR: StrategySpace = {
  schema: "strategy-space/1",
  engine: GRAMMAR_ENGINE,
  version: "1",
  stages: [
    { name: "fault", options: STAGE_OPTIONS },
    { name: "second", optional: true, omitUnused: true, options: STAGE_OPTIONS },
  ],
};

/** The terms of one fault: the grammar with only the stage `fault`. Each term of this space is a term of `FAULT_GRAMMAR`. */
export const ONE_FAULT_GRAMMAR: StrategySpace = { ...FAULT_GRAMMAR, stages: FAULT_GRAMMAR.stages.slice(0, 1) };

/** A term of the grammar: a config of `FAULT_GRAMMAR`, with one or two faults. */
export type FaultTerm = StrategyConfig;

/** This function gives a term of one fault, for example `fault("path/loss", { place: "transit" })`. */
export function fault(option: string, params?: Readonly<Record<string, ParamValue>>): FaultTerm {
  return { space: GRAMMAR_ENGINE, stages: { fault: params === undefined ? { option } : { option, params } } };
}

/** This function gives a term of two faults. */
export function faults(first: FaultTerm, second: FaultTerm): FaultTerm {
  const choice = second.stages["fault"];
  if (choice === undefined || choice === null) throw new RangeError("The second term has no fault.");
  return { space: GRAMMAR_ENGINE, stages: { ...first.stages, second: choice } };
}

/** This function gives the faults of a term, in the order of the stages. */
export function faultsOf(term: FaultTerm): readonly StageChoice[] {
  return [term.stages["fault"], term.stages["second"]].filter((choice): choice is StageChoice => choice !== undefined && choice !== null);
}

/** This function gives the values of the active params of a fault, with the default of each param that the fault does not set. */
export function faultValues(choice: StageChoice): Readonly<Record<string, ParamValue>> {
  const option = OPTIONS.get(choice.option);
  if (option === undefined) throw new RangeError(`The grammar has no option ${choice.option}.`);
  const values: Record<string, ParamValue> = {};
  for (const param of optionParams(option)) if (paramActive(param, values)) values[param.name] = choice.params?.[param.name] ?? param.default;
  return values;
}

/** This function tells if the values of a fault match each condition of `when`. */
function matches(values: Readonly<Record<string, ParamValue>>, when: Readonly<Record<string, readonly ParamValue[]>> | undefined): boolean {
  return Object.entries(when ?? {}).every(([param, accepted]) => {
    const value = values[param];
    return value !== undefined && accepted.includes(value);
  });
}

/** This function gives the class of one fault: the label of the first rule of its option that matches. */
export function faultClass(choice: StageChoice): string {
  const option = OPTIONS.get(choice.option);
  if (option === undefined) throw new RangeError(`The grammar has no option ${choice.option}.`);
  const values = faultValues(choice);
  const rule = option.labels.find((each) => matches(values, each.when));
  if (rule === undefined) throw new RangeError(`The option ${choice.option} has no rule for the values of the fault.`);
  return rule.label;
}

/** This function tells if two faults match a rule of two faults, in this order. */
function pairMatches(rule: PairRule, first: StageChoice, second: StageChoice): boolean {
  const [a, b] = rule.faults;
  if (first.option !== a.option || second.option !== b.option) return false;
  const one = faultValues(first);
  const two = faultValues(second);
  return matches(one, a.when) && matches(two, b.when) && (rule.same ?? []).every((param) => one[param] === two[param]);
}

/**
 * This function gives the classes of a term, in their sorted order. A rule of two faults gives one class. Else each fault
 * gives its class, and a term with only faults of `NO_FAULT` gives `[NO_FAULT]`.
 */
export function termClasses(term: FaultTerm): readonly string[] {
  const choices = faultsOf(term);
  const [first, second] = choices;
  if (first !== undefined && second !== undefined) {
    const rule = PAIR_RULES.find((each) => pairMatches(each, first, second) || pairMatches(each, second, first));
    if (rule !== undefined) return [rule.label];
  }
  const labels = [...new Set(choices.map(faultClass))].filter((label) => label !== NO_FAULT).sort();
  return labels.length === 0 ? [NO_FAULT] : labels;
}

/** This function gives the traits that a world needs for a term: the needs of each option and of the values of its params. */
export function termNeeds(term: FaultTerm): readonly WorldTrait[] {
  const needs = new Set<WorldTrait>();
  for (const choice of faultsOf(term)) {
    const option = OPTIONS.get(choice.option);
    for (const trait of option?.needs ?? []) needs.add(trait);
    for (const [param, value] of Object.entries(faultValues(choice))) {
      for (const trait of PARAM_NEEDS[param]?.[String(value)] ?? []) needs.add(trait);
      for (const trait of option?.valueNeeds?.[param]?.[String(value)] ?? []) needs.add(trait);
    }
  }
  return [...needs].sort();
}

/** A class that the grammar gives, with its layer, the options that give it and the traits that each of its terms needs. */
export interface GrammarClass {
  readonly id: string;
  /** The layer of the first option that gives the class. */
  readonly layer: Layer;
  /** The ids of the options that give the class, in the order of `GRAMMAR_OPTIONS`. */
  readonly options: readonly string[];
  /** The traits that each term of the class needs. A world with these traits can have a case of the class. */
  readonly needs: readonly WorldTrait[];
}

/** This function gives the traits that each list has, in their sorted order. With no list, it gives no trait. */
export function sharedNeeds(lists: readonly (readonly WorldTrait[])[]): readonly WorldTrait[] {
  const [first, ...rest] = lists;
  return [...new Set(first ?? [])].filter((trait) => rest.every((list) => list.includes(trait))).sort();
}

/**
 * This function gives each class of the grammar, in the order of the options. Its terms are the terms of one fault on
 * the grid with one level. The terms of two faults of each rule of two faults are also terms of the class.
 */
function classesOf(): readonly GrammarClass[] {
  const singles = enumerateSpace(ONE_FAULT_GRAMMAR, { mode: "grid", levels: 1 });
  const terms = new Map<string, { layer: Layer; options: string[]; needs: (readonly WorldTrait[])[] }>();
  const add = (label: string, option: GrammarOption, needs: readonly WorldTrait[]): void => {
    if (label === NO_FAULT) return;
    const entry = terms.get(label) ?? { layer: option.layer, options: [], needs: [] };
    const id = optionId(option);
    if (!entry.options.includes(id)) entry.options.push(id);
    entry.needs.push(needs);
    terms.set(label, entry);
  };
  for (const term of singles) {
    const choice = faultsOf(term)[0];
    const option = choice === undefined ? undefined : OPTIONS.get(choice.option);
    if (option !== undefined) add(termClasses(term)[0] ?? NO_FAULT, option, termNeeds(term));
  }
  for (const rule of PAIR_RULES) {
    const sides = rule.faults.map((side) => singles.filter((term) => {
      const choice = faultsOf(term)[0];
      return choice !== undefined && choice.option === side.option && matches(faultValues(choice), side.when);
    }));
    const option = OPTIONS.get(rule.faults[0].option);
    if (option === undefined) continue;
    for (const a of sides[0] ?? []) for (const b of sides[1] ?? []) {
      const term = faults(a, b);
      if (termClasses(term)[0] === rule.label) add(rule.label, option, termNeeds(term));
    }
  }
  return [...terms].map(([id, entry]) => ({ id, layer: entry.layer, options: entry.options, needs: sharedNeeds(entry.needs) }));
}

/** Each class of the grammar, in the order of the options that give them. */
export const GRAMMAR_CLASSES: readonly GrammarClass[] = classesOf();

/** This function gives the needs of some classes of the grammar. A class with no need, or with no entry in `classes`, gets no entry. */
export function grammarNeeds(ids: readonly string[], classes: readonly GrammarClass[] = GRAMMAR_CLASSES): Readonly<Record<string, readonly WorldTrait[]>> {
  return Object.fromEntries(classes.filter((each) => ids.includes(each.id) && each.needs.length > 0).map((each) => [each.id, each.needs]));
}

/** This function tells the problems of a term: each break of the check of `strategy-space`. An empty list tells that the term is good. */
export function termProblems(term: FaultTerm): readonly string[] {
  return checkConfig(FAULT_GRAMMAR, term).map((each) => `${each.claim}: ${each.detail}`);
}

/** The decision for a pair of a layer and a mode: the option of the pair, an alias of another option, or a reason. */
export type PairDecision =
  | { readonly kind: "option"; readonly option: string }
  | { readonly kind: "alias"; readonly option: string }
  | { readonly kind: "reason"; readonly reason: string };

/** This function gives the decision for a pair of a layer and a mode. */
export function pairDecision(layer: Layer, mode: FaultMode): PairDecision {
  const id = optionId({ layer, mode });
  if (OPTIONS.has(id)) return { kind: "option", option: id };
  const facts = MODE_FACTS[mode];
  const value = facts.at?.[layer] ?? facts.others;
  return value.includes("/") ? { kind: "alias", option: value } : { kind: "reason", reason: value };
}

/** The counts of the grammar. */
export interface GrammarCounts {
  readonly modes: number;
  readonly places: number;
  /** The pairs of a layer and a mode: each layer of netdiag with each mode. */
  readonly pairs: number;
  readonly options: number;
  readonly aliases: number;
  readonly reasons: number;
  /** The classes that the grammar gives. */
  readonly classes: number;
  /** The terms of one fault and of two faults on the grid with 3 levels for each numeric param. */
  readonly one: bigint;
  readonly two: bigint;
}

/** This function counts the grammar. */
export function grammarCounts(): GrammarCounts {
  const decisions = LAYERS.flatMap((layer) => FAULT_MODES.map((mode) => pairDecision(layer, mode)));
  const one: SpaceSize = spaceSize(ONE_FAULT_GRAMMAR, { levels: 3 });
  const all: SpaceSize = spaceSize(FAULT_GRAMMAR, { levels: 3 });
  return {
    modes: FAULT_MODES.length,
    places: FAULT_PLACES.length,
    pairs: decisions.length,
    options: decisions.filter((each) => each.kind === "option").length,
    aliases: decisions.filter((each) => each.kind === "alias").length,
    reasons: decisions.filter((each) => each.kind === "reason").length,
    classes: GRAMMAR_CLASSES.length,
    one: one.base,
    two: all.base - one.base,
  };
}

/** This function gives a seeded sample of terms. With `pairs`, each term has two faults. Else each term has one fault. */
export function sampleTerms(n: number, seed: number, pairs = false): readonly FaultTerm[] {
  const firsts = enumerateSpace(ONE_FAULT_GRAMMAR, { mode: "sample", n, seed });
  if (!pairs) return firsts;
  const seconds = enumerateSpace(ONE_FAULT_GRAMMAR, { mode: "sample", n, seed: seed + 1 });
  return firsts.map((first, at) => {
    const second = seconds[at];
    return second === undefined ? first : faults(first, second);
  });
}

/** This function tells the problems of the grammar. An empty list tells that the grammar is good. */
export function grammarProblems(): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const option of GRAMMAR_OPTIONS) {
    const id = optionId(option);
    if (seen.has(id)) problems.push(`The grammar has the option ${id} more than once.`);
    seen.add(id);
    if (option.places.length === 0) problems.push(`The option ${id} has no place.`);
    const names = new Set(optionParams(option).map((param) => param.name));
    const last = option.labels.at(-1);
    if (last === undefined || last.when !== undefined) problems.push(`The last rule of the option ${id} has a condition, so a fault of the option can have no class.`);
    for (const rule of option.labels) for (const param of Object.keys(rule.when ?? {})) if (!names.has(param)) problems.push(`A rule of the option ${id} names the param ${param}, and the option has no such param.`);
    for (const [name, values] of Object.entries(option.valueNeeds ?? {})) {
      const param = optionParams(option).find((each) => each.name === name);
      for (const value of Object.keys(values)) if (param?.values?.map(String).includes(value) !== true) problems.push(`The needs of the option ${id} name the value ${value} of ${name}, and the option has no such value.`);
    }
  }
  for (const layer of LAYERS) {
    for (const mode of FAULT_MODES) {
      const decision = pairDecision(layer, mode);
      if (decision.kind === "alias" && !OPTIONS.has(decision.option)) problems.push(`The pair ${layer}/${mode} names the option ${decision.option}, and the grammar has no such option.`);
      if (decision.kind === "reason" && GRAMMAR_REASONS[decision.reason] === undefined) problems.push(`The pair ${layer}/${mode} names the reason ${decision.reason}, and the grammar has no such reason.`);
    }
  }
  for (const mode of FAULT_MODES) {
    for (const layer of Object.keys(MODE_FACTS[mode].at ?? {})) if (OPTIONS.has(`${layer}/${mode}`)) problems.push(`The mode ${mode} has a decision for ${layer}, and ${layer}/${mode} is an option.`);
  }
  const reasons = new Set(LAYERS.flatMap((layer) => FAULT_MODES.map((mode) => pairDecision(layer, mode))).flatMap((each) => (each.kind === "reason" ? [each.reason] : [])));
  for (const key of Object.keys(GRAMMAR_REASONS)) if (!reasons.has(key)) problems.push(`No pair of a layer and a mode has the reason ${key}.`);
  for (const rule of PAIR_RULES) for (const side of rule.faults) if (!OPTIONS.has(side.option)) problems.push(`A rule of two faults names the option ${side.option}, and the grammar has no such option.`);
  for (const each of checkSpace(FAULT_GRAMMAR)) problems.push(`The space of the grammar breaks the claim ${each.claim}: ${each.detail}`);
  return problems;
}

const code = (text: string): string => `\`${text}\``;

/** This function gives the classes of an option, in the order of its rules. A rule of `NO_FAULT` gives no class. */
export function optionClasses(option: GrammarOption): readonly string[] {
  return [...new Set(option.labels.map((rule) => rule.label))].filter((label) => label !== NO_FAULT);
}

/** This function gives the text of the condition of a fault of a rule of two faults, for example `path/filter` (kind `icmp-too-big`). */
function matchText(match: FaultMatch): string {
  const when = Object.entries(match.when ?? {}).map(([param, values]) => `${param} ${values.map((value) => code(String(value))).join(" or ")}`);
  return when.length === 0 ? code(match.option) : `${code(match.option)} (${when.join(", ")})`;
}

/**
 * This function gives the grammar as Markdown: the line of the counts, then a table of the modes and the layers. A cell
 * of an option names its classes. A cell of an alias names its option. A cell of a reason has the number of the reason.
 * The lists below the table give the reasons and the rules of two faults.
 */
export function grammarMarkdown(): string {
  const counts = grammarCounts();
  const classes = GRAMMAR_CLASSES.length;
  const reasons = Object.keys(GRAMMAR_REASONS);
  const lines = [
    `- The grammar has ${counts.modes} modes, ${counts.places} places and ${counts.options} options. ` +
      `Of the ${counts.pairs} pairs of a layer and a mode, ${counts.options} are options, ${counts.aliases} are aliases of an option, and ${counts.reasons} have a reason. ` +
      `The grammar gives ${classes} classes. The grid with 3 levels has ${counts.one.toLocaleString("en-US")} terms of one fault and ${counts.two.toLocaleString("en-US")} terms of two faults.`,
    "",
    `| Mode | ${LAYERS.join(" | ")} |`,
    `| --- | ${LAYERS.map(() => "---").join(" | ")} |`,
  ];
  for (const mode of FAULT_MODES) {
    const cells = LAYERS.map((layer) => {
      const decision = pairDecision(layer, mode);
      if (decision.kind === "reason") return `⊘ [${String(reasons.indexOf(decision.reason) + 1)}]`;
      if (decision.kind === "alias") return `→ ${code(decision.option)}`;
      const option = OPTIONS.get(decision.option);
      const labels = (option === undefined ? [] : optionClasses(option)).map(code);
      for (const rule of PAIR_RULES) {
        const other = rule.faults.find((each) => each.option !== decision.option);
        if (other !== undefined && rule.faults.some((each) => each.option === decision.option)) labels.push(`${code(rule.label)} with ${matchText(other)}`);
      }
      return labels.length === 0 ? "none" : labels.join(", ");
    });
    lines.push(`| ${code(mode)} | ${cells.join(" | ")} |`);
  }
  lines.push("", "- The key: a cell names the classes of its option. → names the option of an alias. ⊘ names the reason that the pair has no fault.");
  lines.push("- The reasons:");
  reasons.forEach((key, at) => lines.push(`  ${String(at + 1)}. ${GRAMMAR_REASONS[key] ?? ""}`));
  lines.push("- The rules of two faults:");
  for (const rule of PAIR_RULES) {
    const same = (rule.same ?? []).length > 0 ? `, with one ${(rule.same ?? []).join(" and one ")}` : "";
    lines.push(`  - ${matchText(rule.faults[0])} and ${matchText(rule.faults[1])}${same}: ${code(rule.label)}. ${rule.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The line before the part of the grammar in a file that `coverage-main.ts` writes. */
export const GRAMMAR_START = "<!-- grammar:start. The command `pnpm --filter @netdiag/lab roadmap` writes this part. Do not edit it. -->";
/** The line after the part of the grammar in a file that `coverage-main.ts` writes. */
export const GRAMMAR_END = "<!-- grammar:end -->";

/** This function gives the part of the roadmap between the marker lines of the grammar, with a blank line before and after it. */
export function grammarPart(): string {
  return `\n${grammarMarkdown()}\n`;
}
