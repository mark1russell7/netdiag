/** The addresses of the lab hosts. Each address is for the lab only. */
export interface LabHosts {
  readonly target: string;
  readonly reference: string;
  readonly resolver: string;
  readonly portal: string;
  /** The CIDR ranges of the addresses. The scope of the runner has these ranges only. */
  readonly ranges: readonly string[];
}

/**
 * The hosts of the lab in CI. The target and the reference have public addresses of the documentation range
 * `203.0.113.0/24`, so the readers see them as hosts on the internet. The portal has a private address.
 */
export const CI_HOSTS: LabHosts = {
  target: "203.0.113.10",
  reference: "203.0.113.20",
  resolver: "203.0.113.53",
  portal: "192.168.250.80",
  ranges: ["203.0.113.0/24", "192.168.250.80/32"],
};

/**
 * The hosts of the lab on a computer with no set-up. The readers see each loopback address as private, so a local run
 * examines the mechanics of the lab, not its accuracy.
 */
export const LOCAL_HOSTS: LabHosts = {
  target: "127.0.0.10",
  reference: "127.0.0.20",
  resolver: "127.0.0.153",
  portal: "127.0.0.80",
  ranges: ["127.0.0.0/8"],
};

/** The name of the target. The lab resolver is the only server that gets this name. */
export const TARGET_NAME = "www.shop-lab.net";
/** The name of the reference host, a second site that the diagnosis compares with the target. */
export const REFERENCE_NAME = "www.ref-lab.org";
/** The name in a certificate for a different host. */
export const OTHER_NAME = "www.other-lab.net";
/** The name of the captive portal. */
export const PORTAL_NAME = "login.wifi-lab.net";

/** The certificate of a lab host: from the lab root, from the root of a TLS proxy, or self-signed. */
export type Certificate = "valid" | "expired" | "wrong-name" | "proxy" | "self-signed";

/** A lab host. Each field that is not set has the healthy value. */
export interface HostSpec {
  /** The value `false` tells that no program listens on the port. The default is `true`. */
  readonly listening?: boolean | undefined;
  /** The default is `valid`. */
  readonly certificate?: Certificate | undefined;
  /** The value `true` gives the server only a cipher that the client does not accept. */
  readonly legacy?: boolean | undefined;
  /** The time that a proxy on the path holds the first reply of the handshake, in milliseconds. */
  readonly handshakeDelayMs?: number | undefined;
  /** The HTTP status of the reply. The default is 200. */
  readonly status?: number | undefined;
  /** The time from the request to the reply, in milliseconds. */
  readonly responseDelayMs?: number | undefined;
}

/** The DNS resolver of the lab. */
export interface DnsSpec {
  /**
   * - `answer`: the resolver answers from its zone.
   * - `silent`: the resolver gets each query and does not answer.
   * - `servfail`: the resolver answers `SERVFAIL` for each name.
   * - `absent`: no program listens on the port of the resolver.
   */
  readonly mode: "answer" | "silent" | "servfail" | "absent";
  /** The value `true` removes the target name from the zone. */
  readonly missing?: boolean | undefined;
  /** The value `true` gives the address of the captive portal for each name. */
  readonly portal?: boolean | undefined;
}

/**
 * A sign of a case: one value of the evidence that the fault of the case causes. A run with no sign did not make the
 * fault, so it gives no read.
 */
export interface Sign {
  readonly feature: string;
  readonly primary: boolean;
  readonly value: string;
}

/** A case of the lab: a fault, its world and its signs. */
export interface LabCase {
  readonly id: string;
  /** The id of the hypothesis of the catalog that is true in the world of the case. */
  readonly truth: string;
  readonly summary: string;
  readonly dns: DnsSpec;
  readonly target: HostSpec;
  readonly reference: HostSpec;
  readonly signs: readonly Sign[];
}

/** The host of the captive portal. Its certificate is self-signed, for the name of the portal. */
export const PORTAL: HostSpec = { certificate: "self-signed" };

/** The time that a TLS proxy holds the first reply of the handshake while it connects to the server, in milliseconds. */
export const PROXY_DELAY_MS = 120;
/** The time that a slow server takes to reply, in milliseconds. */
export const SLOW_REPLY_MS = 1500;

const HEALTHY: HostSpec = {};
const ANSWER: DnsSpec = { mode: "answer" };
const sign = (feature: string, value: string, primary = true): Sign => ({ feature, primary, value });

/** The cases of the loopback lab. Each fault of the loopback column of the roadmap has one case or more. */
export const LOOPBACK_CASES: readonly LabCase[] = [
  {
    id: "none",
    truth: "none",
    summary: "Each part works.",
    dns: ANSWER,
    target: HEALTHY,
    reference: HEALTHY,
    signs: [sign("http.status", "ok"), sign("http.status", "ok", false)],
  },
  {
    id: "resolver.down/silent",
    truth: "resolver.down",
    summary: "The resolver gets each query and does not answer.",
    dns: { mode: "silent" },
    target: HEALTHY,
    reference: HEALTHY,
    signs: [sign("dns.answer", "timeout"), sign("dns.answer", "timeout", false)],
  },
  {
    id: "resolver.down/absent",
    truth: "resolver.down",
    summary: "No program listens on the port of the resolver.",
    dns: { mode: "absent" },
    target: HEALTHY,
    reference: HEALTHY,
    signs: [sign("dns.answer", "unreachable"), sign("dns.answer", "unreachable", false)],
  },
  {
    id: "resolver.failing",
    truth: "resolver.failing",
    summary: "The resolver answers SERVFAIL for each name.",
    dns: { mode: "servfail" },
    target: HEALTHY,
    reference: HEALTHY,
    signs: [sign("dns.answer", "servfail"), sign("dns.answer", "servfail", false)],
  },
  {
    id: "name.missing",
    truth: "name.missing",
    summary: "The zone has no target name.",
    dns: { mode: "answer", missing: true },
    target: HEALTHY,
    reference: HEALTHY,
    signs: [sign("dns.answer", "nxdomain"), sign("dns.answer", "ok", false)],
  },
  {
    id: "port.closed",
    truth: "port.closed",
    summary: "No program listens on the port of the target.",
    dns: ANSWER,
    target: { listening: false },
    reference: HEALTHY,
    signs: [sign("tcp.connect", "refused"), sign("http.status", "ok", false)],
  },
  {
    id: "tls.cert-invalid/expired",
    truth: "tls.cert-invalid",
    summary: "The certificate of the target expired.",
    dns: ANSWER,
    target: { certificate: "expired" },
    reference: HEALTHY,
    signs: [sign("tls.handshake", "cert-error"), sign("http.status", "ok", false)],
  },
  {
    id: "tls.cert-invalid/wrong-name",
    truth: "tls.cert-invalid",
    summary: "The certificate of the target is for a different name.",
    dns: ANSWER,
    target: { certificate: "wrong-name" },
    reference: HEALTHY,
    signs: [sign("tls.handshake", "cert-error"), sign("http.status", "ok", false)],
  },
  {
    id: "tls.mismatch",
    truth: "tls.mismatch",
    summary: "The target has only a cipher that the client does not accept.",
    dns: ANSWER,
    target: { legacy: true },
    reference: HEALTHY,
    signs: [sign("tls.handshake", "alert"), sign("http.status", "ok", false)],
  },
  {
    id: "tls.proxy",
    truth: "tls.proxy",
    summary: "A TLS proxy with a root that the user trusts examines each connection.",
    dns: ANSWER,
    target: { certificate: "proxy", handshakeDelayMs: PROXY_DELAY_MS },
    reference: { certificate: "proxy", handshakeDelayMs: PROXY_DELAY_MS },
    signs: [sign("tls.trust", "private"), sign("tls.handshake", "ok"), sign("tls.trust", "private", false)],
  },
  {
    id: "server.slow",
    truth: "server.slow",
    summary: "The target replies after a long time.",
    dns: ANSWER,
    target: { responseDelayMs: SLOW_REPLY_MS },
    reference: HEALTHY,
    signs: [sign("http.ttfb", "high"), sign("http.status", "ok", false)],
  },
  {
    id: "server.error",
    truth: "server.error",
    summary: "The target replies with the status 503.",
    dns: ANSWER,
    target: { status: 503 },
    reference: HEALTHY,
    signs: [sign("http.status", "server-error"), sign("http.status", "ok", false)],
  },
  {
    id: "captive.portal",
    truth: "captive.portal",
    summary: "The resolver gives the address of a captive portal for each name.",
    dns: { mode: "answer", portal: true },
    target: HEALTHY,
    reference: HEALTHY,
    signs: [sign("dns.address", "private"), sign("tls.handshake", "cert-error"), sign("dns.address", "private", false)],
  },
];
