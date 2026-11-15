import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { observe, type Observation } from "../fact.ts";
import { DNS_ANSWER, TCP_CONNECT, TLS_HANDSHAKE, HTTP_RESPONSE, type DnsOutcome, type RecordType } from "../kinds.ts";
import { defineProbe, type Availability, type Probe } from "../probe.ts";
import { formatTarget, target } from "../target.ts";
import {
  connectPhase,
  dialOf,
  exchangePhase,
  handshakePhase,
  httpObservation,
  peerOf,
  tcpObservation,
  timeoutOf,
  tlsObservation,
  trustStore,
  watch,
  codeOf,
  type ConnectOptions,
  type HttpPhase,
  type TcpPhase,
  type TlsPhase,
  type TrustStore,
} from "./socket.ts";

// The native probes use only the `node:` modules. Each network failure is an outcome in the raw output, not an error.

const NATIVE: Availability = { available: true, version: process.versions.node };

function native(): Promise<Availability> {
  return Promise.resolve(NATIVE);
}

/** The input of the DNS probe: one query for the addresses of a name, to one resolver. */
export interface DnsInput {
  readonly name: string;
  /** The record type. The default is `A`. */
  readonly record?: RecordType | undefined;
  /** The IP address of the resolver. */
  readonly resolver: string;
  /** The port of the resolver. The default is 53. */
  readonly port?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

/** The raw output of the DNS probe. The times are readings of the clock of the runner. */
export interface DnsRaw {
  readonly name: string;
  readonly record: RecordType;
  readonly resolver: string;
  readonly start: number;
  readonly end: number;
  readonly outcome: DnsOutcome;
  readonly addresses: readonly string[];
  readonly ttl?: number | undefined;
  readonly code?: string | undefined;
}

/** This function maps an error code of a DNS query to its outcome. */
export function dnsOutcome(code: string | undefined): DnsOutcome {
  switch (code) {
    case "ENOTFOUND":
      return "nxdomain";
    case "ENODATA":
      return "nodata";
    case "ESERVFAIL":
      return "servfail";
    case "EREFUSED":
      return "refused";
    case "ETIMEOUT":
      return "timeout";
    case "ECONNREFUSED":
      return "unreachable";
    default:
      return "error";
  }
}

/**
 * The DNS probe sends one query for the addresses of a name to one resolver. Its peer is the resolver, not the name.
 * The query uses no search domain.
 */
export const DNS_PROBE: Probe<DnsInput, DnsRaw> = defineProbe<DnsInput, DnsRaw>({
  id: "dns.query",
  version: "1",
  summary: "One DNS query for the A or AAAA records of a name, to one resolver.",
  layer: "dns",
  mode: "active",
  kinds: [DNS_ANSWER],
  peers(input) {
    if (isIP(input.name) !== 0) throw new TypeError(`"${input.name}" is an address, not a name.`);
    return [peerOf(input.resolver, input.port ?? 53)];
  },
  available: native,
  async run(input, context) {
    const record = input.record ?? "A";
    const limit = timeoutOf(input.timeoutMs);
    const server = formatTarget(target(input.resolver, input.port ?? 53));
    const resolver = new Resolver({ timeout: limit, tries: 1 });
    resolver.setServers([server]);
    let expired = false;
    const stop = (): void => resolver.cancel();
    const cancel = context.clock.after(limit, () => {
      expired = true;
      stop();
    });
    context.signal.addEventListener("abort", stop, { once: true });
    const start = context.clock.now();
    const base = { name: input.name, record, resolver: server, start };
    try {
      const answers = record === "A" ? await resolver.resolve4(input.name, { ttl: true }) : await resolver.resolve6(input.name, { ttl: true });
      const raw: DnsRaw = {
        ...base,
        end: context.clock.now(),
        outcome: "ok",
        addresses: answers.map((answer) => answer.address),
        ...(answers.length === 0 ? {} : { ttl: Math.min(...answers.map((answer) => answer.ttl)) }),
      };
      context.signal.throwIfAborted();
      return raw;
    } catch (thrown) {
      context.signal.throwIfAborted();
      const code = codeOf(thrown);
      return { ...base, end: context.clock.now(), outcome: expired ? "timeout" : dnsOutcome(code), addresses: [], ...(code === undefined ? {} : { code }) };
    } finally {
      cancel();
      context.signal.removeEventListener("abort", stop);
    }
  },
  parse(raw) {
    const { start, end, ...rest } = raw;
    return [observe(DNS_ANSWER, target(raw.name), { ...rest, ms: end - start }, { start, end })];
  },
});

/** The input of the TCP probe: one connect to an IP address and a port. */
export interface TcpInput {
  readonly address: string;
  readonly port: number;
  readonly timeoutMs?: number | undefined;
}

/** The raw output of the TCP probe. */
export interface TcpRaw {
  readonly tcp: TcpPhase;
}

/** This function makes the TCP probe. It connects, and then it closes the connection. */
export function tcpProbe(options: ConnectOptions = {}): Probe<TcpInput, TcpRaw> {
  const dial = dialOf(options);
  return defineProbe<TcpInput, TcpRaw>({
    id: "tcp.connect",
    version: "1",
    summary: "One TCP connect to an IP address and a port.",
    layer: "tcp",
    mode: "active",
    kinds: [TCP_CONNECT],
    peers: (input) => [peerOf(input.address, input.port)],
    available: native,
    async run(input, context) {
      const w = watch(context, timeoutOf(input.timeoutMs));
      try {
        const { socket, phase } = await connectPhase(dial, input.address, input.port, w, context.clock);
        socket?.destroy();
        context.signal.throwIfAborted();
        return { tcp: phase };
      } finally {
        w.close();
      }
    },
    parse: (raw) => [tcpObservation(raw.tcp)],
  });
}

/** The TCP probe with the `connect` of `node:net`. */
export const TCP_PROBE: Probe<TcpInput, TcpRaw> = tcpProbe();

/** The input of the TLS probe: a TCP connect and a TLS handshake. */
export interface TlsInput {
  readonly address: string;
  /** The port. The default is 443. */
  readonly port?: number | undefined;
  /** The name for SNI and for the check of the certificate. */
  readonly servername?: string | undefined;
  readonly alpn?: readonly string[] | undefined;
  readonly timeoutMs?: number | undefined;
}

/** The raw output of the TLS probe. It has no TLS phase when the TCP connect failed. */
export interface TlsRaw {
  readonly tcp: TcpPhase;
  readonly tls?: TlsPhase | undefined;
}

/** The options of the TLS and HTTP probes. */
export interface TlsProbeOptions extends ConnectOptions {
  /** More roots of trust, as PEM text: the roots that the user trusts, for example the root of a company. */
  readonly roots?: readonly string[] | undefined;
}

function lazyStore(roots: readonly string[]): () => TrustStore {
  let store: TrustStore | undefined;
  return () => (store ??= trustStore(roots));
}

/**
 * This function makes the TLS probe. It measures the TCP connect and the TLS handshake apart. It examines the
 * certificate, and it does not refuse a certificate that is not valid.
 */
export function tlsProbe(options: TlsProbeOptions = {}): Probe<TlsInput, TlsRaw> {
  const dial = dialOf(options);
  const store = lazyStore(options.roots ?? []);
  return defineProbe<TlsInput, TlsRaw>({
    id: "tls.handshake",
    version: "1",
    summary: "One TCP connect and one TLS handshake, with the certificate of the server.",
    layer: "tls",
    mode: "active",
    kinds: [TCP_CONNECT, TLS_HANDSHAKE],
    peers: (input) => [peerOf(input.address, input.port ?? 443)],
    available: native,
    async run(input, context) {
      const port = input.port ?? 443;
      const w = watch(context, timeoutOf(input.timeoutMs));
      try {
        const { socket, phase } = await connectPhase(dial, input.address, port, w, context.clock);
        if (socket === undefined) {
          context.signal.throwIfAborted();
          return { tcp: phase };
        }
        const handshake = await handshakePhase(socket, { address: input.address, servername: input.servername, alpn: input.alpn }, store(), w, context.clock);
        handshake.secure?.destroy();
        context.signal.throwIfAborted();
        return { tcp: phase, tls: handshake.phase };
      } finally {
        w.close();
      }
    },
    parse(raw) {
      const observations: Observation[] = [tcpObservation(raw.tcp)];
      if (raw.tls !== undefined) observations.push(tlsObservation(raw.tcp.address, raw.tcp.port, raw.tls));
      return observations;
    },
  });
}

/** The TLS probe with the public roots and the roots of the computer. */
export const TLS_PROBE: Probe<TlsInput, TlsRaw> = tlsProbe();

/** The input of the HTTP probe: one HTTP/1.1 request over TCP, or over TLS for `https`. */
export interface HttpInput {
  readonly address: string;
  readonly scheme: "http" | "https";
  /** The port. The default is 80 for `http` and 443 for `https`. */
  readonly port?: number | undefined;
  /** The name of the host for the `Host` field and for SNI. The default is the address. */
  readonly host?: string | undefined;
  /** The path of the request. The default is `/`. */
  readonly path?: string | undefined;
  /** The method. The default is `GET`. */
  readonly method?: "GET" | "HEAD" | undefined;
  readonly timeoutMs?: number | undefined;
  /** The limit of the bytes of the body that the probe reads. The default is 65536. */
  readonly maxBytes?: number | undefined;
}

/** The raw output of the HTTP probe. */
export interface HttpRaw {
  readonly scheme: "http" | "https";
  readonly tcp: TcpPhase;
  readonly tls?: TlsPhase | undefined;
  readonly http?: HttpPhase | undefined;
}

/** The limit of the bytes of a body that the HTTP probe reads, when its input gives none: 64 KiB. */
export const DEFAULT_MAX_BYTES = 65536;

function hostField(input: HttpInput, port: number): string {
  const host = input.host ?? (isIP(input.address) === 6 ? `[${input.address}]` : input.address);
  const standard = input.scheme === "https" ? 443 : 80;
  return port === standard ? host : `${host}:${port}`;
}

/**
 * This function makes the HTTP probe. It sends one request, follows no redirect, and reads the body up to a limit. It
 * gives the facts of each phase: TCP, TLS for `https`, and HTTP. For `https`, it sends the request only when the
 * certificate passes its check.
 */
export function httpProbe(options: TlsProbeOptions = {}): Probe<HttpInput, HttpRaw> {
  const dial = dialOf(options);
  const store = lazyStore(options.roots ?? []);
  const portOf = (input: HttpInput): number => input.port ?? (input.scheme === "https" ? 443 : 80);
  return defineProbe<HttpInput, HttpRaw>({
    id: "http.request",
    version: "1",
    summary: "One HTTP/1.1 request, with the time of each phase: TCP, TLS and the first byte.",
    layer: "http",
    mode: "active",
    kinds: [TCP_CONNECT, TLS_HANDSHAKE, HTTP_RESPONSE],
    peers(input) {
      const path = input.path ?? "/";
      if (!path.startsWith("/") || /[\s]/.test(path)) throw new TypeError(`"${path}" is not a path that starts with "/" and has no space.`);
      return [peerOf(input.address, portOf(input))];
    },
    available: native,
    async run(input, context) {
      const port = portOf(input);
      const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
      if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new RangeError(`The limit of bytes ${maxBytes} is not a positive integer.`);
      const w = watch(context, timeoutOf(input.timeoutMs));
      try {
        const { socket, phase: tcp } = await connectPhase(dial, input.address, port, w, context.clock);
        if (socket === undefined) {
          context.signal.throwIfAborted();
          return { scheme: input.scheme, tcp };
        }
        let stream = socket;
        let secured: TlsPhase | undefined;
        if (input.scheme === "https") {
          const handshake = await handshakePhase(socket, { address: input.address, servername: input.host, alpn: ["http/1.1"] }, store(), w, context.clock);
          secured = handshake.phase;
          // A request on a session with a certificate that is not valid can send the path to an interceptor.
          if (handshake.secure === undefined || secured.outcome !== "ok") {
            handshake.secure?.destroy();
            context.signal.throwIfAborted();
            return { scheme: input.scheme, tcp, tls: secured };
          }
          stream = handshake.secure;
        }
        const http = await exchangePhase(stream, { method: input.method ?? "GET", host: hostField(input, port), path: input.path ?? "/", maxBytes }, w, context.clock);
        context.signal.throwIfAborted();
        return { scheme: input.scheme, tcp, ...(secured === undefined ? {} : { tls: secured }), http };
      } finally {
        w.close();
      }
    },
    parse(raw) {
      const { address, port } = raw.tcp;
      const observations: Observation[] = [tcpObservation(raw.tcp)];
      if (raw.tls !== undefined) observations.push(tlsObservation(address, port, raw.tls));
      if (raw.http !== undefined) observations.push(httpObservation(address, port, raw.scheme, raw.http));
      return observations;
    },
  });
}

/** The HTTP probe with the public roots and the roots of the computer. */
export const HTTP_PROBE: Probe<HttpInput, HttpRaw> = httpProbe();
