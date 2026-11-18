import { compileCatalog, type Catalog, type CatalogSpec, type Degree, type Feature, type Fault, type Prediction } from "./model.ts";

/**
 * The features of the standard catalog.
 *
 * The readers of the facts give these features. The distribution `healthy` of each feature is a rule of practice. The
 * lab runs (ND-7) then fit it.
 */
export const STANDARD_FEATURES: readonly Feature[] = [
  {
    id: "link.state",
    layer: "link",
    summary: "The state of the link of the network interface.",
    values: ["up", "down"],
    healthy: { up: 0.999, down: 0.001 },
  },
  {
    id: "wifi.signal",
    layer: "wifi",
    summary: "The strength of the Wi-Fi signal: strong at -60 dBm or more, weak below -75 dBm.",
    values: ["strong", "fair", "weak"],
    healthy: { strong: 0.7, fair: 0.25, weak: 0.05 },
  },
  {
    id: "wifi.state",
    layer: "wifi",
    summary: "The Wi-Fi of this computer: connected when a Wi-Fi interface is connected, none when the Wi-Fi tool finds no connected interface.",
    values: ["connected", "none"],
    healthy: { connected: 0.6, none: 0.4 },
  },
  {
    id: "gateway.reply",
    layer: "route",
    summary: "The gateway answers an ICMP echo request.",
    values: ["reply", "none"],
    healthy: { reply: 0.97, none: 0.03 },
  },
  {
    id: "path.loss",
    layer: "path",
    summary: "The packet loss on the path: none, some (up to 5 %) or high (more than 5 %).",
    values: ["none", "some", "high"],
    healthy: { none: 0.9, some: 0.08, high: 0.02 },
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
 * This function gives the degrees of a fault that loses packets, with the predictions of the fault for each degree.
 *
 * Under a light loss, each try passes after a few repeats, so DNS, TCP and HTTP succeed. Under a heavy loss, each DNS
 * try, each SYN and each request can fail. Thus the timeouts come together with the loss, at each host that the loss
 * reaches. Most losses in the field are light, so the degree light has 3 parts of the prior and the degree heavy 1.
 */
function lossDegrees(light: Readonly<Record<string, Prediction>>, heavy: Readonly<Record<string, Prediction>>): readonly Degree[] {
  return [
    { id: "light", summary: "A small share of the packets is lost. Each try passes after a few repeats.", share: 3, predicts: light },
    {
      id: "heavy",
      summary: "A large share of the packets is lost, so DNS, TCP and HTTP can time out.",
      share: 1,
      predicts: {
        "path.loss": { expect: "high", strength: "strong" },
        "dns.answer": { expect: ["ok", "timeout"], strength: "strong" },
        "tcp.connect": { expect: ["connected", "timeout"], strength: "strong" },
        "tls.handshake": { expect: ["ok", "timeout"], strength: "strong" },
        "http.status": { expect: ["ok", "none"], strength: "strong" },
        ...heavy,
      },
    },
  ];
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
      // With no route, c-ares cannot send the query and gives ECONNREFUSED. A link with no carrier keeps its routes, so its queries time out.
      "dns.answer": { expect: ["unreachable", "timeout"], strength: "strong" },
      "icmp.reply": { expect: ["none", "unreachable"], strength: "sure" },
      "tcp.connect": { expect: ["unreachable", "timeout"], strength: "sure" },
    },
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
      "wifi.state": { expect: "connected", strength: "sure" },
      "path.loss": { expect: ["some", "high"], strength: "usual" },
      // The radio sends each lost frame again, so a connect is slow, or the client sends the SYN again.
      "tcp.time": { expect: ["long", "retry"], strength: "usual" },
    },
    degrees: lossDegrees({}, {}),
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
      "icmp.reply": { expect: ["none", "unreachable"], strength: "strong" },
      "tcp.connect": { expect: ["timeout", "unreachable"], strength: "strong" },
    },
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
    },
  },
  {
    id: "resolver.down",
    part: "resolver",
    layer: "dns",
    reach: "shared",
    summary: "The DNS resolver does not answer.",
    step: "Use a different DNS resolver, or examine the resolver of the router.",
    predicts: {
      "dns.answer": { expect: ["timeout", "unreachable"], strength: "strong" },
    },
  },
  {
    id: "resolver.failing",
    part: "resolver",
    layer: "dns",
    reach: "shared",
    summary: "The DNS resolver answers with an error for each name.",
    step: "Use a different DNS resolver, and examine the DNSSEC settings of the resolver.",
    predicts: {
      "dns.answer": { expect: ["servfail", "refused"], strength: "strong" },
    },
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
    predicts: {
      "tcp.connect": { expect: ["timeout", "unreachable"], strength: "strong" },
      "icmp.reply": { expect: ["none", "unreachable"], strength: "strong" },
    },
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
      "icmp.reply": { reply: 0.5, none: 0.45, unreachable: 0.05 },
    },
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
    reach: ["shared", "target"],
    summary: "A network on the path loses packets.",
    step: "Find the first hop with loss, and tell the provider of that network.",
    predicts: {
      "path.loss": { expect: ["some", "high"], strength: "strong" },
      "http.ttfb": { expect: ["mid", "high"], strength: "weak" },
    },
    // A loss does not slow a connect: each SYN passes at once, or the client sends it again after 1 s. Under a loss s in
    // both directions, a SYN passes at once with the probability (1 - s)^2. Thus a light loss mostly gives short, and a heavy loss retry.
    degrees: lossDegrees({ "tcp.time": { short: 0.7, retry: 0.25, long: 0.05 } }, { "tcp.time": { short: 0.25, retry: 0.7, long: 0.05 } }),
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
      "tcp.time": { expect: "short", strength: "strong" },
    },
  },
  {
    id: "tls.cert-invalid",
    part: "service",
    layer: "tls",
    reach: "target",
    summary: "The certificate of the server is not valid: it expired, or it is for a different name.",
    step: "Renew the certificate of the server, or correct its names.",
    predicts: {
      "tls.handshake": { expect: "cert-error", strength: "strong" },
    },
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
  version: "8",
  features: STANDARD_FEATURES,
  faults: STANDARD_FAULTS,
};

/** The standard catalog, compiled. */
export const STANDARD_CATALOG: Catalog = (() => {
  const compiled = compileCatalog(STANDARD_CATALOG_SPEC);
  if (compiled.tag === "err") throw new Error(`The standard catalog has problems: ${compiled.error.join(" ")}`);
  return compiled.value;
})();
