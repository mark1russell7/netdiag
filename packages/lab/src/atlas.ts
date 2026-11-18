import type { Layer } from "@mark1russell7/netdiag/core";
import { fault, faults, type FaultTerm } from "./grammar.ts";

// The fault atlas (ND-17, step 1): the faults of real networks, as data. Each entry has its layer, the class of the
// catalog that names it (or none), the signs that a probe can see, the world that can make it, and its sources.
// Each source was read before it was cited: an RFC with its section, or a public report with its address.

/**
 * A world that can make a fault for a case.
 *
 * - `loopback`: the loopback lab of today, with fake servers on 127.0.0.0/8.
 * - `kernel`: the kernel lab of today, with Docker networks of the harness and faults of `iptables` and `tc`.
 * - `containerlab`: routers, VLAN switches, the NAT and the DHCP server of a home router, and BGP between two providers.
 * - `vm`: virtual machines with a kernel each: Wi-Fi with `mac80211_hwsim`, a link that goes down, IPv6 router adverts.
 */
export type AtlasWorld = "loopback" | "kernel" | "containerlab" | "vm";

/** The worlds of the atlas, in their order: the two worlds of today, then the worlds of later steps. */
export const ATLAS_WORLDS: readonly AtlasWorld[] = ["loopback", "kernel", "containerlab", "vm"];

/** The name of each world of the atlas, for the tables. */
export const ATLAS_WORLD_NAMES: Readonly<Record<AtlasWorld, string>> = {
  loopback: "Loopback",
  kernel: "Kernel",
  containerlab: "containerlab",
  vm: "VMs",
};

/** A source of an entry: a section of an RFC. */
export interface RfcSource {
  /** The number of the RFC. */
  readonly rfc: number;
  /** The section of the RFC, for example `3.1.13` or `Appendix A.2`. */
  readonly section: string;
  /** The title of the RFC. */
  readonly title: string;
}

/** A source of an entry: a public incident report, a postmortem or a public alert. */
export interface ReportSource {
  /** The address of the report. */
  readonly report: string;
  /** The title of the report. */
  readonly title: string;
}

/** A source of an entry of the atlas. */
export type AtlasSource = RfcSource | ReportSource;

/** A fault of real networks. */
export interface AtlasEntry {
  /** The id of the entry. It is not the id of a class of the catalog. */
  readonly id: string;
  /** One sentence that tells the fault. */
  readonly summary: string;
  /** The layer of the fault. */
  readonly layer: Layer;
  /** The fault class of the catalog that names the fault, or `null` when the catalog has no class for it. */
  readonly hypothesis: string | null;
  /** For a fault with no class: the id of the class that the atlas proposes for the catalog. */
  readonly proposal?: string | undefined;
  /**
   * The fault as a term of the fault grammar. The class of the term is the class of the entry. The term also gives the
   * traits that a world needs for a case. For example, an entry of `path.mtu` on IPv6 needs IPv6, and the class does not.
   */
  readonly term: FaultTerm;
  /** The signs of the fault that a probe can see. */
  readonly signs: readonly string[];
  /** The world that can make the fault for a case. */
  readonly world: AtlasWorld;
  /** The sources of the entry. */
  readonly sources: readonly AtlasSource[];
}

/** This function tells if a source is a section of an RFC. */
export function isRfcSource(source: AtlasSource): source is RfcSource {
  return "rfc" in source;
}

const RFC_1122 = "Requirements for Internet Hosts -- Communication Layers";
const RFC_2131 = "Dynamic Host Configuration Protocol";
const RFC_2863 = "The Interfaces Group MIB";
const RFC_3155 = "End-to-end Performance Implications of Links with Errors";
const RFC_3360 = "Inappropriate TCP Resets Considered Harmful";
const RFC_3819 = "Advice for Internet Subnetwork Designers";
const RFC_4035 = "Protocol Modifications for the DNS Security Extensions";
const RFC_4787 = "Network Address Translation (NAT) Behavioral Requirements for Unicast UDP";
const RFC_4890 = "Recommendations for Filtering ICMPv6 Messages in Firewalls";
const RFC_5280 = "Internet X.509 Public Key Infrastructure Certificate and Certificate Revocation List (CRL) Profile";
const RFC_5382 = "NAT Behavioral Requirements for TCP";
const RFC_7908 = "Problem Definition and Classification of BGP Route Leaks";
const RFC_8914 = "Extended DNS Errors";
const RFC_9110 = "HTTP Semantics";
const RFC_9293 = "Transmission Control Protocol (TCP)";

const NERC_STORMS: ReportSource = {
  report: "https://www.nerc.com/pa/rrm/ea/Lessons%20Learned%20Document%20Library/LL20181001_Networking_Packet_Broadcast_Storms.pdf",
  title: "NERC Lesson Learned LL20181001: Networking Packet Broadcast Storms",
};
const SLACK_DNSSEC: ReportSource = {
  report: "https://slack.engineering/what-happened-during-slacks-dnssec-rollout/",
  title: "The Case of the Recursive Resolvers: What Happened During Slack's DNSSEC Rollout",
};

/**
 * The fault atlas: 49 faults of real networks, with their sources. An entry with a class shows where the catalog
 * names the fault. An entry with no class is a gap of the catalog, and it proposes a class.
 */
export const FAULT_ATLAS: readonly AtlasEntry[] = [
  // The link.
  {
    id: "link.no-carrier",
    summary: "The cable is out, or the port of the switch is down, so the interface has no link.",
    layer: "link",
    hypothesis: "interface.down",
    term: fault("link/down", { place: "link" }),
    signs: ["The interface has no link (`link.state` down).", "Each probe past the interface fails at once."],
    world: "vm",
    sources: [
      { rfc: 2863, section: "3.1.13", title: RFC_2863 },
      { rfc: 2863, section: "3.1.15", title: RFC_2863 },
    ],
  },
  {
    id: "link.switching-loop",
    summary: "A second cable between two switch ports makes a loop with no spanning tree, and broadcast frames fill the network.",
    layer: "link",
    hypothesis: null,
    proposal: "link.storm",
    term: fault("link/loop", { place: "lan" }),
    signs: [
      "The link is up, and the loss to the gateway is high.",
      "The time to the gateway grows, or the gateway does not answer.",
      "The interface counts a very high rate of broadcast frames.",
    ],
    world: "containerlab",
    sources: [NERC_STORMS],
  },

  // The Wi-Fi link.
  {
    id: "wifi.weak-signal",
    summary: "The access point is far, or walls weaken the signal, so the radio link loses frames.",
    layer: "wifi",
    hypothesis: "wifi.weak",
    term: fault("wifi/loss", { place: "link", kind: "all", signal: "weak" }),
    signs: ["The signal is below -75 dBm (`wifi.signal` weak).", "The loss to the gateway is some or high, and TCP is slow."],
    world: "vm",
    sources: [
      { rfc: 3819, section: "8.5.3", title: RFC_3819 },
      { rfc: 3155, section: "2", title: RFC_3155 },
    ],
  },
  {
    id: "wifi.interference",
    summary: "Other radios on the same channel interfere, so the link loses frames while the signal is strong.",
    layer: "wifi",
    hypothesis: null,
    proposal: "wifi.busy",
    term: fault("wifi/loss", { place: "link", kind: "all", signal: "strong" }),
    signs: ["The signal is strong, and the loss to the gateway is some or high.", "The time to the gateway changes much from one ping to the next."],
    world: "vm",
    sources: [{ rfc: 3819, section: "8.5.3", title: RFC_3819 }],
  },
  {
    id: "wifi.multicast-loss",
    summary: "The access point sends multicast frames at a low rate with no retransmission, so many of them are lost.",
    layer: "wifi",
    hypothesis: null,
    proposal: "wifi.multicast",
    term: fault("wifi/loss", { place: "lan", kind: "multicast" }),
    signs: ["Unicast traffic passes.", "Multicast lookups, for example mDNS, get few answers."],
    world: "vm",
    sources: [
      { rfc: 9119, section: "3.1.1", title: "Multicast Considerations over IEEE 802 Wireless Media" },
      { rfc: 9119, section: "3.1.2", title: "Multicast Considerations over IEEE 802 Wireless Media" },
    ],
  },

  // The addresses of the interfaces.
  {
    id: "ip.dhcp-no-lease",
    summary: "No DHCP server answers, so the interface gets no IPv4 address from a server.",
    layer: "ip",
    hypothesis: null,
    proposal: "dhcp.none",
    term: fault("ip/down", { place: "gateway" }),
    signs: [
      "The link is up, and the interface has no IPv4 address, or only a link-local address of 169.254.0.0/16.",
      "The client sends DHCPDISCOVER again, with a longer wait each time.",
    ],
    world: "containerlab",
    sources: [
      { rfc: 2131, section: "3.1", title: RFC_2131 },
      { rfc: 2131, section: "4.1", title: RFC_2131 },
      { rfc: 3927, section: "1", title: "Dynamic Configuration of IPv4 Link-Local Addresses" },
    ],
  },
  {
    id: "ip.dhcp-rogue",
    summary: "A second DHCP server on the link gives wrong addresses, a wrong gateway or a wrong resolver.",
    layer: "ip",
    hypothesis: null,
    proposal: "dhcp.rogue",
    term: fault("ip/rogue", { place: "lan", kind: "dhcp" }),
    signs: ["The gateway or the resolver of the lease is not the one of the network.", "Some hosts of the link work, and others do not."],
    world: "containerlab",
    sources: [{ rfc: 2131, section: "7", title: RFC_2131 }],
  },
  {
    id: "ip.address-conflict",
    summary: "Two hosts on the link have the same IPv4 address.",
    layer: "ip",
    hypothesis: null,
    proposal: "address.conflict",
    term: fault("ip/duplicate", { place: "lan" }),
    signs: ["An ARP packet for the address of the interface comes from a different hardware address.", "Connections stop or reset at random."],
    world: "containerlab",
    sources: [
      { rfc: 5227, section: "2.4", title: "IPv4 Address Conflict Detection" },
      { rfc: 5227, section: "4", title: "IPv4 Address Conflict Detection" },
      NERC_STORMS,
    ],
  },
  {
    id: "ip.ipv6-no-route",
    summary: "The host has IPv6, and a router on the path has no IPv6 route to the target.",
    layer: "ip",
    hypothesis: "ipv6.broken",
    term: fault("ip/missing", { place: "provider" }),
    signs: ["IPv4 connects, and IPv6 does not (`ip.family` ipv4-only).", "A client that tries IPv6 first waits many seconds before it uses IPv4."],
    world: "containerlab",
    sources: [
      { rfc: 6555, section: "3", title: "Happy Eyeballs: Success with Dual-Stack Hosts" },
      { rfc: 6555, section: "3.2", title: "Happy Eyeballs: Success with Dual-Stack Hosts" },
      { rfc: 8305, section: "1", title: "Happy Eyeballs Version 2: Better Connectivity Using Concurrency" },
    ],
  },
  {
    id: "ip.echo-filtered",
    summary: "A filter drops ICMP echo, and the host is up.",
    layer: "ip",
    hypothesis: "filter.icmp",
    term: fault("ip/filter", { place: "remote" }),
    signs: ["The host does not answer the ping (`icmp.reply` none).", "TCP connects to the port."],
    world: "kernel",
    sources: [
      { rfc: 1122, section: "3.2.2.6", title: RFC_1122 },
      { rfc: 4890, section: "4.3.1", title: RFC_4890 },
    ],
  },
  {
    id: "ip.host-off",
    summary: "The host is off, so nothing on it answers.",
    layer: "ip",
    hypothesis: "host.down",
    term: fault("ip/down", { place: "server" }),
    signs: ["The router of the host tells host unreachable, or no answer comes (`icmp.reply`).", "The ping and the TCP connect fail."],
    world: "kernel",
    sources: [{ rfc: 1812, section: "5.2.7.1", title: "Requirements for IP Version 4 Routers" }],
  },

  // The routes of this computer and its gateway.
  {
    id: "route.dead-gateway",
    summary: "The gateway does not forward packets, and the link stays up.",
    layer: "route",
    hypothesis: "gateway.down",
    term: fault("route/down", { place: "gateway" }),
    signs: ["The gateway does not answer the ping (`gateway.reply` none).", "The DNS queries and the connections past the gateway time out."],
    world: "kernel",
    sources: [{ rfc: 1122, section: "3.3.1.4", title: RFC_1122 }],
  },
  {
    id: "route.ipv6-no-advert",
    summary: "No router on the link sends router advertisements, so the host has no IPv6 default router.",
    layer: "route",
    hypothesis: null,
    proposal: "ipv6.no-router",
    term: fault("route/missing", { place: "gateway" }),
    signs: ["The interface has only a link-local IPv6 address.", "The router solicitations get no answer, and IPv4 works."],
    world: "vm",
    sources: [{ rfc: 4861, section: "6.3.7", title: "Neighbor Discovery for IP version 6 (IPv6)" }],
  },
  {
    id: "route.ipv6-rogue-advert",
    summary: "A second device on the link sends router advertisements, so hosts use a wrong default router or a wrong prefix.",
    layer: "route",
    hypothesis: null,
    proposal: "ipv6.rogue-router",
    term: fault("route/rogue", { place: "lan" }),
    signs: ["The IPv6 default router is not the router of the network.", "The host has an address of a wrong prefix, and IPv6 fails while IPv4 works."],
    world: "vm",
    sources: [
      { rfc: 6104, section: "1", title: "Rogue IPv6 Router Advertisement Problem Statement" },
      { rfc: 6104, section: "2", title: "Rogue IPv6 Router Advertisement Problem Statement" },
    ],
  },
  {
    id: "route.nat-exhaustion",
    summary: "The NAT has no free external port for the host, so it drops the first packet of each new flow.",
    layer: "route",
    hypothesis: null,
    proposal: "nat.full",
    term: fault("route/exhaust", { place: "provider" }),
    signs: ["The connections that are open keep working.", "New connections fail, and the NAT can send ICMP host unreachable."],
    world: "containerlab",
    sources: [{ rfc: 6888, section: "3", title: "Common Requirements for Carrier-Grade NATs (CGNs)" }],
  },
  {
    id: "route.nat-no-hairpin",
    summary: "The NAT does not hairpin, so a host cannot reach a host of its own network through the external address.",
    layer: "route",
    hypothesis: null,
    proposal: "nat.hairpin",
    term: fault("route/filter", { place: "gateway" }),
    signs: ["Connections to the external address fail from inside the network, and pass from outside.", "Connections to the internal address pass."],
    world: "containerlab",
    sources: [
      { rfc: 4787, section: "6", title: RFC_4787 },
      { rfc: 5382, section: "7.2", title: RFC_5382 },
    ],
  },

  // The path through the provider networks.
  {
    id: "path.lossy-link",
    summary: "A congested or damaged link on the path drops a part of the packets.",
    layer: "path",
    hypothesis: "path.loss",
    term: fault("path/loss", { place: "transit", share: 0.05 }),
    signs: ["The loss of the path is some or high (`path.loss`).", "TCP connects send the SYN again, and transfers are slow."],
    world: "kernel",
    sources: [
      { rfc: 3155, section: "2", title: RFC_3155 },
      { rfc: 3155, section: "2.2", title: RFC_3155 },
    ],
  },
  {
    id: "path.mtu-black-hole",
    summary: "A link on the path has a small MTU, and a filter blocks the ICMP message that tells the size.",
    layer: "path",
    hypothesis: "path.mtu",
    term: faults(fault("path/size", { place: "transit", mtu: 1400 }), fault("path/filter", { place: "transit", kind: "icmp-too-big" })),
    signs: [
      "Pings and small packets pass, and large packets with the DF bit are lost (`path.mtu` silent).",
      "A transfer stops at the first full packet.",
    ],
    world: "kernel",
    sources: [
      { rfc: 2923, section: "2.1", title: "TCP Problems with Path MTU Discovery" },
      { rfc: 2979, section: "3.1.1", title: "Behavior of and Requirements for Internet Firewalls" },
    ],
  },
  {
    id: "path.ipv6-too-big-filtered",
    summary: "A filter drops the ICMPv6 Packet Too Big messages, so the Path MTU Discovery of IPv6 fails.",
    layer: "path",
    hypothesis: "path.mtu",
    term: faults(fault("path/size", { place: "transit", family: "ipv6", mtu: 1280 }), fault("path/filter", { place: "transit", kind: "icmp-too-big", family: "ipv6" })),
    signs: ["Small IPv6 packets pass, and large IPv6 packets are lost.", "IPv4 transfers pass."],
    world: "containerlab",
    sources: [
      { rfc: 4890, section: "4.3.1", title: RFC_4890 },
      { rfc: 4890, section: "Appendix A.2", title: RFC_4890 },
    ],
  },
  {
    id: "path.dropped-prefix",
    summary: "A route sends the packets of a prefix to a network that drops them, with no ICMP message.",
    layer: "path",
    hypothesis: null,
    proposal: "path.black-hole",
    term: fault("path/down", { place: "transit" }),
    signs: ["Each probe to the prefix gets no answer, and other prefixes work.", "A trace stops in one network, with no unreachable message."],
    world: "containerlab",
    sources: [
      { rfc: 7908, section: "2", title: RFC_7908 },
      { rfc: 7908, section: "3.1", title: RFC_7908 },
    ],
  },
  {
    id: "path.routing-loop",
    summary: "Routers forward the packets of a prefix in a loop, for example while the routes converge after a failure.",
    layer: "path",
    hypothesis: null,
    proposal: "path.loop",
    term: fault("path/loop", { place: "transit", kind: "converge" }),
    signs: ["A trace shows the same hops again and again.", "Time-exceeded messages come back, and the links of the loop congest."],
    world: "containerlab",
    sources: [{ rfc: 5715, section: "2", title: "A Framework for Loop-Free Convergence" }],
  },
  {
    id: "path.asymmetric-filter",
    summary: "The replies come back on a different path, and a strict reverse-path filter on that path drops them.",
    layer: "path",
    hypothesis: null,
    proposal: "path.asymmetric",
    term: fault("path/filter", { place: "transit", kind: "reverse-path" }),
    signs: ["The requests leave, and no reply comes back.", "The same target works from a host on a different network."],
    world: "containerlab",
    sources: [{ rfc: 3704, section: "2.2", title: "Ingress Filtering for Multihomed Networks" }],
  },
  {
    id: "path.bgp-hijack",
    summary: "A different network announces the prefix of the target, so the traffic of the prefix goes to that network.",
    layer: "path",
    hypothesis: null,
    proposal: "path.hijack",
    term: fault("path/rogue", { place: "transit" }),
    signs: ["The trace ends in a network that is not the origin of the prefix.", "Connections time out, or a different server answers."],
    world: "containerlab",
    sources: [
      {
        report: "https://www.ripe.net/publications/news/industry-developments/youtube-hijacking-a-ripe-ncc-ris-case-study",
        title: "YouTube Hijacking: A RIPE NCC RIS case study",
      },
    ],
  },
  {
    id: "path.bgp-leak",
    summary: "A network passes routes beyond their scope, so traffic goes through a network that cannot carry it.",
    layer: "path",
    hypothesis: null,
    proposal: "path.leak",
    term: fault("path/wrong", { place: "transit" }),
    signs: ["The trace goes through a network that is not on the usual path.", "The loss and the delay rise for many targets at the same time."],
    world: "containerlab",
    sources: [
      { rfc: 7908, section: "2", title: RFC_7908 },
      {
        report: "https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/",
        title: "How Verizon and a BGP Optimizer Knocked Large Parts of the Internet Offline Today",
      },
    ],
  },
  {
    id: "path.full-queue",
    summary: "A device on the path has a large buffer, so under load its queue stays full and the delay rises.",
    layer: "path",
    hypothesis: null,
    proposal: "path.queue",
    term: fault("path/queue", { place: "provider" }),
    signs: ["The delay of the path rises by hundreds of milliseconds under load.", "With no load, the delay is short."],
    world: "kernel",
    sources: [
      { rfc: 7567, section: "1.2", title: "IETF Recommendations Regarding Active Queue Management" },
      { rfc: 7567, section: "2", title: "IETF Recommendations Regarding Active Queue Management" },
    ],
  },

  // The resolution of names.
  {
    id: "dns.resolver-unreachable",
    summary: "The resolver does not answer, for example when the routes to its address are withdrawn.",
    layer: "dns",
    hypothesis: "resolver.down",
    term: fault("dns/down", { place: "resolver" }),
    signs: ["Each DNS query gets no answer (`dns.answer` timeout or unreachable).", "Connections to an address with no name pass."],
    world: "loopback",
    sources: [{ report: "https://blog.cloudflare.com/cloudflare-1-1-1-1-incident-on-july-14-2025/", title: "Cloudflare 1.1.1.1 Incident on July 14, 2025" }],
  },
  {
    id: "dns.resolver-no-upstream",
    summary: "The resolver reaches no authoritative server, so it answers with an error for each name.",
    layer: "dns",
    hypothesis: "resolver.failing",
    term: fault("dns/refuse", { place: "resolver" }),
    signs: ["Each name gets SERVFAIL (`dns.answer` servfail).", "A different resolver answers."],
    world: "loopback",
    sources: [
      { rfc: 8914, section: "4.23", title: RFC_8914 },
      { rfc: 8914, section: "4.24", title: RFC_8914 },
    ],
  },
  {
    id: "dns.no-such-name",
    summary: "The name does not exist, for example after a typing error or a deleted record.",
    layer: "dns",
    hypothesis: "name.missing",
    term: fault("dns/missing", { place: "authority" }),
    signs: ["The query gets NXDOMAIN (`dns.answer` nxdomain).", "Other names resolve."],
    world: "loopback",
    sources: [
      { rfc: 2308, section: "2.1", title: "Negative Caching of DNS Queries (DNS NCACHE)" },
      { rfc: 8020, section: "2", title: "NXDOMAIN: There Really Is Nothing Underneath" },
    ],
  },
  {
    id: "dns.lame-delegation",
    summary: "The parent zone delegates the zone to a name server that does not serve it.",
    layer: "dns",
    hypothesis: null,
    proposal: "zone.lame",
    term: fault("dns/wrong", { place: "authority", kind: "delegation" }),
    signs: ["The resolver answers SERVFAIL for the names of one zone, and other names resolve.", "A query with the CD bit also fails."],
    world: "containerlab",
    sources: [{ rfc: 1912, section: "2.8", title: "Common DNS Operational and Configuration Errors" }],
  },
  {
    id: "dns.dnssec-bogus",
    summary: "The DS record of the parent does not match the keys of the zone, so validating resolvers reject its answers.",
    layer: "dns",
    hypothesis: null,
    proposal: "dnssec.bogus",
    term: fault("dns/mismatch", { place: "authority" }),
    signs: [
      "Validating resolvers answer SERVFAIL for the names of one zone, and a resolver that does not validate answers.",
      "A query with the CD bit gets the answer, and the extended error is DNSSEC Bogus (6).",
    ],
    world: "containerlab",
    sources: [{ rfc: 4035, section: "5.5", title: RFC_4035 }, { rfc: 8914, section: "4.7", title: RFC_8914 }, SLACK_DNSSEC],
  },
  {
    id: "dns.dnssec-expired",
    summary: "The signatures of the zone expire, because its signer stopped.",
    layer: "dns",
    hypothesis: null,
    proposal: "dnssec.bogus",
    term: fault("dns/expire", { place: "authority" }),
    signs: ["Validating resolvers answer SERVFAIL for the names of the zone.", "The extended error is Signature Expired (7)."],
    world: "containerlab",
    sources: [
      { rfc: 8914, section: "4.8", title: RFC_8914 },
      { rfc: 4035, section: "5.5", title: RFC_4035 },
    ],
  },
  {
    id: "dns.stale-cache",
    summary: "A cache keeps an old record after the zone changes it, until its TTL ends.",
    layer: "dns",
    hypothesis: null,
    proposal: "cache.stale",
    term: fault("dns/stale", { place: "resolver" }),
    signs: ["The resolver gives an answer that the authority does not give.", "A different resolver gives the new answer."],
    world: "containerlab",
    sources: [
      { rfc: 2308, section: "5", title: "Negative Caching of DNS Queries (DNS NCACHE)" },
      { rfc: 8767, section: "4", title: "Serving Stale Data to Improve DNS Resiliency" },
      SLACK_DNSSEC,
    ],
  },
  {
    id: "dns.authority-unreachable",
    summary: "The authoritative servers of a zone are unreachable, so no resolver can get the names of the zone.",
    layer: "dns",
    hypothesis: null,
    proposal: "zone.unreachable",
    term: fault("dns/down", { place: "authority" }),
    signs: ["Each resolver answers SERVFAIL, or a stale answer, for the names of one zone.", "The extended error is No Reachable Authority (22)."],
    world: "containerlab",
    sources: [
      { report: "https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/", title: "More details about the October 4 outage" },
      { rfc: 8914, section: "4.23", title: RFC_8914 },
    ],
  },
  {
    id: "dns.fragments-dropped",
    summary: "A filter on the path drops IP fragments, so large DNS answers over UDP do not arrive.",
    layer: "dns",
    hypothesis: null,
    proposal: "dns.fragments",
    term: fault("dns/size", { place: "transit" }),
    signs: ["Small answers arrive, and large answers over UDP time out.", "The same query over TCP gets the answer."],
    world: "kernel",
    sources: [
      { rfc: 8900, section: "3.9", title: "IP Fragmentation Considered Fragile" },
      { rfc: 8900, section: "5.1", title: "IP Fragmentation Considered Fragile" },
    ],
  },

  // The connections to a port.
  {
    id: "tcp.no-listener",
    summary: "No program listens on the port, so the host resets the connect.",
    layer: "tcp",
    hypothesis: "port.closed",
    term: fault("tcp/missing", { place: "server" }),
    signs: ["The connect gets a reset at once (`tcp.connect` refused).", "The host answers the ping."],
    world: "loopback",
    sources: [{ rfc: 9293, section: "3.10.7.1", title: RFC_9293 }],
  },
  {
    id: "tcp.silent-filter",
    summary: "A firewall drops the packets to the port, and sends no message.",
    layer: "tcp",
    hypothesis: "filter.drop",
    term: fault("tcp/filter", { place: "remote", kind: "port" }),
    signs: ["The connect sends the SYN again and times out (`tcp.connect` timeout).", "The host answers the ping."],
    world: "kernel",
    sources: [
      { rfc: 3360, section: "6.1", title: RFC_3360 },
      { rfc: 9293, section: "3.8.3", title: RFC_9293 },
    ],
  },
  {
    id: "tcp.middlebox-reset",
    summary: "A firewall or a load balancer on the path resets connections that it does not accept.",
    layer: "tcp",
    hypothesis: "filter.reset",
    term: fault("tcp/refuse", { place: "remote" }),
    signs: ["A reset ends the connect or the first data (`tcp.connect` reset).", "The host answers the ping."],
    world: "kernel",
    sources: [
      { rfc: 3360, section: "1", title: RFC_3360 },
      { rfc: 3360, section: "3", title: RFC_3360 },
    ],
  },
  {
    id: "tcp.ecn-blocked",
    summary: "A middlebox drops or resets a SYN with the ECN flags, so the connect waits for a SYN with no ECN.",
    layer: "tcp",
    hypothesis: null,
    proposal: "filter.ecn",
    term: fault("tcp/filter", { place: "transit", kind: "ecn" }),
    signs: ["A SYN with the ECN flags gets a reset or no answer, and a SYN with no ECN flags connects.", "The connect is late by a second or more."],
    world: "kernel",
    sources: [
      { rfc: 3168, section: "6.1.1.1", title: "The Addition of Explicit Congestion Notification (ECN) to IP" },
      { rfc: 3360, section: "3", title: RFC_3360 },
    ],
  },
  {
    id: "tcp.nat-idle-timeout",
    summary: "The NAT removes the mapping of an idle connection or UDP flow before its ends close it.",
    layer: "tcp",
    hypothesis: null,
    proposal: "nat.timeout",
    term: fault("tcp/expire", { place: "gateway" }),
    signs: ["A connection that is idle for some minutes stops, with no reset or with a reset from the NAT.", "New connections work."],
    world: "containerlab",
    sources: [
      { rfc: 5382, section: "5", title: RFC_5382 },
      { rfc: 4787, section: "4.3", title: RFC_4787 },
    ],
  },

  // The TLS handshake and the certificate.
  {
    id: "tls.expired-certificate",
    summary: "The certificate of the server expired.",
    layer: "tls",
    hypothesis: "tls.cert-invalid",
    term: fault("tls/expire", { place: "server", kind: "leaf" }),
    signs: ["The handshake fails with a certificate error (`tls.handshake` cert-error).", "The end of the validity of the certificate is in the past."],
    world: "loopback",
    sources: [{ rfc: 5280, section: "6.1.3", title: RFC_5280 }],
  },
  {
    id: "tls.expired-root",
    summary: "A root or a cross-sign of the chain expires, and old clients do not trust the new root.",
    layer: "tls",
    hypothesis: "tls.cert-invalid",
    term: fault("tls/expire", { place: "host", kind: "root" }),
    signs: ["Old clients fail the handshake with a certificate error, and new clients pass.", "The certificate of the server is in its validity."],
    world: "loopback",
    sources: [{ report: "https://letsencrypt.org/docs/dst-root-ca-x3-expiration-september-2021/", title: "DST Root CA X3 Expiration (September 2021)" }],
  },
  {
    id: "tls.wrong-name",
    summary: "The certificate of the server is for a different name.",
    layer: "tls",
    hypothesis: "tls.cert-invalid",
    term: fault("tls/wrong", { place: "server", kind: "name" }),
    signs: ["The handshake fails with a certificate error (`tls.handshake` cert-error).", "No subject name of the certificate matches the name of the target."],
    world: "loopback",
    sources: [
      { rfc: 9525, section: "6", title: "Service Identity in TLS" },
      { rfc: 9525, section: "6.6", title: "Service Identity in TLS" },
    ],
  },
  {
    id: "tls.old-version",
    summary: "The server offers only TLS 1.0 or TLS 1.1, and the client does not use them.",
    layer: "tls",
    hypothesis: "tls.mismatch",
    term: fault("tls/mismatch", { place: "server" }),
    signs: ["The handshake ends with a protocol_version alert (`tls.handshake` alert)."],
    world: "loopback",
    sources: [
      { rfc: 8996, section: "4", title: "Deprecating TLS 1.0 and TLS 1.1" },
      { rfc: 8996, section: "5", title: "Deprecating TLS 1.0 and TLS 1.1" },
    ],
  },
  {
    id: "tls.interception",
    summary: "A device on the path ends the TLS connection and gives a certificate from a root that the clients were made to trust.",
    layer: "tls",
    hypothesis: "tls.proxy",
    term: fault("tls/intercept", { place: "gateway" }),
    signs: ["The issuer of the certificate is a private root (`tls.trust` private).", "The handshake is slow for the time of the TCP connect (`tls.ratio` high)."],
    world: "loopback",
    sources: [{ report: "https://www.cisa.gov/news-events/alerts/2017/03/16/https-interception-weakens-tls-security", title: "HTTPS Interception Weakens TLS Security (TA17-075A)" }],
  },
  {
    id: "tls.wrong-clock",
    summary: "The clock of the client is wrong, so valid certificates seem not yet valid or expired.",
    layer: "tls",
    hypothesis: null,
    proposal: "clock.wrong",
    term: fault("tls/skew", { place: "host" }),
    signs: ["The handshake fails with a certificate error for each server.", "The time of the client is far from the time in the Date header of a server."],
    world: "vm",
    sources: [{ rfc: 5280, section: "6.1.3", title: RFC_5280 }],
  },

  // The request and the response.
  {
    id: "http.captive-portal",
    summary: "A captive portal holds the traffic and changes the answers until the user signs in.",
    layer: "http",
    hypothesis: "captive.portal",
    term: fault("http/intercept", { place: "gateway" }),
    signs: ["HTTP requests get a redirect or a 511 to a sign-in page.", "TLS handshakes fail with a name mismatch."],
    world: "loopback",
    sources: [
      { rfc: 8952, section: "1", title: "Captive Portal Architecture" },
      { rfc: 6585, section: "6", title: "Additional HTTP Status Codes" },
    ],
  },
  {
    id: "http.slow-upstream",
    summary: "The server is slow, so the answer comes late, or a proxy before it times out.",
    layer: "http",
    hypothesis: "server.slow",
    term: fault("http/delay", { place: "server" }),
    signs: ["The time to the first byte is long for the time of the TCP connect (`http.ttfb` high).", "A proxy answers with 504."],
    world: "loopback",
    sources: [{ rfc: 9110, section: "15.6.5", title: RFC_9110 }],
  },
  {
    id: "http.server-failure",
    summary: "The server or its CDN fails, for example with all its CPU in use, and answers with errors.",
    layer: "http",
    hypothesis: "server.error",
    term: fault("http/refuse", { place: "server", kind: "error" }),
    signs: ["The status is 5xx (`http.status` server-error).", "The TCP connect and the TLS handshake pass."],
    world: "loopback",
    sources: [
      { rfc: 9110, section: "15.6.1", title: RFC_9110 },
      { rfc: 9110, section: "15.6.4", title: RFC_9110 },
      { report: "https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/", title: "Details of the Cloudflare outage on July 2, 2019" },
      { report: "https://www.fastly.com/blog/summary-of-june-8-outage", title: "Summary of June 8 outage" },
    ],
  },
  {
    id: "http.proxy-failure",
    summary: "A proxy of the network fails, for example when it cannot reach the server, and it answers the requests with errors.",
    layer: "http",
    hypothesis: "proxy.error",
    term: fault("http/refuse", { place: "gateway", kind: "error" }),
    signs: [
      "The status is 5xx (`http.status` server-error), for example 502 or 504.",
      "The issuer of the certificate is a private root (`tls.trust` private), because the proxy ends the TLS connection.",
    ],
    world: "loopback",
    sources: [
      { rfc: 9110, section: "15.6.3", title: RFC_9110 },
      { rfc: 9110, section: "15.6.5", title: RFC_9110 },
    ],
  },
  {
    id: "http.proxy-authentication",
    summary: "A proxy of the network asks for credentials before it sends requests on.",
    layer: "http",
    hypothesis: null,
    proposal: "proxy.auth",
    term: fault("http/refuse", { place: "gateway", kind: "auth" }),
    signs: ["Each request through the proxy gets 407.", "Connections that do not use the proxy fail."],
    world: "loopback",
    sources: [{ rfc: 9110, section: "15.5.8", title: RFC_9110 }],
  },
];
