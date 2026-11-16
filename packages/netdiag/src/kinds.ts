import { defineFactKind, isPort, isRecord, isText, type FactKind } from "./fact.ts";

// The fact kinds of the native probes. This module imports no `node:` module, so a browser can read a record of facts.

function isDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function optional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

function isTextList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isText);
}

/** The outcomes of a DNS query. `nodata` tells that the name exists, but it has no record of the type. */
export const DNS_OUTCOMES = ["ok", "nodata", "nxdomain", "servfail", "refused", "timeout", "unreachable", "error"] as const;
export type DnsOutcome = (typeof DNS_OUTCOMES)[number];

/** The record types of a DNS query for addresses. */
export const RECORD_TYPES = ["A", "AAAA"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** The answer of a DNS resolver to one query. */
export interface DnsAnswer {
  readonly name: string;
  readonly record: RecordType;
  /** The resolver, as `address:port`. */
  readonly resolver: string;
  readonly outcome: DnsOutcome;
  readonly addresses: readonly string[];
  /** The lowest TTL of the records, in seconds. */
  readonly ttl?: number | undefined;
  /** The time from the query to the answer or to the failure, in milliseconds. */
  readonly ms: number;
  /** The error code of the platform for a failure, for example `ENOTFOUND`. */
  readonly code?: string | undefined;
}

/** The fact kind `dns.answer`. */
export const DNS_ANSWER: FactKind<DnsAnswer> = defineFactKind<DnsAnswer>({
  kind: "dns.answer",
  layer: "dns",
  summary: "The answer of a DNS resolver to one query for the addresses of a name.",
  check: (value): value is DnsAnswer =>
    isRecord(value) &&
    isText(value["name"]) &&
    isOneOf(RECORD_TYPES, value["record"]) &&
    isText(value["resolver"]) &&
    isOneOf(DNS_OUTCOMES, value["outcome"]) &&
    isTextList(value["addresses"]) &&
    (value["outcome"] !== "ok" || value["addresses"].length > 0) &&
    optional(value["ttl"], isDuration) &&
    isDuration(value["ms"]) &&
    optional(value["code"], isText),
});

/** The outcomes of a TCP connect. */
export const CONNECT_OUTCOMES = ["connected", "refused", "timeout", "unreachable", "reset", "error"] as const;
export type ConnectOutcome = (typeof CONNECT_OUTCOMES)[number];

/** The outcome of one TCP connect. */
export interface TcpConnect {
  readonly address: string;
  readonly port: number;
  readonly family: 4 | 6;
  readonly outcome: ConnectOutcome;
  /** The time from the start of the connect to the connection or to the failure, in milliseconds. */
  readonly ms: number;
  readonly code?: string | undefined;
}

/** The fact kind `tcp.connect`. */
export const TCP_CONNECT: FactKind<TcpConnect> = defineFactKind<TcpConnect>({
  kind: "tcp.connect",
  layer: "tcp",
  summary: "The outcome and the time of one TCP connect to an address and a port.",
  check: (value): value is TcpConnect =>
    isRecord(value) &&
    isText(value["address"]) &&
    isPort(value["port"]) &&
    (value["family"] === 4 || value["family"] === 6) &&
    isOneOf(CONNECT_OUTCOMES, value["outcome"]) &&
    isDuration(value["ms"]) &&
    optional(value["code"], isText),
});

/**
 * The outcomes of a TLS handshake.
 *
 * - `cert-error`: the handshake ended, but the certificate is not valid for the name.
 * - `alert`: the client and the server stopped the handshake, for example because they have no version in common.
 * - `not-tls`: the server does not speak TLS on the port.
 * - `closed`: the server closed the connection before the end of the handshake.
 */
export const HANDSHAKE_OUTCOMES = ["ok", "cert-error", "alert", "not-tls", "timeout", "reset", "closed", "error"] as const;
export type HandshakeOutcome = (typeof HANDSHAKE_OUTCOMES)[number];

/** The roots of trust that a certificate chain ends at: a public root, a root of the computer or the user, or none. */
export const TRUSTS = ["public", "private", "none"] as const;
export type Trust = (typeof TRUSTS)[number];

/** The problems of a certificate. */
export const CERT_PROBLEMS = ["expired", "not-yet-valid", "name", "untrusted", "revoked", "other"] as const;
export type CertProblem = (typeof CERT_PROBLEMS)[number];

/** The certificate of a server. */
export interface TlsCertificate {
  readonly subject: string;
  readonly issuer: string;
  /** The DNS names and the IP addresses of the certificate. */
  readonly names: readonly string[];
  /** The start of the validity, as an ISO 8601 time. */
  readonly validFrom: string;
  /** The end of the validity, as an ISO 8601 time. */
  readonly validTo: string;
  readonly fingerprint256: string;
  readonly selfSigned: boolean;
  /** The number of certificates from the certificate of the server to the root, with both. */
  readonly chain: number;
  /** The root that the chain ends at. A failed check of the certificate does not change it. */
  readonly trust: Trust;
  readonly problem?: CertProblem | undefined;
}

/** The outcome of one TLS handshake. */
export interface TlsHandshake {
  readonly address: string;
  readonly port: number;
  readonly servername?: string | undefined;
  readonly outcome: HandshakeOutcome;
  /** The time from the TCP connection to the end of the handshake or to the failure, in milliseconds. */
  readonly ms: number;
  /** The TLS version, for example `TLSv1.3`. */
  readonly protocol?: string | undefined;
  readonly cipher?: string | undefined;
  /** The application protocol that the server chose with ALPN, for example `http/1.1`. */
  readonly alpn?: string | undefined;
  readonly code?: string | undefined;
  readonly certificate?: TlsCertificate | undefined;
}

function isCertificate(value: unknown): value is TlsCertificate {
  return (
    isRecord(value) &&
    typeof value["subject"] === "string" &&
    typeof value["issuer"] === "string" &&
    isTextList(value["names"]) &&
    isText(value["validFrom"]) &&
    isText(value["validTo"]) &&
    isText(value["fingerprint256"]) &&
    typeof value["selfSigned"] === "boolean" &&
    typeof value["chain"] === "number" &&
    Number.isInteger(value["chain"]) &&
    value["chain"] >= 1 &&
    isOneOf(TRUSTS, value["trust"]) &&
    optional(value["problem"], (problem) => isOneOf(CERT_PROBLEMS, problem))
  );
}

/** The fact kind `tls.handshake`. */
export const TLS_HANDSHAKE: FactKind<TlsHandshake> = defineFactKind<TlsHandshake>({
  kind: "tls.handshake",
  layer: "tls",
  summary: "The outcome and the time of one TLS handshake, and the certificate of the server.",
  check: (value): value is TlsHandshake =>
    isRecord(value) &&
    isText(value["address"]) &&
    isPort(value["port"]) &&
    optional(value["servername"], isText) &&
    isOneOf(HANDSHAKE_OUTCOMES, value["outcome"]) &&
    isDuration(value["ms"]) &&
    optional(value["protocol"], isText) &&
    optional(value["cipher"], isText) &&
    optional(value["alpn"], isText) &&
    optional(value["code"], isText) &&
    optional(value["certificate"], isCertificate),
});

/**
 * The outcomes of an HTTP request.
 *
 * - `response`: the server sent a response. Its status can be an error.
 * - `protocol`: the server sent bytes that are not HTTP.
 * - `closed`: the server closed the connection before the response.
 */
export const HTTP_OUTCOMES = ["response", "protocol", "timeout", "reset", "closed", "error"] as const;
export type HttpOutcome = (typeof HTTP_OUTCOMES)[number];

/** The outcome of one HTTP request. */
export interface HttpResponse {
  readonly address: string;
  readonly port: number;
  readonly scheme: "http" | "https";
  readonly method: "GET" | "HEAD";
  /** The value of the `Host` field of the request. */
  readonly host: string;
  readonly path: string;
  readonly outcome: HttpOutcome;
  readonly status?: number | undefined;
  /** The HTTP version of the response, for example `1.1`. */
  readonly version?: string | undefined;
  /** Some fields of the response head, with lower-case names: `server`, `via`, `location` and others. */
  readonly fields: Readonly<Record<string, string>>;
  /** The bytes of the body that the probe read. */
  readonly bytes: number;
  /** The probe stopped the read of the body at its limit. */
  readonly truncated: boolean;
  /** The time from the request to the head of the response, in milliseconds. */
  readonly ttfbMs?: number | undefined;
  /** The time from the request to the end of the response or to the failure, in milliseconds. */
  readonly ms: number;
  readonly code?: string | undefined;
}

/** The fact kind `http.response`. */
export const HTTP_RESPONSE: FactKind<HttpResponse> = defineFactKind<HttpResponse>({
  kind: "http.response",
  layer: "http",
  summary: "The outcome and the times of one HTTP request: the status, some fields of the head and the time to the first byte.",
  check: (value): value is HttpResponse =>
    isRecord(value) &&
    isText(value["address"]) &&
    isPort(value["port"]) &&
    (value["scheme"] === "http" || value["scheme"] === "https") &&
    (value["method"] === "GET" || value["method"] === "HEAD") &&
    isText(value["host"]) &&
    isText(value["path"]) &&
    isOneOf(HTTP_OUTCOMES, value["outcome"]) &&
    (value["outcome"] !== "response" || (typeof value["status"] === "number" && Number.isInteger(value["status"]))) &&
    optional(value["status"], (status) => typeof status === "number" && status >= 100 && status <= 999) &&
    optional(value["version"], isText) &&
    isRecord(value["fields"]) &&
    Object.values(value["fields"]).every((field) => typeof field === "string") &&
    typeof value["bytes"] === "number" &&
    Number.isInteger(value["bytes"]) &&
    value["bytes"] >= 0 &&
    typeof value["truncated"] === "boolean" &&
    optional(value["ttfbMs"], isDuration) &&
    isDuration(value["ms"]) &&
    optional(value["code"], isText),
});

/**
 * The states of the link of this computer.
 *
 * - `up`: an interface that is up has the gateway in its network. With no gateway, an interface other than loopback is up.
 * - `down`: no interface that is up has the gateway in its network. With no gateway, only loopback is up.
 */
export const LINK_STATES = ["up", "down"] as const;
export type LinkStateValue = (typeof LINK_STATES)[number];

/** An interface that is up, with its addresses as CIDR ranges, for example `192.168.1.20/24`. */
export interface LinkInterface {
  readonly name: string;
  readonly addresses: readonly string[];
}

/** The state of the link of this computer, to its gateway when the probe knows the gateway. */
export interface LinkState {
  readonly state: LinkStateValue;
  /** The interfaces that are up and are not loopback. */
  readonly interfaces: readonly LinkInterface[];
  /** The gateway of the state. */
  readonly gateway?: string | undefined;
  /** The interface that has the gateway in its network. Only the state `up` with a gateway has it. */
  readonly via?: string | undefined;
}

function isLinkInterface(value: unknown): value is LinkInterface {
  return isRecord(value) && isText(value["name"]) && isTextList(value["addresses"]);
}

/** The fact kind `link.state`. */
export const LINK_STATE: FactKind<LinkState> = defineFactKind<LinkState>({
  kind: "link.state",
  layer: "link",
  summary: "The state of the link of this computer: an interface that is up, and the interface of the network of the gateway.",
  check: (value): value is LinkState =>
    isRecord(value) &&
    isOneOf(LINK_STATES, value["state"]) &&
    Array.isArray(value["interfaces"]) &&
    value["interfaces"].every(isLinkInterface) &&
    optional(value["gateway"], isText) &&
    optional(value["via"], isText) &&
    (value["gateway"] === undefined
      ? value["via"] === undefined && (value["state"] === "up") === value["interfaces"].length > 0
      : (value["state"] === "up") === (value["via"] !== undefined)),
});

/** The fact kinds of the native probes. */
export const NATIVE_KINDS: readonly FactKind<unknown>[] = [DNS_ANSWER, TCP_CONNECT, TLS_HANDSHAKE, HTTP_RESPONSE, LINK_STATE];

/**
 * The outcomes of the ICMP echo requests to one address.
 *
 * - `reply`: one or more echo replies came back.
 * - `none`: no reply came back in the time limit.
 * - `unreachable`: no echo reply came back, and a router or this computer told that the address is unreachable.
 * - `error`: the tool did not start, or netdiag cannot read its output.
 */
export const ECHO_OUTCOMES = ["reply", "none", "unreachable", "error"] as const;
export type EchoOutcome = (typeof ECHO_OUTCOMES)[number];

/** The result of the ICMP echo requests to one address. */
export interface IcmpEcho {
  readonly address: string;
  readonly outcome: EchoOutcome;
  /** The number of echo requests that the tool sent. */
  readonly sent: number;
  /** The number of echo replies. A message of an unreachable address is not a reply. */
  readonly received: number;
  /** The round-trip time of each reply, in milliseconds. */
  readonly rttMs: readonly number[];
  /** The TTL (IPv4) or the hop limit (IPv6) of the first reply. */
  readonly ttl?: number | undefined;
  /** The router that told that the address is unreachable. */
  readonly from?: string | undefined;
  /** The text of the tool for the outcomes `unreachable` and `error`. */
  readonly detail?: string | undefined;
}

/** The fact kind `icmp.echo`. */
export const ICMP_ECHO: FactKind<IcmpEcho> = defineFactKind<IcmpEcho>({
  kind: "icmp.echo",
  layer: "ip",
  summary: "The replies to the ICMP echo requests to one address, their round-trip times and the messages of an unreachable address.",
  check: (value): value is IcmpEcho =>
    isRecord(value) &&
    isText(value["address"]) &&
    isOneOf(ECHO_OUTCOMES, value["outcome"]) &&
    isCount(value["sent"]) &&
    isCount(value["received"]) &&
    value["received"] <= value["sent"] &&
    Array.isArray(value["rttMs"]) &&
    value["rttMs"].every(isDuration) &&
    value["rttMs"].length <= value["received"] &&
    (value["outcome"] === "reply") === value["received"] > 0 &&
    optional(value["ttl"], isCount) &&
    optional(value["from"], isText) &&
    optional(value["detail"], isText),
});

/**
 * The outcomes of a trace of the path to an address.
 *
 * - `reached`: the address answered at the last hop.
 * - `stopped`: the last hop is not the address, and no router told that the address is unreachable.
 * - `unreachable`: a router or this computer told that the address is unreachable.
 * - `error`: the tool failed, or netdiag cannot read its output.
 */
export const TRACE_OUTCOMES = ["reached", "stopped", "unreachable", "error"] as const;
export type TraceOutcome = (typeof TRACE_OUTCOMES)[number];

/** One hop of a trace: the answers to the probes with one TTL. */
export interface TraceHop {
  /** The TTL (IPv4) or the hop limit (IPv6) of the probes, from 1. */
  readonly ttl: number;
  /** The addresses that answered, in the order of their first answer. */
  readonly addresses: readonly string[];
  /** The number of probes that the tool sent with this TTL. */
  readonly sent: number;
  /** The number of answers. */
  readonly received: number;
  /** The round-trip time of each answer that has a time, in milliseconds. */
  readonly rttMs: readonly number[];
  /** The message of an unreachable address at this hop, for example `host unreachable (!H)`. */
  readonly unreachable?: string | undefined;
}

/** The trace of the path to one address: the hops of the tool `traceroute`, or `tracert` on Windows. */
export interface PathTrace {
  readonly address: string;
  readonly outcome: TraceOutcome;
  /** The largest TTL of the probes. */
  readonly maxHops: number;
  /** The hops in the order of their TTL. An `error` keeps the hops before the failure. */
  readonly hops: readonly TraceHop[];
  /** The text of the tool for the outcomes `unreachable` and `error`. */
  readonly detail?: string | undefined;
}

function isTraceHop(value: unknown): value is TraceHop {
  return (
    isRecord(value) &&
    isCount(value["ttl"]) &&
    value["ttl"] >= 1 &&
    isTextList(value["addresses"]) &&
    isCount(value["sent"]) &&
    isCount(value["received"]) &&
    value["received"] <= value["sent"] &&
    (value["received"] > 0) === (value["addresses"].length > 0) &&
    Array.isArray(value["rttMs"]) &&
    value["rttMs"].every(isDuration) &&
    value["rttMs"].length <= value["received"] &&
    optional(value["unreachable"], isText)
  );
}

/** This function tells if the TTL of each hop is larger than the TTL of the hop before it, and not larger than `maxHops`. */
function inOrder(hops: readonly { readonly ttl: number }[], maxHops: number): boolean {
  return hops.every((hop, index) => hop.ttl <= maxHops && (index === 0 || hop.ttl > (hops[index - 1]?.ttl ?? 0)));
}

/** The fact kind `path.trace`. */
export const PATH_TRACE: FactKind<PathTrace> = defineFactKind<PathTrace>({
  kind: "path.trace",
  layer: "path",
  summary: "The hops of the path to one address: the routers that answered each TTL, their round-trip times and the messages of an unreachable address.",
  check: (value): value is PathTrace =>
    isRecord(value) &&
    isText(value["address"]) &&
    isOneOf(TRACE_OUTCOMES, value["outcome"]) &&
    isCount(value["maxHops"]) &&
    Array.isArray(value["hops"]) &&
    value["hops"].every(isTraceHop) &&
    inOrder(value["hops"], value["maxHops"]) &&
    (value["outcome"] !== "reached" || value["hops"].length > 0) &&
    optional(value["detail"], isText),
});

/** One hop of a report of `mtr`: the counts and the times of many cycles of probes with one TTL. */
export interface ReportHop {
  readonly ttl: number;
  /** The address that answered. A hop with no answer has no address. */
  readonly address?: string | undefined;
  /** The number of probes that the tool sent with this TTL. */
  readonly sent: number;
  /** The number of answers. The adapter calculates it from the loss and the number of probes of the report. */
  readonly received: number;
  /** The best round-trip time, in milliseconds. Only a hop with answers has the times. */
  readonly bestMs?: number | undefined;
  /** The mean round-trip time, in milliseconds. */
  readonly meanMs?: number | undefined;
  /** The worst round-trip time, in milliseconds. */
  readonly worstMs?: number | undefined;
}

/** The report of the tool `mtr` for the path to one address. */
export interface PathReport {
  readonly address: string;
  /** The outcome. A report of `mtr` has no messages of an unreachable address, so it does not have the outcome `unreachable`. */
  readonly outcome: TraceOutcome;
  /** The number of cycles of probes. */
  readonly cycles: number;
  readonly hops: readonly ReportHop[];
  /** The text of the tool for the outcome `error`. */
  readonly detail?: string | undefined;
}

function isReportHop(value: unknown): value is ReportHop {
  return (
    isRecord(value) &&
    isCount(value["ttl"]) &&
    value["ttl"] >= 1 &&
    optional(value["address"], isText) &&
    isCount(value["sent"]) &&
    isCount(value["received"]) &&
    value["received"] <= value["sent"] &&
    (value["received"] === 0 || value["address"] !== undefined) &&
    optional(value["bestMs"], isDuration) &&
    optional(value["meanMs"], isDuration) &&
    optional(value["worstMs"], isDuration)
  );
}

/** The fact kind `path.report`. */
export const PATH_REPORT: FactKind<PathReport> = defineFactKind<PathReport>({
  kind: "path.report",
  layer: "path",
  summary: "The hops of the path to one address over many cycles of probes: the address, the loss and the round-trip times of each hop.",
  check: (value): value is PathReport =>
    isRecord(value) &&
    isText(value["address"]) &&
    isOneOf(TRACE_OUTCOMES, value["outcome"]) &&
    value["outcome"] !== "unreachable" &&
    isCount(value["cycles"]) &&
    Array.isArray(value["hops"]) &&
    value["hops"].every(isReportHop) &&
    inOrder(value["hops"], Number.MAX_SAFE_INTEGER) &&
    (value["outcome"] !== "reached" || value["hops"].length > 0) &&
    optional(value["detail"], isText),
});

/** The transport protocols of a throughput test. */
export const THROUGHPUT_PROTOCOLS = ["tcp", "udp"] as const;
export type ThroughputProtocol = (typeof THROUGHPUT_PROTOCOLS)[number];

/**
 * The outcomes of a throughput test.
 *
 * - `measured`: the test ended, and the report has the rates.
 * - `refused`: the server refused the connection. No server listens on the port.
 * - `busy`: the server operates a test for a different client.
 * - `error`: the tool failed, or netdiag cannot read its report.
 */
export const THROUGHPUT_OUTCOMES = ["measured", "refused", "busy", "error"] as const;
export type ThroughputOutcome = (typeof THROUGHPUT_OUTCOMES)[number];

/** One interval of a throughput test: the sum of the streams of the local side. */
export interface ThroughputInterval {
  /** The start of the interval, in milliseconds from the start of the test. */
  readonly startMs: number;
  /** The end of the interval, in milliseconds from the start of the test. */
  readonly endMs: number;
  readonly bytes: number;
  readonly bitsPerSecond: number;
  /** The TCP retransmits of the interval. Only a sender that reads them from its operating system has them. */
  readonly retransmits?: number | undefined;
  /** The UDP datagrams of the interval. */
  readonly datagrams?: number | undefined;
  /** The lost UDP datagrams of the interval. Only a receiver has them. */
  readonly lostDatagrams?: number | undefined;
  /** The UDP jitter of the interval, in milliseconds. Only a receiver has it. */
  readonly jitterMs?: number | undefined;
}

/** The result of a throughput test of the tool `iperf3` against one server. */
export interface PathThroughput {
  readonly address: string;
  readonly port: number;
  readonly protocol: ThroughputProtocol;
  /** This field is true when the server sends and this computer receives (the option `-R`). */
  readonly reverse: boolean;
  /** The number of parallel streams. */
  readonly streams: number;
  /** The planned time of the test, in seconds. */
  readonly seconds: number;
  readonly outcome: ThroughputOutcome;
  /** The rate of the sender over the test, in bits per second. With `reverse`, the server is the sender. */
  readonly sentBitsPerSecond?: number | undefined;
  /** The rate of the receiver over the test, in bits per second. A UDP report before iperf3 3.10 does not have it. */
  readonly receivedBitsPerSecond?: number | undefined;
  readonly sentBytes?: number | undefined;
  readonly receivedBytes?: number | undefined;
  /** The TCP retransmits of the sender. Only a sender that reads them from its operating system has them. */
  readonly retransmits?: number | undefined;
  /** The mean UDP jitter of the streams, in milliseconds. */
  readonly jitterMs?: number | undefined;
  /** The lost UDP datagrams. */
  readonly lostDatagrams?: number | undefined;
  /** The UDP datagrams of the test. */
  readonly datagrams?: number | undefined;
  /** The intervals of the test, in their order. */
  readonly intervals: readonly ThroughputInterval[];
  /** The text of the tool for each outcome other than `measured`. */
  readonly detail?: string | undefined;
}

function isThroughputInterval(value: unknown): value is ThroughputInterval {
  return (
    isRecord(value) &&
    isDuration(value["startMs"]) &&
    isDuration(value["endMs"]) &&
    value["startMs"] <= value["endMs"] &&
    isCount(value["bytes"]) &&
    isDuration(value["bitsPerSecond"]) &&
    optional(value["retransmits"], isCount) &&
    optional(value["datagrams"], isCount) &&
    optional(value["lostDatagrams"], isCount) &&
    optional(value["jitterMs"], isDuration)
  );
}

/** This function tells if the fields of one protocol are absent from a value of the other protocol. */
function protocolFields(value: Readonly<Record<string, unknown>>): boolean {
  if (value["protocol"] === "tcp") return value["jitterMs"] === undefined && value["lostDatagrams"] === undefined && value["datagrams"] === undefined;
  return value["retransmits"] === undefined;
}

/** The fact kind `path.throughput`. */
export const PATH_THROUGHPUT: FactKind<PathThroughput> = defineFactKind<PathThroughput>({
  kind: "path.throughput",
  layer: "path",
  summary: "The rates of a throughput test of iperf3 against one server: the bits per second, the TCP retransmits, the UDP jitter and loss.",
  check: (value): value is PathThroughput =>
    isRecord(value) &&
    isText(value["address"]) &&
    isPort(value["port"]) &&
    isOneOf(THROUGHPUT_PROTOCOLS, value["protocol"]) &&
    typeof value["reverse"] === "boolean" &&
    isCount(value["streams"]) &&
    value["streams"] >= 1 &&
    isCount(value["seconds"]) &&
    value["seconds"] >= 1 &&
    isOneOf(THROUGHPUT_OUTCOMES, value["outcome"]) &&
    (value["outcome"] !== "measured" || value["sentBitsPerSecond"] !== undefined) &&
    optional(value["sentBitsPerSecond"], isDuration) &&
    optional(value["receivedBitsPerSecond"], isDuration) &&
    optional(value["sentBytes"], isCount) &&
    optional(value["receivedBytes"], isCount) &&
    optional(value["retransmits"], isCount) &&
    optional(value["jitterMs"], isDuration) &&
    optional(value["lostDatagrams"], isCount) &&
    optional(value["datagrams"], isCount) &&
    (typeof value["lostDatagrams"] !== "number" || typeof value["datagrams"] !== "number" || value["lostDatagrams"] <= value["datagrams"]) &&
    protocolFields(value) &&
    Array.isArray(value["intervals"]) &&
    value["intervals"].every(isThroughputInterval) &&
    optional(value["detail"], isText),
});

/** The protocols of the capture filter of a capture. */
export const CAPTURE_PROTOCOLS = ["tcp", "udp", "icmp"] as const;
export type CaptureProtocol = (typeof CAPTURE_PROTOCOLS)[number];

/** The transport protocols of a captured packet. `other` is a packet with no TCP and no UDP header, for example ICMP. */
export const PACKET_PROTOCOLS = ["tcp", "udp", "other"] as const;
export type PacketProtocol = (typeof PACKET_PROTOCOLS)[number];

/**
 * The outcomes of a capture.
 *
 * - `captured`: the capture has one or more packets.
 * - `none`: no packet passed the capture filter in the time of the capture.
 * - `error`: the tool failed, for example without the privilege to capture, or netdiag cannot read its output.
 */
export const CAPTURE_OUTCOMES = ["captured", "none", "error"] as const;
export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];

/**
 * One packet of a capture of `tshark`. The estimators of ND-6 read these records, for example the RTO of RFC 6298 and
 * packet pairs.
 */
export interface CapturedPacket {
  /** The time of the packet, in milliseconds from the first packet of the capture. */
  readonly atMs: number;
  /** The source IP address. */
  readonly src: string;
  /** The destination IP address. */
  readonly dst: string;
  readonly protocol: PacketProtocol;
  readonly srcPort?: number | undefined;
  readonly dstPort?: number | undefined;
  /** The relative TCP sequence number. */
  readonly seq?: number | undefined;
  /** The relative TCP acknowledgment number. */
  readonly ack?: number | undefined;
  /** The bytes of the TCP payload. */
  readonly payload?: number | undefined;
  /** The TCP flags as a number, for example 18 for SYN and ACK. */
  readonly flags?: number | undefined;
  /** This field is true when `tshark` marks the TCP segment as a retransmission. The rule of Karn ignores such a segment. */
  readonly retransmission?: boolean | undefined;
  /** On an ACK: the time from the segment that it acknowledges to the ACK, in milliseconds. */
  readonly ackRttMs?: number | undefined;
  /** The length of the frame, in bytes. */
  readonly bytes: number;
}

/** The capture of the packets of one flow with the tool `tshark`. */
export interface PathCapture {
  /** The IP address of the capture filter. */
  readonly address: string;
  /** The port of the capture filter. A capture with no port takes each port. */
  readonly port?: number | undefined;
  /** The protocol of the capture filter. A capture with no protocol takes each protocol. */
  readonly protocol?: CaptureProtocol | undefined;
  /** The network interface of the capture, for example `eth0`. */
  readonly device: string;
  /** The capture filter that `tshark` received. */
  readonly filter: string;
  readonly outcome: CaptureOutcome;
  /** The time of the first packet, as the text of `frame.time_epoch`: seconds since 1970 and a fraction. */
  readonly epoch?: string | undefined;
  /** The packets in the order of the capture. */
  readonly packets: readonly CapturedPacket[];
  /** The number of packets that the capture dropped, when `tshark` tells it. */
  readonly dropped?: number | undefined;
  /** The text of the tool for the outcome `error`. */
  readonly detail?: string | undefined;
}

function isPortNumber(value: unknown): value is number {
  return isCount(value) && value <= 65535;
}

function isCapturedPacket(value: unknown): value is CapturedPacket {
  return (
    isRecord(value) &&
    isDuration(value["atMs"]) &&
    isText(value["src"]) &&
    isText(value["dst"]) &&
    isOneOf(PACKET_PROTOCOLS, value["protocol"]) &&
    optional(value["srcPort"], isPortNumber) &&
    optional(value["dstPort"], isPortNumber) &&
    (value["protocol"] !== "other" || (value["srcPort"] === undefined && value["dstPort"] === undefined)) &&
    optional(value["seq"], isCount) &&
    optional(value["ack"], isCount) &&
    optional(value["payload"], isCount) &&
    optional(value["flags"], isCount) &&
    optional(value["retransmission"], (flag) => typeof flag === "boolean") &&
    optional(value["ackRttMs"], isDuration) &&
    isCount(value["bytes"])
  );
}

/** The fact kind `path.capture`. */
export const PATH_CAPTURE: FactKind<PathCapture> = defineFactKind<PathCapture>({
  kind: "path.capture",
  layer: "path",
  summary: "The packets of one flow from a capture of tshark: the times, the addresses, the ports and the TCP fields of each packet.",
  check: (value): value is PathCapture =>
    isRecord(value) &&
    isText(value["address"]) &&
    optional(value["port"], isPort) &&
    optional(value["protocol"], (protocol) => isOneOf(CAPTURE_PROTOCOLS, protocol)) &&
    isText(value["device"]) &&
    isText(value["filter"]) &&
    isOneOf(CAPTURE_OUTCOMES, value["outcome"]) &&
    Array.isArray(value["packets"]) &&
    value["packets"].every(isCapturedPacket) &&
    (value["outcome"] === "captured") === value["packets"].length > 0 &&
    (value["packets"].length === 0 || isText(value["epoch"])) &&
    optional(value["epoch"], isText) &&
    optional(value["dropped"], isCount) &&
    optional(value["detail"], isText),
});

/**
 * The results of the echo requests of one size with "do not fragment".
 *
 * - `reply`: an echo reply came back, so packets of this size pass.
 * - `too-big`: a router or this computer told that the packet is too large. The message can tell the MTU.
 * - `none`: no reply came back, and no message told that the packet is too large.
 * - `error`: the tool failed, or netdiag cannot read its output.
 */
export const MTU_TRY_RESULTS = ["reply", "too-big", "none", "error"] as const;
export type MtuTryResult = (typeof MTU_TRY_RESULTS)[number];

/** The echo requests of one size in a search for the MTU. */
export interface MtuTry {
  /** The size of the IP packet in bytes, with the IP header and the ICMP header. */
  readonly size: number;
  readonly result: MtuTryResult;
  /** The MTU that the message of the result `too-big` tells, in bytes. Some messages do not tell it. */
  readonly mtu?: number | undefined;
  /** The router that sent the message of the result `too-big`. A message of this computer has no router. */
  readonly from?: string | undefined;
  /** The text of the tool for the results `too-big`, `none` and `error`. */
  readonly detail?: string | undefined;
}

/**
 * The outcomes of a search for the MTU of the path to one address.
 *
 * - `measured`: the smallest size passed, so the search found the MTU.
 * - `none`: the smallest size got no reply. The address does not answer echo requests.
 * - `error`: the tool failed, or netdiag cannot read its output.
 */
export const MTU_OUTCOMES = ["measured", "none", "error"] as const;
export type MtuOutcome = (typeof MTU_OUTCOMES)[number];

/**
 * The two ways in which a path stops a packet above its MTU.
 *
 * - `message`: a router or this computer tells that the packet is too large. Path MTU discovery works.
 * - `silent`: the packet goes away with no message. This is an MTU black hole.
 */
export const MTU_STOPS = ["message", "silent"] as const;
export type MtuStop = (typeof MTU_STOPS)[number];

/** The result of a search for the MTU of the path to one address, with echo requests that have "do not fragment". */
export interface PathMtu {
  readonly address: string;
  readonly outcome: MtuOutcome;
  /** The largest size of the search, in bytes. */
  readonly ceiling: number;
  /** The largest size that passed, in bytes: the MTU of the path, or `ceiling` when each size passed. */
  readonly mtu?: number | undefined;
  /** The way in which the path stopped the next size above `mtu`. When `mtu` is `ceiling`, nothing stopped a size. */
  readonly stop?: MtuStop | undefined;
  /** The sizes in the order of the search. */
  readonly tries: readonly MtuTry[];
  /** The text of the tool for the outcomes `none` and `error`. */
  readonly detail?: string | undefined;
}

function isMtuTry(value: unknown): value is MtuTry {
  return (
    isRecord(value) &&
    isCount(value["size"]) &&
    isOneOf(MTU_TRY_RESULTS, value["result"]) &&
    optional(value["mtu"], isCount) &&
    optional(value["from"], isText) &&
    optional(value["detail"], isText)
  );
}

/**
 * This function tells if the MTU, the ceiling and the stop of a value agree with its outcome. A measured MTU is not above
 * the ceiling, and it has a stop only when it is below the ceiling.
 */
function mtuAgrees(outcome: unknown, mtu: unknown, ceiling: unknown, stop: unknown): boolean {
  if ((outcome === "measured") !== (mtu !== undefined)) return false;
  if (mtu === undefined) return stop === undefined;
  return typeof mtu === "number" && typeof ceiling === "number" && mtu <= ceiling && (mtu < ceiling) === (stop !== undefined);
}

/** The fact kind `path.mtu`. A measured MTU has a stop when it is below the ceiling, and no stop at the ceiling. */
export const PATH_MTU: FactKind<PathMtu> = defineFactKind<PathMtu>({
  kind: "path.mtu",
  layer: "path",
  summary: "The MTU of the path to one address, and the way in which the path stops a larger packet.",
  check: (value): value is PathMtu =>
    isRecord(value) &&
    isText(value["address"]) &&
    isOneOf(MTU_OUTCOMES, value["outcome"]) &&
    isCount(value["ceiling"]) &&
    optional(value["mtu"], isCount) &&
    optional(value["stop"], (stop) => isOneOf(MTU_STOPS, stop)) &&
    Array.isArray(value["tries"]) &&
    value["tries"].every(isMtuTry) &&
    optional(value["detail"], isText) &&
    mtuAgrees(value["outcome"], value["mtu"], value["ceiling"], value["stop"]),
});

/**
 * The states of a Wi-Fi interface.
 *
 * - `connected`: the interface has a link to an access point.
 * - `disconnected`: the radio is on, but the interface has no link.
 * - `off`: the radio is off. Only Windows and macOS tell this state. On Linux, an interface with the radio off is `disconnected`.
 */
export const WIFI_STATES = ["connected", "disconnected", "off"] as const;
export type WifiState = (typeof WIFI_STATES)[number];

/** The radio bands of Wi-Fi, in GHz. */
export const WIFI_BANDS = ["2.4", "5", "6"] as const;
export type WifiBand = (typeof WIFI_BANDS)[number];

/** The widths of a Wi-Fi channel, in MHz. */
export const WIFI_WIDTHS = [20, 40, 80, 160, 320] as const;

/** The lowest signal or noise level of a Wi-Fi fact, in dBm. A tool gives a lower value when it has no measurement. */
export const WIFI_FLOOR_DBM = -120;

/**
 * The Wi-Fi link of one interface, from the tool of the operating system. Only the state `connected` has the fields of
 * the link. Each field of the link is optional, because each tool gives other fields.
 */
export interface WifiLink {
  /** The name of the interface, for example `wlan0`, `en0` or `Wi-Fi`. `os.networkInterfaces()` uses the same name. */
  readonly interface: string;
  readonly state: WifiState;
  /** The name of the network. macOS and Windows hide it without the location permission. */
  readonly ssid?: string | undefined;
  /** The MAC address of the access point, in lower case. A change of it on one network is a roam. */
  readonly bssid?: string | undefined;
  /** The level of the signal, in dBm. */
  readonly signalDbm?: number | undefined;
  /** The signal quality of Windows, from 0 to 100. An older Windows gives it and no level in dBm. */
  readonly quality?: number | undefined;
  /** The level of the noise, in dBm. */
  readonly noiseDbm?: number | undefined;
  readonly channel?: number | undefined;
  readonly band?: WifiBand | undefined;
  /** The width of the channel, in MHz. */
  readonly widthMhz?: number | undefined;
  /** The rate of the last frames that this computer sent, in Mbit/s. */
  readonly txMbps?: number | undefined;
  /** The rate of the last frames that this computer received, in Mbit/s. */
  readonly rxMbps?: number | undefined;
  /** The standard of the link, for example `802.11ax`. */
  readonly standard?: string | undefined;
}

const WIFI_LINK_FIELDS = ["ssid", "bssid", "signalDbm", "quality", "noiseDbm", "channel", "band", "widthMhz", "txMbps", "rxMbps", "standard"] as const;

function isLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= WIFI_FLOOR_DBM && value < 0;
}

function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The fact kind `wifi.link`. */
export const WIFI_LINK: FactKind<WifiLink> = defineFactKind<WifiLink>({
  kind: "wifi.link",
  layer: "wifi",
  summary: "The Wi-Fi link of one interface: the state, the access point, the signal, the noise, the channel and the rates.",
  check: (value): value is WifiLink =>
    isRecord(value) &&
    isText(value["interface"]) &&
    isOneOf(WIFI_STATES, value["state"]) &&
    (value["state"] === "connected" || WIFI_LINK_FIELDS.every((field) => value[field] === undefined)) &&
    optional(value["ssid"], isText) &&
    optional(value["bssid"], (bssid) => typeof bssid === "string" && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(bssid)) &&
    optional(value["signalDbm"], isLevel) &&
    optional(value["quality"], (quality) => isCount(quality) && quality <= 100) &&
    optional(value["noiseDbm"], isLevel) &&
    optional(value["channel"], (channel) => isCount(channel) && channel >= 1 && channel <= 233) &&
    optional(value["band"], (band) => isOneOf(WIFI_BANDS, band)) &&
    optional(value["widthMhz"], (width) => (WIFI_WIDTHS as readonly unknown[]).includes(width)) &&
    optional(value["txMbps"], isRate) &&
    optional(value["rxMbps"], isRate) &&
    optional(value["standard"], isText),
});

/** The fact kinds of the adapters of outside tools (`@mark1russell7/netdiag/tools`). */
export const TOOL_KINDS: readonly FactKind<unknown>[] = [ICMP_ECHO, PATH_TRACE, PATH_REPORT, PATH_THROUGHPUT, PATH_CAPTURE, PATH_MTU, WIFI_LINK];

/**
 * The outcomes of a lookup of the owner of an address in the public registries.
 *
 * - `found`: a registry gave the network of the address.
 * - `unregistered`: the registry has no network for the address. It gave the status 404.
 * - `special`: the address is in a special-purpose range, for example a private range. netdiag did no lookup.
 * - `unlisted`: the bootstrap of IANA gives no registry for the address, or that registry is not a permitted registry.
 * - `failed`: the lookup gave no usable answer, for example a registry that stopped, or a body that is not RDAP.
 */
export const OWNER_OUTCOMES = ["found", "unregistered", "special", "unlisted", "failed"] as const;

/** The outcome of a lookup of the owner of an address. */
export type OwnerOutcome = (typeof OWNER_OUTCOMES)[number];

/** The network of an address in a registry: the RDAP object of the class `ip network` (RFC 9083). */
export interface OwnerNetwork {
  /** The handle of the network in the registry, for example `NET-192-0-2-0-1`. */
  readonly handle: string;
  /** The name of the network, for example `EXAMPLE-NET`. */
  readonly name?: string | undefined;
  /** The first address of the network. */
  readonly start: string;
  /** The last address of the network. */
  readonly end: string;
  /** The CIDR ranges of the network, from the extension `cidr0`. A registry with no `cidr0` gives no range. */
  readonly cidrs: readonly string[];
  /** The name of the holder: the `fn` of the vCard of the entity with the role `registrant`. */
  readonly holder?: string | undefined;
  /** The first line of the description of the network, for example the `descr` of a RIPE or APNIC record. */
  readonly description?: string | undefined;
  /** The country code of the network, for example `NL`. */
  readonly country?: string | undefined;
  /** The origin AS numbers that the registry keeps for the network, from the extension `arin_originas0`. */
  readonly originAs: readonly number[];
}

/** The owner of one address on a path: the registered network of the address, from a lookup in RDAP. */
export interface PathOwner {
  readonly address: string;
  readonly outcome: OwnerOutcome;
  /** The class of the address for the outcome `special`, for example `private`. */
  readonly class?: string | undefined;
  /** The host of the registry that gave the last answer, for example `rdap.db.ripe.net`. */
  readonly registry?: string | undefined;
  /** The network of the address. Only the outcome `found` has a network. */
  readonly network?: OwnerNetwork | undefined;
  /** The reason in plain words for the outcomes `unlisted` and `failed`. */
  readonly detail?: string | undefined;
}

function isAsNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4_294_967_295;
}

function isOwnerNetwork(value: unknown): value is OwnerNetwork {
  return (
    isRecord(value) &&
    isText(value["handle"]) &&
    optional(value["name"], isText) &&
    isText(value["start"]) &&
    isText(value["end"]) &&
    isTextList(value["cidrs"]) &&
    optional(value["holder"], isText) &&
    optional(value["description"], isText) &&
    optional(value["country"], isText) &&
    Array.isArray(value["originAs"]) &&
    value["originAs"].every(isAsNumber)
  );
}

/** The fact kind `path.owner`. */
export const PATH_OWNER: FactKind<PathOwner> = defineFactKind<PathOwner>({
  kind: "path.owner",
  layer: "path",
  summary: "The registered network of one address on a path: its handle, its range, its holder and its country, from a lookup in RDAP.",
  check: (value): value is PathOwner =>
    isRecord(value) &&
    isText(value["address"]) &&
    isOneOf(OWNER_OUTCOMES, value["outcome"]) &&
    optional(value["class"], isText) &&
    optional(value["registry"], isText) &&
    optional(value["network"], isOwnerNetwork) &&
    (value["outcome"] === "found") === (value["network"] !== undefined) &&
    (value["outcome"] !== "found" || value["registry"] !== undefined) &&
    (value["outcome"] === "special") === (value["class"] !== undefined) &&
    optional(value["detail"], isText),
});

/** The fact kinds of the lookups in the public registries. */
export const LOOKUP_KINDS: readonly FactKind<unknown>[] = [PATH_OWNER];
