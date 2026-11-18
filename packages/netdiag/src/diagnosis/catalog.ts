import { poissonBinomial } from "@mark1russell7/rigor-statistics";
import { binOf, LOSS_MIN_SENT, PATH_LOSS_BINS } from "./bins.ts";
import { STANDARD_CONCENTRATIONS } from "./standard-concentrations.ts";
import { compileCatalog, FLOOR, STRENGTHS, type Catalog, type CatalogSpec, type Degree, type Distribution, type Feature, type Fault, type Prediction } from "./model.ts";

/**
 * The features of the standard catalog.
 *
 * The readers of the facts give these features. The distribution `healthy` of each feature is a rule of practice. The
 * lab runs (ND-7) then fit it.
 */
const FEATURES: readonly Feature[] = [
  {
    id: "link.state",
    layer: "link",
    local: true,
    summary: "The state of the link of the network interface.",
    values: ["up", "down"],
    healthy: { up: 0.999, down: 0.001 },
  },
  {
    id: "wifi.signal",
    layer: "wifi",
    local: true,
    summary: "The strength of the Wi-Fi signal: strong at -60 dBm or more, weak below -75 dBm.",
    values: ["strong", "fair", "weak"],
    healthy: { strong: 0.7, fair: 0.25, weak: 0.05 },
  },
  {
    id: "wifi.state",
    layer: "wifi",
    local: true,
    summary: "The Wi-Fi of this computer: connected when a Wi-Fi interface is connected, none when the Wi-Fi tool finds no connected interface.",
    values: ["connected", "none"],
    healthy: { connected: 0.6, none: 0.4 },
  },
  {
    id: "gateway.reply",
    layer: "route",
    local: true,
    summary: "The gateway answers an ICMP echo request.",
    values: ["reply", "none"],
    healthy: { reply: 0.97, none: 0.03 },
  },
  {
    // A loss past the gateway does not change the loss to the gateway. So this feature tells where a loss starts.
    id: "gateway.loss",
    layer: "route",
    local: true,
    summary: "The packet loss to the gateway, with the bins and the healthy distribution of `path.loss`.",
    values: ["none", "some", "high", "most"],
    healthy: { none: 0.9, some: 0.08, high: 0.018, most: 0.002 },
  },
  {
    id: "path.loss",
    layer: "path",
    summary: "The packet loss on the path: none, some (up to 5 %), high (more than 5 %) or most (more than half).",
    values: ["none", "some", "high", "most"],
    healthy: { none: 0.9, some: 0.08, high: 0.018, most: 0.002 },
  },
  {
    id: "path.mtu",
    layer: "path",
    summary: "The MTU of the path: full at the ceiling of the search, reduced with a message that tells the MTU, or silent with no message.",
    values: ["full", "reduced", "silent"],
    healthy: { full: 0.85, reduced: 0.14, silent: 0.01 },
  },
  {
    id: "dns.answer",
    layer: "dns",
    summary: "The result of the DNS lookup of the name of the target. The value unreachable tells that the computer cannot send the query, or that no DNS service listens on the resolver.",
    values: ["ok", "nxdomain", "servfail", "refused", "timeout", "unreachable"],
    healthy: { ok: 0.965, nxdomain: 0.01, servfail: 0.005, refused: 0.005, timeout: 0.01, unreachable: 0.005 },
  },
  {
    id: "dns.address",
    layer: "dns",
    summary: "The kind of the addresses of a public name: public, or private (RFC 1918, RFC 6598, RFC 4193, loopback, link-local or unspecified).",
    values: ["public", "private"],
    healthy: { public: 0.95, private: 0.05 },
  },
  {
    id: "ip.family",
    layer: "ip",
    summary: "The address families that connect, for a host with IPv4 and IPv6 addresses.",
    values: ["both", "ipv4-only", "ipv6-only"],
    healthy: { both: 0.9, "ipv4-only": 0.08, "ipv6-only": 0.02 },
  },
  {
    id: "icmp.reply",
    layer: "ip",
    summary: "The host answers an ICMP echo request, does not answer, or a router tells that it is unreachable.",
    values: ["reply", "none", "unreachable"],
    healthy: { reply: 0.85, none: 0.14, unreachable: 0.01 },
  },
  {
    id: "tcp.connect",
    layer: "tcp",
    summary: "The outcome of a TCP connect to the port of the target.",
    values: ["connected", "refused", "timeout", "unreachable", "reset"],
    healthy: { connected: 0.97, refused: 0.01, timeout: 0.01, unreachable: 0.005, reset: 0.005 },
  },
  {
    id: "tcp.time",
    layer: "tcp",
    summary: "The time of the TCP connect: short (below 150 ms), long, or retry (900 ms or more, a SYN sent again).",
    values: ["short", "long", "retry"],
    healthy: { short: 0.8, long: 0.18, retry: 0.02 },
  },
  {
    id: "tls.handshake",
    layer: "tls",
    summary: "The outcome of the TLS handshake.",
    values: ["ok", "cert-error", "alert", "timeout", "reset"],
    healthy: { ok: 0.97, "cert-error": 0.01, alert: 0.01, timeout: 0.005, reset: 0.005 },
  },
  {
    id: "tls.ratio",
    layer: "tls",
    summary: "The time of the TLS handshake divided by the time of the TCP connect: low (below 3), mid, or high (8 or more).",
    values: ["low", "mid", "high"],
    healthy: { low: 0.75, mid: 0.2, high: 0.05 },
  },
  {
    id: "tls.trust",
    layer: "tls",
    summary: "The issuer of the certificate: a public root of trust, or a private root.",
    values: ["public", "private"],
    healthy: { public: 0.97, private: 0.03 },
  },
  {
    id: "tls.root",
    layer: "tls",
    summary: "The root of the certificate chain, compared with the roots of the good checks of the host: the same root, or a changed root.",
    values: ["same", "changed"],
    healthy: { same: 0.98, changed: 0.02 },
  },
  {
    id: "http.status",
    layer: "http",
    summary: "The class of the HTTP status: ok (2xx and 3xx), client-error (4xx), server-error (5xx), or none.",
    values: ["ok", "client-error", "server-error", "none"],
    healthy: { ok: 0.95, "client-error": 0.03, "server-error": 0.01, none: 0.01 },
  },
  {
    id: "http.ttfb",
    layer: "http",
    summary: "The time to the first byte divided by the time of the TCP connect: low (below 4), mid, or high (20 or more).",
    values: ["low", "mid", "high"],
    healthy: { low: 0.6, mid: 0.3, high: 0.1 },
  },
];

/**
 * The features of the standard catalog, with the concentration of the repeats of each feature from
 * `STANDARD_CONCENTRATIONS`. The lab fits it on the simulated world.
 */
export const STANDARD_FEATURES: readonly Feature[] = FEATURES.map((feature) => {
  const concentration = STANDARD_CONCENTRATIONS[feature.id];
  return concentration === undefined ? feature : { ...feature, concentration };
});

/** A degree of a loss: the chance that one exchange loses a packet, and the weight of the degree in the prior. */
export interface LossDegree {
  readonly id: string;
  /** The chance that one exchange loses a packet. An exchange is a packet and its answer. */
  readonly loss: number;
  /** The relative weight of the degree in the prior of the fault. */
  readonly share: number;
}

/**
 * The degrees of a loss: a grid of the chance q that one exchange loses a packet. Under a loss s in both directions, an
 * exchange loses a packet with the probability 1 - (1 - s)^2. The grid goes from a loss that shows only in the echo
 * requests to a loss that stops most exchanges. Most losses in the field are light. Thus the three degrees below q 0.5
 * each have 3 parts of the prior, and the three others each have 1.
 */
export const LOSS_DEGREES: readonly LossDegree[] = [
  { id: "loss-5", loss: 0.05, share: 3 },
  { id: "loss-15", loss: 0.15, share: 3 },
  { id: "loss-30", loss: 0.3, share: 3 },
  { id: "loss-50", loss: 0.5, share: 1 },
  { id: "loss-70", loss: 0.7, share: 1 },
  { id: "loss-90", loss: 0.9, share: 1 },
];

/** A step of a visit that a loss changes: its feature, its tries, and the time feature of a step that passes. */
export interface LossStep {
  /** The feature of the outcome of the step. */
  readonly feature: string;
  /** The value of the feature when the step loses each try. */
  readonly timeout: string;
  /** The count of the tries of the step in the time limit of a probe. */
  readonly tries: number;
  /** The time feature of a step that passes, if the step has one. */
  readonly time?: string | undefined;
  /** The bins of the time feature where a late step lands. */
  readonly late?: Distribution | undefined;
}

/**
 * The steps of a visit that a loss changes, with their tries in the time limit of 5 s of a probe.
 *
 * - A DNS query has 3 tries, the default of the DNS probe.
 * - A connect sends its SYN at 0, 1 and 3 s: the RTO of a connect starts at 1 s and doubles. A late SYN gives
 *   `retry`, not `long`.
 * - A TLS or HTTP exchange sends again at 0.2, 0.6 and 1.4 s: the RTO starts at the floor of 200 ms of Linux and
 *   doubles. The 2 s after the last SYN of a connect fit these 4 tries.
 * - A late TLS or HTTP exchange waits an RTO of 200 ms or 3 round trips, the larger. Its ratio to the connect is then
 *   1 + max(200 ms / rtt, 3), so 4 or more: `mid`, or `high` for a short round trip. The split is even until the lab
 *   runs fit it. A connect that sent its SYN again gives no ratio (Karn's rule), so a late connect does not make a
 *   ratio low.
 * - The echo requests to an address are a step with `LOSS_MIN_SENT` tries. The address gives no reply when the loss
 *   takes each request.
 */
export const LOSS_STEPS: readonly LossStep[] = [
  { feature: "dns.answer", timeout: "timeout", tries: 3 },
  { feature: "tcp.connect", timeout: "timeout", tries: 3, time: "tcp.time", late: { retry: 1 } },
  { feature: "tls.handshake", timeout: "timeout", tries: 4, time: "tls.ratio", late: { mid: 0.5, high: 0.5 } },
  { feature: "http.status", timeout: "none", tries: 4, time: "http.ttfb", late: { mid: 0.5, high: 0.5 } },
  { feature: "icmp.reply", timeout: "none", tries: LOSS_MIN_SENT },
  { feature: "gateway.reply", timeout: "none", tries: LOSS_MIN_SENT },
];

/**
 * This function gives the predictions of a loss in the steps of a visit. The argument `loss` is the chance that one
 * exchange loses a packet.
 *
 * - A step with k tries times out when it loses each try: loss^k. The other outcomes keep their healthy shares.
 * - A step that passes was late when it lost its first try: (loss - loss^k) / (1 - loss^k). A late step lands in the
 *   bins `late` of its time feature. A step on time keeps the healthy distribution of the time feature.
 * - The connects of each address family fail on their own. Thus one family can fail alone, as under `ipv6.broken`.
 * - The share of the echo requests with a reply lands in the bins of `path.loss` and `gateway.loss`. The count of the
 *   requests is `LOSS_MIN_SENT`, the least count that gives a bin. The reader gives no bin with no reply. Thus the
 *   chances are of the visits with one reply or more.
 */
function lossSigns(loss: number): Record<string, Prediction> {
  const signs: Record<string, Prediction> = {};
  for (const step of LOSS_STEPS) {
    const timeout = loss ** step.tries;
    signs[step.feature] = moved(step.feature, timeout, { [step.timeout]: 1 });
    if (step.time !== undefined && step.late !== undefined) signs[step.time] = moved(step.time, (loss - timeout) / (1 - timeout), step.late);
  }
  const connect = LOSS_STEPS.find((step) => step.feature === "tcp.connect");
  if (connect === undefined) throw new Error("The loss steps have no connect.");
  const fail = loss ** connect.tries;
  const healthy = healthyOf("ip.family");
  const both = healthy["both"] ?? 0;
  const family = {
    both: both * (1 - fail) ** 2,
    "ipv4-only": (healthy["ipv4-only"] ?? 0) * (1 - fail) + both * fail * (1 - fail),
    "ipv6-only": (healthy["ipv6-only"] ?? 0) * (1 - fail) + both * fail * (1 - fail),
  };
  // When each family fails, the visit reads no family. So the shares are of the visits that read a family.
  const read = family.both + family["ipv4-only"] + family["ipv6-only"];
  signs["ip.family"] = Object.fromEntries(Object.entries(family).map(([value, p]) => [value, p / read]));
  const sent = LOSS_MIN_SENT;
  const lost = poissonBinomial(Array.from({ length: sent }, () => loss));
  const replied = 1 - (lost[sent] ?? 0);
  const bins: Record<string, number> = {};
  for (let count = 0; count < sent; count += 1) {
    const value = binOf(PATH_LOSS_BINS, (sent - count) / sent);
    bins[value] = (bins[value] ?? 0) + (lost[count] ?? 0) / replied;
  }
  signs["path.loss"] = moved("path.loss", STRENGTHS.sure, bins);
  signs["gateway.loss"] = moved("gateway.loss", STRENGTHS.sure, bins);
  return signs;
}

/** This function gives the healthy distribution of a feature of the standard catalog. */
function healthyOf(feature: string): Distribution {
  const healthy = STANDARD_FEATURES.find((each) => each.id === feature)?.healthy;
  if (healthy === undefined) throw new Error(`The catalog has no feature ${feature}.`);
  return healthy;
}

/**
 * This function gives the healthy distribution of a feature, with the share `share` moved to the bins `to`. As in an
 * expectation, each value keeps `FLOOR` or more. The values above the floor give the missing mass, in proportion to
 * their part above the floor.
 */
function moved(feature: string, share: number, to: Distribution): Distribution {
  const healthy = healthyOf(feature);
  for (const value of Object.keys(to)) if (!(value in healthy)) throw new Error(`The feature ${feature} has no value ${value}.`);
  const mixed = Object.entries(healthy).map(([value, p]) => [value, (1 - share) * p + share * (to[value] ?? 0)] as const);
  const missing = mixed.reduce((sum, [, p]) => sum + Math.max(0, FLOOR - p), 0);
  if (missing === 0) return Object.fromEntries(mixed);
  const above = mixed.reduce((sum, [, p]) => sum + Math.max(0, p - FLOOR), 0);
  return Object.fromEntries(mixed.map(([value, p]) => [value, p < FLOOR ? FLOOR : p - (missing * (p - FLOOR)) / above]));
}

/**
 * This function gives the degrees of a fault that loses packets, with the predictions of the fault for each degree.
 * A loss does the same to TCP and HTTP at each place where it starts. The place can be the radio, the local network
 * or a network on the path. So each fault with a loss takes these degrees.
 *
 * Under a small q, each try passes after a few repeats, so DNS, TCP and HTTP succeed. Under a large q, each DNS try,
 * each SYN and each request can fail. Thus the timeouts come together with the loss, at each host that the loss
 * reaches. Each degree is one q of `LOSS_DEGREES`, so the facts of a visit agree on one q.
 *
 * The signs of a loss in the steps of a visit come from the tries of each step (`lossSigns`). A broken family
 * leaves the other family with no loss, but a loss changes each family.
 */
function lossDegrees(): readonly Degree[] {
  return LOSS_DEGREES.map((degree) => ({
    id: degree.id,
    summary: `Each exchange loses a packet with the chance ${degree.loss}.`,
    share: degree.share,
    predicts: lossSigns(degree.loss),
  }));
}

/**
 * The faults of the standard catalog. Each prediction is a rule of practice. The lab runs (ND-7) then fit the
 * distributions, and the priors.
 */
export const STANDARD_FAULTS: readonly Fault[] = [
  {
    id: "interface.down",
    part: "interface",
    layer: "link",
    reach: "shared",
    summary: "The network interface has no link.",
    step: "Connect the cable or the Wi-Fi network, and make sure that the interface is on.",
    predicts: {
      "link.state": { expect: "down", strength: "sure" },
      "gateway.reply": { expect: "none", strength: "sure" },
    },
    degrees: [
      {
        id: "no-route",
        summary: "The interface is down, so the computer has no route. Each send fails at once.",
        share: 1,
        predicts: {
          // With no route, c-ares cannot send the query and gives ECONNREFUSED.
          "dns.answer": { expect: "unreachable", strength: "strong" },
          "icmp.reply": { expect: "unreachable", strength: "sure" },
          "tcp.connect": { expect: "unreachable", strength: "sure" },
        },
      },
      {
        id: "no-carrier",
        summary: "The interface has no carrier, but it keeps its routes. Thus the DNS queries time out.",
        share: 1,
        predicts: {
          "dns.answer": { expect: "timeout", strength: "strong" },
          // No world of the labs makes this mode yet. The failed ARP search for the gateway can give "unreachable".
          "icmp.reply": { expect: ["none", "unreachable"], strength: "sure" },
          "tcp.connect": { expect: ["timeout", "unreachable"], strength: "sure" },
        },
      },
    ],
  },
  {
    id: "wifi.weak",
    part: "wifi",
    layer: "wifi",
    reach: "shared",
    summary: "The Wi-Fi signal is weak, so the link loses packets.",
    step: "Move nearer to the access point, or use a cable.",
    predicts: {
      "wifi.signal": { expect: "weak", strength: "strong" },
      // A weak Wi-Fi needs a Wi-Fi link. With no connected Wi-Fi interface, only a wrong read gives this fault.
      "wifi.state": { connected: 0.999, none: 0.001 },
    },
    // A frame that the radio loses is a lost packet for TCP, so the signs of the loss are those of `path.loss`. The radio
    // is the first link, so the loss starts before the gateway.
    degrees: lossDegrees(),
  },
  {
    id: "gateway.down",
    part: "gateway",
    layer: "route",
    reach: "shared",
    summary: "The gateway does not forward packets.",
    step: "Restart the router, or examine the link from the router to the provider.",
    predicts: {
      "gateway.reply": { expect: "none", strength: "strong" },
      "dns.answer": { expect: "timeout", strength: "strong" },
    },
    degrees: [
      {
        id: "silent",
        summary: "The gateway drops each packet.",
        share: 1,
        predicts: {
          "icmp.reply": { expect: "none", strength: "strong" },
          "tcp.connect": { expect: "timeout", strength: "strong" },
        },
      },
      {
        id: "unreachable",
        summary: "The gateway or the computer answers that each host past the gateway is unreachable.",
        share: 1,
        predicts: {
          "icmp.reply": { expect: "unreachable", strength: "strong" },
          "tcp.connect": { expect: "unreachable", strength: "strong" },
        },
      },
    ],
  },
  {
    id: "captive.portal",
    part: "gateway",
    layer: "http",
    reach: "shared",
    summary: "A captive portal holds the traffic until you sign in.",
    step: "Open a web page in a browser, and accept the terms of the network.",
    predicts: {
      "dns.address": { expect: "private", strength: "usual" },
      "tls.handshake": { expect: "cert-error", strength: "strong" },
      "tls.trust": { expect: "private", strength: "usual" },
      "tls.root": { expect: "changed", strength: "usual" },
    },
  },
  {
    id: "resolver.down",
    part: "resolver",
    layer: "dns",
    reach: "shared",
    summary: "The DNS resolver does not answer.",
    step: "Use a different DNS resolver, or examine the resolver of the router.",
    predicts: {},
    degrees: [
      {
        id: "silent",
        summary: "The resolver drops each query.",
        share: 1,
        predicts: { "dns.answer": { expect: "timeout", strength: "strong" } },
      },
      {
        id: "absent",
        summary: "No DNS service listens on the resolver, so its host answers that the port is unreachable.",
        share: 1,
        predicts: { "dns.answer": { expect: "unreachable", strength: "strong" } },
      },
    ],
  },
  {
    id: "resolver.failing",
    part: "resolver",
    layer: "dns",
    reach: "shared",
    summary: "The DNS resolver answers with an error for each name.",
    step: "Use a different DNS resolver, and examine the DNSSEC settings of the resolver.",
    predicts: {},
    degrees: [
      {
        id: "servfail",
        summary: "The resolver answers SERVFAIL, for example when it reaches no authoritative server.",
        share: 1,
        predicts: { "dns.answer": { expect: "servfail", strength: "strong" } },
      },
      {
        id: "refused",
        summary: "The resolver answers REFUSED, for example to a client that is not in its networks.",
        share: 1,
        predicts: { "dns.answer": { expect: "refused", strength: "strong" } },
      },
    ],
  },
  {
    id: "name.missing",
    part: "service",
    layer: "dns",
    reach: "target",
    summary: "The name does not exist in DNS.",
    step: "Examine the spelling of the name, and the records of its DNS zone.",
    predicts: {
      "dns.answer": { expect: "nxdomain", strength: "strong" },
    },
  },
  {
    id: "port.closed",
    part: "service",
    layer: "tcp",
    reach: "target",
    summary: "No program listens on the port.",
    step: "Start the service, or use the correct port.",
    predicts: {
      "tcp.connect": { expect: "refused", strength: "strong" },
    },
  },
  {
    id: "host.down",
    part: "service",
    layer: "ip",
    reach: "target",
    summary: "The host is down.",
    step: "Start the host, or examine its network link.",
    predicts: {},
    degrees: [
      {
        id: "silent",
        summary: "The host does not answer, and no router sends an ICMP message for it.",
        share: 1,
        predicts: {
          "tcp.connect": { expect: "timeout", strength: "strong" },
          "icmp.reply": { expect: "none", strength: "strong" },
        },
      },
      {
        id: "unreachable",
        summary: "The last router answers that the host is unreachable, because the host does not answer its ARP search.",
        share: 1,
        predicts: {
          "tcp.connect": { expect: "unreachable", strength: "strong" },
          "icmp.reply": { expect: "unreachable", strength: "strong" },
        },
      },
    ],
  },
  {
    id: "filter.drop",
    part: "path",
    layer: "tcp",
    reach: "target",
    summary: "A filter drops the packets to the port.",
    step: "Examine the firewall rules of the host and of each network on the path.",
    predicts: {
      "tcp.connect": { expect: "timeout", strength: "strong" },
    },
    // The filter drops the ping too, or it does not. This mode is the same for each ping of a visit, so it is a degree.
    // The degree all gives the facts of the degree silent of host.down: the two causes are alike for these probes.
    degrees: [
      { id: "port", summary: "The filter drops only the packets to the port. The ping passes.", share: 1 },
      {
        id: "all",
        summary: "The filter drops each packet to the host, also the ping.",
        share: 1,
        predicts: { "icmp.reply": { expect: "none", strength: "strong" } },
      },
    ],
  },
  {
    id: "filter.icmp",
    part: "path",
    layer: "ip",
    reach: "target",
    summary: "A filter blocks ICMP. The host is up.",
    step: "No step is necessary for the service. Use TCP to examine the host.",
    predicts: {
      "icmp.reply": { expect: "none", strength: "strong" },
    },
  },
  {
    id: "filter.reset",
    part: "path",
    layer: "tcp",
    reach: "target",
    summary: "A device on the path resets the connections.",
    step: "Examine the firewalls and the filters of content on the path, and try a different network.",
    predicts: {
      "tcp.connect": { connected: 0.5, refused: 0.02, timeout: 0.02, unreachable: 0.02, reset: 0.44 },
      "tls.handshake": { expect: "reset", strength: "strong" },
    },
  },
  {
    id: "path.loss",
    part: "path",
    layer: "path",
    // A loss in the local network is shared and shows at the gateway. A loss in the network of the provider is upstream.
    // The two are the places near the client. Together they have the same part of the prior as a loss near the target.
    reach: ["shared", "upstream", "target"],
    reachShares: { target: 2 },
    summary: "A network on the path loses packets.",
    step: "Find the first hop with loss, and tell the provider of that network.",
    predicts: {},
    degrees: lossDegrees(),
  },
  {
    id: "path.mtu",
    part: "path",
    layer: "path",
    reach: ["shared", "target"],
    summary: "Large packets do not pass, and no ICMP message tells the size (an MTU black hole).",
    step: "Lower the MTU of the interface or of the VPN, or enable MSS clamping on the router.",
    predicts: {
      "path.mtu": { expect: "silent", strength: "strong" },
      "tls.handshake": { expect: "timeout", strength: "strong" },
      "http.status": { expect: "none", strength: "usual" },
    },
  },
  {
    id: "ipv6.broken",
    part: "path",
    layer: "ip",
    reach: ["shared", "target"],
    summary: "IPv6 does not work, and IPv4 works.",
    step: "Examine the IPv6 settings of the router, or turn off IPv6 until the provider repairs it.",
    predicts: {
      "ip.family": { expect: "ipv4-only", strength: "strong" },
      "tcp.time": { expect: ["long", "retry"], strength: "weak" },
    },
  },
  {
    id: "tls.proxy",
    part: "path",
    layer: "tls",
    reach: ["shared", "target"],
    summary: "A proxy examines the TLS traffic.",
    step: "Compare the issuer of the certificate with the issuer on a different network, and ask the owner of the network.",
    predicts: {
      "tls.ratio": { expect: ["mid", "high"], strength: "usual" },
      "tls.trust": { expect: "private", strength: "usual" },
      "tls.root": { expect: "changed", strength: "usual" },
      "tcp.time": { expect: "short", strength: "strong" },
    },
  },
  {
    id: "tls.cert-invalid",
    part: "service",
    layer: "tls",
    reach: "target",
    summary: "The certificate of the server is not valid: it expired, it is for a different name, or its chain ends at no trusted root.",
    step: "Renew the certificate of the server, or correct its names and its chain.",
    predicts: {
      "tls.handshake": { expect: "cert-error", strength: "strong" },
    },
    degrees: [
      { id: "kept-root", summary: "A certificate of the chain expired, or the certificate is for a different name. The root of the chain does not change.", share: 2 },
      {
        id: "chain",
        summary: "The chain of the certificate ends at a root that the client does not trust.",
        share: 1,
        predicts: { "tls.trust": { expect: "private", strength: "usual" }, "tls.root": { expect: "changed", strength: "usual" } },
      },
    ],
  },
  {
    id: "tls.mismatch",
    part: "service",
    layer: "tls",
    reach: "target",
    summary: "The client and the server have no TLS version or cipher in common.",
    step: "Enable TLS 1.2 or TLS 1.3 with modern ciphers on the server.",
    predicts: {
      "tls.handshake": { expect: "alert", strength: "strong" },
    },
  },
  {
    id: "server.slow",
    part: "service",
    layer: "http",
    reach: "target",
    summary: "The server is slow.",
    step: "Examine the load and the logs of the server.",
    predicts: {
      "http.ttfb": { expect: "high", strength: "strong" },
      "tls.ratio": { expect: ["mid", "high"], strength: "weak" },
    },
  },
  {
    id: "server.error",
    part: "service",
    layer: "http",
    reach: "target",
    summary: "The server answers with an error.",
    step: "Examine the logs of the server and of its upstream services.",
    predicts: {
      "http.status": { expect: "server-error", strength: "strong" },
    },
  },
  {
    id: "proxy.error",
    part: "path",
    layer: "http",
    reach: ["shared", "target"],
    summary: "A proxy of the network fails, and it answers the requests with errors.",
    step: "Ask the owner of the network to repair the proxy, and compare the site on a different network.",
    predicts: {
      // A device of the network can give an HTTP status for an HTTPS site only as a TLS proxy that the clients trust.
      "tls.trust": { expect: "private", strength: "strong" },
      "http.status": { expect: "server-error", strength: "strong" },
    },
  },
];

/** The standard catalog: the rules of practice as the first likelihoods. Each hypothesis has the prior weight 1. */
export const STANDARD_CATALOG_SPEC: CatalogSpec = {
  version: "14",
  features: STANDARD_FEATURES,
  faults: STANDARD_FAULTS,
};

/** The standard catalog, compiled. */
export const STANDARD_CATALOG: Catalog = (() => {
  const compiled = compileCatalog(STANDARD_CATALOG_SPEC);
  if (compiled.tag === "err") throw new Error(`The standard catalog has problems: ${compiled.error.join(" ")}`);
  return compiled.value;
})();
