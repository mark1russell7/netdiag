import { addressKind, canonicalAddress } from "./address/index.ts";
import type { Evidence } from "./diagnosis/model.ts";
import { isFactOf, type Fact, type FactKind } from "./fact.ts";
import { wifiSignalOf } from "./metrics/wifi.ts";
import {
  DNS_ANSWER,
  HTTP_RESPONSE,
  ICMP_ECHO,
  LINK_STATE,
  PATH_MTU,
  PATH_REPORT,
  PATH_TRACE,
  TCP_CONNECT,
  TLS_HANDSHAKE,
  WIFI_LINK,
  type ConnectOutcome,
  type DnsAnswer,
  type DnsOutcome,
  type EchoOutcome,
  type HandshakeOutcome,
  type HttpResponse,
  type IcmpEcho,
  type LinkState,
  type LinkStateValue,
  type MtuStop,
  type PathMtu,
  type PathReport,
  type PathTrace,
  type TcpConnect,
  type TlsHandshake,
  type Trust,
  type WifiLink,
} from "./kinds.ts";

// The readers change facts into evidence for the model. Each value that they give is a value of a feature of the
// standard catalog, and a test holds it.

/** A fact that gave no evidence, with the reason in plain words. */
export interface Skipped {
  readonly fact: string;
  readonly reason: string;
}

/** The evidence of a list of facts, and the facts that gave no evidence. */
export interface Reading {
  readonly evidence: readonly Evidence[];
  readonly skipped: readonly Skipped[];
}

/** The options of `readEvidence`. */
export interface ReadOptions {
  /** This function tells if a fact is about the target (`true`) or about a reference host (`false`). The default is `true`. */
  readonly primary?: ((fact: Fact) => boolean) | undefined;
  /**
   * The IP address of the default gateway. The ICMP echo facts of this address give the feature `gateway.reply`. The
   * ICMP echo facts of the other addresses give the feature `icmp.reply`.
   */
  readonly gateway?: string | undefined;
}

/** A bin of a time or a ratio. A number below `below` gets `value`. The last bin has no limit. */
export interface Bin {
  readonly below?: number | undefined;
  readonly value: string;
}

/** The bins of the feature `tcp.time`, in milliseconds. A connect of 900 ms or more sent its SYN again. */
export const TCP_TIME_BINS: readonly Bin[] = [{ below: 150, value: "short" }, { below: 900, value: "long" }, { value: "retry" }];

/** The bins of the feature `tls.ratio`: the time of the TLS handshake divided by the time of the TCP connect. */
export const TLS_RATIO_BINS: readonly Bin[] = [{ below: 3, value: "low" }, { below: 8, value: "mid" }, { value: "high" }];

/** The bins of the feature `http.ttfb`: the time to the first byte divided by the time of the TCP connect. */
export const HTTP_TTFB_BINS: readonly Bin[] = [{ below: 4, value: "low" }, { below: 20, value: "mid" }, { value: "high" }];

/**
 * The smallest time of a TCP connect in a ratio, in milliseconds. On a local link, a ratio with a smaller time measures
 * only the cost of the cryptography.
 */
export const MIN_CONNECT_MS = 1;

/** The value of the feature `dns.answer` for each outcome of a DNS query. `nodata` tells that the name exists. */
export const DNS_ANSWER_VALUES: Readonly<Partial<Record<DnsOutcome, string>>> = {
  ok: "ok",
  nodata: "ok",
  nxdomain: "nxdomain",
  servfail: "servfail",
  refused: "refused",
  timeout: "timeout",
  unreachable: "unreachable",
};

/** The value of the feature `tcp.connect` for each outcome of a TCP connect. */
export const TCP_CONNECT_VALUES: Readonly<Partial<Record<ConnectOutcome, string>>> = {
  connected: "connected",
  refused: "refused",
  timeout: "timeout",
  unreachable: "unreachable",
  reset: "reset",
};

/**
 * The value of the feature `tls.handshake` for each outcome of a TLS handshake. The catalog has no value for `not-tls`
 * and `closed` yet. The lab runs (ND-7) tell which faults cause them.
 */
export const TLS_HANDSHAKE_VALUES: Readonly<Partial<Record<HandshakeOutcome, string>>> = {
  ok: "ok",
  "cert-error": "cert-error",
  alert: "alert",
  timeout: "timeout",
  reset: "reset",
};

/** The value of the feature `tls.trust` for each trust. A chain that ends at no root of the store has no public root. */
export const TLS_TRUST_VALUES: Readonly<Record<Trust, string>> = { public: "public", private: "private", none: "private" };

/** The value of the feature `icmp.reply` for each outcome of the ICMP echo requests to an address. */
export const ICMP_REPLY_VALUES: Readonly<Partial<Record<EchoOutcome, string>>> = { reply: "reply", none: "none", unreachable: "unreachable" };

/** The value of the feature `link.state` for each state of a link fact. */
export const LINK_STATE_VALUES: Readonly<Record<LinkStateValue, string>> = { up: "up", down: "down" };

/**
 * The value of the feature `path.mtu` for each stop of a measured MTU. A measured MTU with no stop has the value `full`.
 * A message makes the value `reduced`, because path MTU discovery works.
 */
export const PATH_MTU_VALUES: Readonly<Record<MtuStop | "full", string>> = { full: "full", message: "reduced", silent: "silent" };

/**
 * The value of the feature `gateway.reply` for each outcome of the ICMP echo requests to the gateway. When this computer
 * tells that the gateway is unreachable, the gateway gives no reply.
 */
export const GATEWAY_REPLY_VALUES: Readonly<Partial<Record<EchoOutcome, string>>> = { reply: "reply", none: "none", unreachable: "none" };

/**
 * The bins of the feature `path.loss`, on the share of the echo requests with a reply. A share of 1 has no loss. A share
 * of 0.95 or more has a loss of up to 5 %.
 */
export const PATH_LOSS_BINS: readonly Bin[] = [{ below: 0.95, value: "high" }, { below: 1, value: "some" }, { value: "none" }];

/**
 * The smallest number of echo requests that gives the feature `path.loss`. With 20 requests, one lost request is a loss
 * of 5 %. With no reply, the feature `icmp.reply` tells the result, not `path.loss`.
 */
export const LOSS_MIN_SENT = 20;

/**
 * The bins of the feature `wifi.signal`, on the signal level in dBm. A level below -75 dBm is weak. A level of -60 dBm or
 * more is strong.
 */
export const WIFI_SIGNAL_BINS: readonly Bin[] = [{ below: -75, value: "weak" }, { below: -60, value: "fair" }, { value: "strong" }];

/** The suffixes of the names of local networks and of the special-use names (RFC 6761, RFC 6762 and RFC 8375). */
export const LOCAL_SUFFIXES: readonly string[] = ["local", "localhost", "test", "invalid", "example", "home.arpa", "internal", "lan", "home", "corp", "intranet", "private"];

/** This function gives the value of the first bin that holds `x`. */
export function binOf(bins: readonly Bin[], x: number): string {
  for (const bin of bins) if (bin.below === undefined || x < bin.below) return bin.value;
  throw new RangeError("The last bin has a limit.");
}

/** This function tells if a name is a local name: a name with one label, or a name with a local suffix. */
export function isLocalName(name: string): boolean {
  const lower = name.toLowerCase().replace(/\.$/, "");
  if (!lower.includes(".")) return true;
  return LOCAL_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`));
}

interface Slot {
  readonly feature: string;
  readonly primary: boolean;
  value: string;
  readonly facts: string[];
}

interface Facts {
  readonly dns: Fact<DnsAnswer>[];
  readonly tcp: Fact<TcpConnect>[];
  readonly tls: Fact<TlsHandshake>[];
  readonly http: Fact<HttpResponse>[];
  readonly icmp: Fact<IcmpEcho>[];
  readonly report: Fact<PathReport>[];
  readonly trace: Fact<PathTrace>[];
  readonly link: Fact<LinkState>[];
  readonly mtu: Fact<PathMtu>[];
  readonly wifi: Fact<WifiLink>[];
}

/**
 * The fact kinds that each feature of the readers needs. A feature comes from the facts of each kind of one of its sets.
 * For example, `tls.ratio` needs a TLS handshake and the TCP connect before it.
 */
export const FEATURE_SOURCES: Readonly<Record<string, readonly (readonly string[])[]>> = {
  "dns.answer": [[DNS_ANSWER.kind]],
  "dns.address": [[DNS_ANSWER.kind]],
  "ip.family": [[DNS_ANSWER.kind, TCP_CONNECT.kind]],
  "tcp.connect": [[TCP_CONNECT.kind]],
  "tcp.time": [[TCP_CONNECT.kind]],
  "tls.handshake": [[TLS_HANDSHAKE.kind]],
  "tls.trust": [[TLS_HANDSHAKE.kind]],
  "tls.ratio": [[TLS_HANDSHAKE.kind, TCP_CONNECT.kind]],
  "http.status": [[HTTP_RESPONSE.kind]],
  "http.ttfb": [[HTTP_RESPONSE.kind, TCP_CONNECT.kind]],
  "link.state": [[LINK_STATE.kind]],
  "gateway.reply": [[ICMP_ECHO.kind]],
  "icmp.reply": [[ICMP_ECHO.kind]],
  "path.loss": [[ICMP_ECHO.kind], [PATH_REPORT.kind]],
  "path.mtu": [[PATH_MTU.kind]],
  "wifi.signal": [[WIFI_LINK.kind]],
};

/** The options of `featuresOf`. */
export interface FeaturesOptions {
  /**
   * This option tells if the ICMP echo facts are of the gateway (`true`) or of another address (`false`). The default
   * gives the features of the two.
   */
  readonly gateway?: boolean | undefined;
}

/**
 * This function gives the features that the facts of some kinds can give together, in the order of `FEATURE_SOURCES`.
 * The choice of the next probe uses it: a probe gives the facts of its kinds.
 */
export function featuresOf(kinds: readonly string[], options: FeaturesOptions = {}): string[] {
  const have = new Set(kinds);
  return Object.entries(FEATURE_SOURCES)
    .filter(([feature]) => !(feature === "gateway.reply" && options.gateway === false) && !(feature === "icmp.reply" && options.gateway === true))
    .filter(([, sources]) => sources.some((source) => source.every((kind) => have.has(kind))))
    .map(([feature]) => feature);
}

const READ_KINDS: readonly [keyof Facts, FactKind<unknown>][] = [
  ["dns", DNS_ANSWER],
  ["tcp", TCP_CONNECT],
  ["tls", TLS_HANDSHAKE],
  ["http", HTTP_RESPONSE],
  ["icmp", ICMP_ECHO],
  ["report", PATH_REPORT],
  ["trace", PATH_TRACE],
  ["link", LINK_STATE],
  ["mtu", PATH_MTU],
  ["wifi", WIFI_LINK],
];

/**
 * This function changes facts into evidence for the model.
 *
 * - The reader gives one evidence for each feature, subject and role. When a subject has more facts, the last fact decides.
 * - For `dns.answer`, one answer `ok` of a name and a resolver decides. For `dns.address`, one private address decides.
 * - The order of the facts is the order of the runner. A ratio uses the last TCP connect before the handshake or the request.
 * - An ICMP echo fact gives `gateway.reply` for the gateway, and `icmp.reply` for each other address.
 * - A link fact gives `link.state`, one for each gateway.
 * - An ICMP echo fact with replies to `LOSS_MIN_SENT` requests or more gives `path.loss`. A report of `mtr` gives it from
 *   the last hop, when the address answered there.
 * - A fact `path.mtu` with the outcome `measured` gives `path.mtu` for its address. `PATH_MTU_VALUES` gives the value.
 * - A Wi-Fi fact of a connected interface gives `wifi.signal`, one for each interface. A quality of Windows changes to dBm.
 * - A trace of `traceroute` gives no evidence. The catalog has no feature for the hops of a path.
 */
export function readEvidence(facts: readonly Fact[], options: ReadOptions = {}): Reading {
  const primaryOf = options.primary ?? (() => true);
  const slots = new Map<string, Slot>();
  const skipped: Skipped[] = [];
  const sorted: Facts = { dns: [], tcp: [], tls: [], http: [], icmp: [], report: [], trace: [], link: [], mtu: [], wifi: [] };

  for (const fact of facts) {
    const entry = READ_KINDS.find(([, kind]) => kind.kind === fact.kind);
    if (entry === undefined) skipped.push({ fact: fact.id, reason: `netdiag has no reader for the kind ${fact.kind}.` });
    else if (!entry[1].check(fact.value)) skipped.push({ fact: fact.id, reason: `The value does not pass the check of the kind ${fact.kind}.` });
    else (sorted[entry[0]] as Fact[]).push(fact);
  }

  /** This function puts a value in the slot of a feature and a group. A `sticky` value stays when a later fact disagrees. */
  const note = (feature: string, group: string, fact: Fact, value: string, sticky?: string): void => {
    const primary = primaryOf(fact);
    const key = `${feature}\u0000${primary ? 1 : 0}\u0000${group}`;
    const slot = slots.get(key);
    if (slot === undefined) slots.set(key, { feature, primary, value, facts: [fact.id] });
    else {
      if (slot.value !== sticky) slot.value = value;
      slot.facts.push(fact.id);
    }
  };
  const skip = (fact: Fact, feature: string, outcome: string): void => {
    skipped.push({ fact: fact.id, reason: `The outcome "${outcome}" of ${fact.kind} has no value of the feature ${feature}.` });
  };

  for (const fact of sorted.dns) {
    const answer = fact.value;
    const group = `${answer.name.toLowerCase()}\u0000${answer.resolver}`;
    const value = DNS_ANSWER_VALUES[answer.outcome];
    if (value === undefined) {
      skip(fact, "dns.answer", answer.outcome);
      continue;
    }
    note("dns.answer", group, fact, value, "ok");
    if (answer.addresses.length > 0 && !isLocalName(answer.name)) {
      const kinds = answer.addresses.map(addressKind);
      note("dns.address", group, fact, kinds.includes("private") ? "private" : "public", "private");
    }
  }

  readFamily(sorted, primaryOf, note);

  const subject = (value: { readonly address: string; readonly port: number }): string => `${value.address}\u0000${value.port}`;
  for (const fact of sorted.tcp) {
    const connect = fact.value;
    const value = TCP_CONNECT_VALUES[connect.outcome];
    if (value === undefined) {
      skip(fact, "tcp.connect", connect.outcome);
      continue;
    }
    note("tcp.connect", subject(connect), fact, value);
    if (connect.outcome === "connected") note("tcp.time", subject(connect), fact, binOf(TCP_TIME_BINS, connect.ms));
  }

  const connectBefore = (fact: Fact, value: { readonly address: string; readonly port: number }): Fact<TcpConnect> | undefined => {
    let best: Fact<TcpConnect> | undefined;
    for (const tcp of sorted.tcp) {
      const same = tcp.value.address === value.address && tcp.value.port === value.port && primaryOf(tcp) === primaryOf(fact);
      if (!same || tcp.value.outcome !== "connected" || tcp.time.end > fact.time.start) continue;
      if (best === undefined || tcp.time.end >= best.time.end) best = tcp;
    }
    return best;
  };
  const ratio = (ms: number, tcp: Fact<TcpConnect>): number => ms / Math.max(tcp.value.ms, MIN_CONNECT_MS);

  for (const fact of sorted.tls) {
    const handshake = fact.value;
    const group = `${subject(handshake)}\u0000${handshake.servername ?? ""}`;
    const value = TLS_HANDSHAKE_VALUES[handshake.outcome];
    if (value === undefined) {
      skip(fact, "tls.handshake", handshake.outcome);
      continue;
    }
    note("tls.handshake", group, fact, value);
    if (handshake.certificate !== undefined) note("tls.trust", group, fact, TLS_TRUST_VALUES[handshake.certificate.trust]);
    const tcp = handshake.outcome === "ok" || handshake.outcome === "cert-error" ? connectBefore(fact, handshake) : undefined;
    if (tcp !== undefined) note("tls.ratio", group, fact, binOf(TLS_RATIO_BINS, ratio(handshake.ms, tcp)));
  }

  for (const fact of sorted.http) {
    const response = fact.value;
    const group = [subject(response), response.scheme, response.host, response.method, response.path].join("\u0000");
    const status = statusValue(response);
    if (status === undefined) {
      skip(fact, "http.status", response.outcome === "response" ? `response ${response.status ?? ""}`.trim() : response.outcome);
      continue;
    }
    note("http.status", group, fact, status);
    const tcp = response.ttfbMs === undefined ? undefined : connectBefore(fact, response);
    if (tcp !== undefined && response.ttfbMs !== undefined) note("http.ttfb", group, fact, binOf(HTTP_TTFB_BINS, ratio(response.ttfbMs, tcp)));
  }

  const gateway = options.gateway === undefined ? undefined : canonicalAddress(options.gateway);
  for (const fact of sorted.icmp) {
    const echo = fact.value;
    const address = canonicalAddress(echo.address);
    const isGateway = address === gateway;
    const feature = isGateway ? "gateway.reply" : "icmp.reply";
    const value = (isGateway ? GATEWAY_REPLY_VALUES : ICMP_REPLY_VALUES)[echo.outcome];
    if (value === undefined) {
      skip(fact, feature, echo.outcome);
      continue;
    }
    note(feature, address, fact, value);
  }

  // The feature path.loss comes from ping and from mtr. The facts of both kinds go in the order of the runner.
  const lossFacts = new Set<Fact>([...sorted.icmp, ...sorted.report]);
  for (const fact of facts) {
    if (!lossFacts.has(fact)) continue;
    const loss = lossOf(fact);
    if (typeof loss === "string") skipped.push({ fact: fact.id, reason: loss });
    else if (loss !== undefined) note("path.loss", loss.address, fact, binOf(PATH_LOSS_BINS, loss.share));
  }

  for (const fact of sorted.mtu) {
    const mtu = fact.value;
    if (mtu.outcome !== "measured") skip(fact, "path.mtu", mtu.outcome);
    else note("path.mtu", canonicalAddress(mtu.address), fact, PATH_MTU_VALUES[mtu.stop ?? "full"]);
  }

  for (const fact of sorted.link) note("link.state", fact.value.gateway ?? "", fact, LINK_STATE_VALUES[fact.value.state]);

  for (const fact of sorted.wifi) {
    const link = fact.value;
    const level = wifiSignalOf(link);
    if (level !== undefined) note("wifi.signal", link.interface, fact, binOf(WIFI_SIGNAL_BINS, level));
    else if (link.state !== "connected") skipped.push({ fact: fact.id, reason: `The Wi-Fi interface ${link.interface} is ${link.state}, so it has no signal.` });
    else skipped.push({ fact: fact.id, reason: `The Wi-Fi fact of ${link.interface} has no signal level and no quality.` });
  }

  for (const fact of sorted.trace) {
    skipped.push({ fact: fact.id, reason: "The catalog has no feature for the hops of a path. The lab runs fit such a feature later." });
  }

  const evidence = [...slots.values()].map(({ feature, value, primary, facts: ids }) => ({ feature, value, primary, facts: ids }));
  return { evidence, skipped };
}

/**
 * This function gives the share of the probes with an answer, for the feature `path.loss`. It gives a reason when a report
 * of `mtr` gives no evidence, and `undefined` when an echo fact gives no share.
 */
function lossOf(fact: Fact): { readonly address: string; readonly share: number } | string | undefined {
  if (isFactOf(ICMP_ECHO, fact)) {
    const echo = fact.value;
    return echo.received > 0 && echo.sent >= LOSS_MIN_SENT ? { address: canonicalAddress(echo.address), share: echo.received / echo.sent } : undefined;
  }
  if (!isFactOf(PATH_REPORT, fact)) return undefined;
  const report = fact.value;
  const last = report.hops.at(-1);
  if (report.outcome !== "reached" || last === undefined) return `The outcome "${report.outcome}" of ${fact.kind} has no value of the feature path.loss.`;
  if (last.sent < LOSS_MIN_SENT) return `The last hop of the report has ${last.sent} probes. The feature path.loss needs ${LOSS_MIN_SENT} probes or more.`;
  return { address: canonicalAddress(report.address), share: last.received / last.sent };
}

function statusValue(response: HttpResponse): string | undefined {
  if (response.outcome === "error") return undefined;
  if (response.outcome !== "response") return "none";
  const status = response.status ?? 0;
  if (status >= 200 && status < 400) return "ok";
  if (status >= 400 && status < 500) return "client-error";
  if (status >= 500 && status < 600) return "server-error";
  return undefined;
}

/**
 * This function gives the feature `ip.family` for a name with IPv4 and IPv6 addresses. It needs a TCP connect to an
 * address of each family.
 */
function readFamily(sorted: Facts, primaryOf: (fact: Fact) => boolean, note: (feature: string, group: string, fact: Fact, value: string) => void): void {
  const names = new Map<string, { v4: Set<string>; v6: Set<string>; facts: Fact[]; primary: boolean }>();
  for (const fact of sorted.dns) {
    if (fact.value.outcome !== "ok") continue;
    const key = `${primaryOf(fact) ? 1 : 0}\u0000${fact.value.name.toLowerCase()}`;
    const entry = names.get(key) ?? { v4: new Set<string>(), v6: new Set<string>(), facts: [], primary: primaryOf(fact) };
    for (const address of fact.value.addresses) (fact.value.record === "A" ? entry.v4 : entry.v6).add(address);
    entry.facts.push(fact);
    names.set(key, entry);
  }
  for (const [key, entry] of names) {
    if (entry.v4.size === 0 || entry.v6.size === 0) continue;
    const tried = sorted.tcp.filter((tcp) => primaryOf(tcp) === entry.primary && (entry.v4.has(tcp.value.address) || entry.v6.has(tcp.value.address)));
    const works = (family: Set<string>): boolean | undefined => {
      const connects = tried.filter((tcp) => family.has(tcp.value.address));
      return connects.length === 0 ? undefined : connects.some((tcp) => tcp.value.outcome === "connected");
    };
    const v4 = works(entry.v4);
    const v6 = works(entry.v6);
    if (v4 === undefined || v6 === undefined || (!v4 && !v6)) continue;
    const value = v4 && v6 ? "both" : v4 ? "ipv4-only" : "ipv6-only";
    const evidenceFacts = [...entry.facts, ...tried];
    const [first, ...rest] = evidenceFacts;
    if (first === undefined) continue;
    note("ip.family", key, first, value);
    for (const fact of rest) note("ip.family", key, fact, value);
  }
}
