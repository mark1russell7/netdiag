import { defineFactKind, type FactKind } from "./fact.ts";

// The fact kinds of the native probes. This module imports no `node:` module, so a browser can read a record of facts.

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
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

/** The fact kinds of the native probes. */
export const NATIVE_KINDS: readonly FactKind<unknown>[] = [DNS_ANSWER, TCP_CONNECT, TLS_HANDSHAKE, HTTP_RESPONSE];
