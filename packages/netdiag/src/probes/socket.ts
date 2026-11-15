import { X509Certificate } from "node:crypto";
import { request } from "node:http";
import { connect as netConnect, isIP, type Socket, type TcpNetConnectOpts } from "node:net";
import * as tls from "node:tls";
import type { Clock } from "@mark1russell7/algebra/clock";
import { observe, type FactTime, type Observation } from "../fact.ts";
import {
  HTTP_RESPONSE,
  TCP_CONNECT,
  TLS_HANDSHAKE,
  type CertProblem,
  type ConnectOutcome,
  type HandshakeOutcome,
  type HttpOutcome,
  type TlsCertificate,
} from "../kinds.ts";
import type { ProbeContext } from "../probe.ts";
import { target, type Target } from "../target.ts";

/** The function that opens a TCP socket. A test can give a function that gives a socket with no connection. */
export type Dial = (options: TcpNetConnectOpts) => Socket;

/** The options of the native probes that connect. */
export interface ConnectOptions {
  /** The function that opens a TCP socket. The default is `connect` of `node:net`. */
  readonly dial?: Dial | undefined;
}

/** The time limit of a probe run, when its input gives none: 5 seconds. */
export const DEFAULT_TIMEOUT_MS = 5000;

const defaultDial: Dial = (options) => netConnect(options);

/** This function gives the dial of the options. */
export function dialOf(options: ConnectOptions): Dial {
  return options.dial ?? defaultDial;
}

/** This function gives the error code of a thrown value, for example `ECONNREFUSED`. */
export function codeOf(thrown: unknown): string | undefined {
  if (typeof thrown !== "object" || thrown === null) return undefined;
  const code: unknown = (thrown as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

function syscallOf(thrown: unknown): string | undefined {
  if (typeof thrown !== "object" || thrown === null) return undefined;
  const syscall: unknown = (thrown as { syscall?: unknown }).syscall;
  return typeof syscall === "string" ? syscall : undefined;
}

/** This function gives the peer of a probe that connects. It throws for an address that is not an IP address. */
export function peerOf(address: string, port: number): Target {
  if (isIP(address) === 0) {
    throw new TypeError(`"${address}" is not an IP address. Get the addresses of a name with the DNS probe first.`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError(`${port} is not a port from 1 to 65535.`);
  return target(address, port);
}

/** This function gives the time limit of an input. It throws for a limit that is not a positive number. */
export function timeoutOf(timeoutMs: number | undefined): number {
  const limit = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(limit) || limit <= 0) throw new RangeError(`The time limit ${limit} is not a positive number of milliseconds.`);
  return limit;
}

/**
 * The deadline and the signal of one probe run.
 *
 * The watch destroys the current socket when the deadline passes or when the signal stops the run. The phase that
 * waits on the socket then gives the outcome `timeout`.
 */
export interface Watch {
  expired(): boolean;
  guard(socket: Socket): void;
  close(): void;
}

/** This function starts the watch of a probe run. */
export function watch(context: ProbeContext, timeoutMs: number): Watch {
  let expired = false;
  let current: Socket | undefined;
  const stop = (): void => {
    current?.destroy();
  };
  const cancel = context.clock.after(timeoutMs, () => {
    expired = true;
    stop();
  });
  context.signal.addEventListener("abort", stop, { once: true });
  return {
    expired: () => expired,
    guard(socket) {
      current = socket;
      if (expired || context.signal.aborted) socket.destroy();
    },
    close() {
      cancel();
      context.signal.removeEventListener("abort", stop);
    },
  };
}

const ignore = (): void => undefined;

/** This function maps an error code of a TCP connect to its outcome. */
export function connectOutcome(code: string | undefined): ConnectOutcome {
  switch (code) {
    case "ECONNREFUSED":
      return "refused";
    case "ETIMEDOUT":
      return "timeout";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "EHOSTDOWN":
    case "ENETDOWN":
      return "unreachable";
    case "ECONNRESET":
      return "reset";
    default:
      return "error";
  }
}

/**
 * This function tells how a stream ended before its phase was complete.
 *
 * Node.js gives the code `ECONNRESET` for a TCP reset, with the system call that read it. It gives the same code with
 * no system call when the peer closed the connection with a FIN.
 */
export function endOf(thrown: unknown, expired: boolean): "timeout" | "reset" | "closed" | undefined {
  if (expired) return "timeout";
  const code = codeOf(thrown);
  if (code === "EPIPE") return "reset";
  if (code !== "ECONNRESET") return undefined;
  return syscallOf(thrown) === undefined ? "closed" : "reset";
}

const NOT_TLS = new Set(["ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_PACKET_LENGTH_TOO_LONG", "ERR_SSL_HTTP_REQUEST", "ERR_SSL_RECORD_LAYER_FAILURE"]);
const MISMATCH = new Set(["ERR_SSL_UNSUPPORTED_PROTOCOL", "ERR_SSL_NO_PROTOCOLS_AVAILABLE", "ERR_SSL_NO_SHARED_CIPHER", "ERR_SSL_WRONG_SSL_VERSION"]);

/** This function maps an error of a TLS handshake to its outcome. */
export function handshakeOutcome(thrown: unknown, expired: boolean): HandshakeOutcome {
  const end = endOf(thrown, expired);
  if (end !== undefined) return end;
  const code = codeOf(thrown) ?? "";
  if (NOT_TLS.has(code)) return "not-tls";
  if (code.includes("_ALERT_") || MISMATCH.has(code)) return "alert";
  return "error";
}

/** This function maps the authorization error of a TLS socket to the problem of the certificate. */
export function certProblem(code: string): CertProblem {
  switch (code) {
    case "CERT_HAS_EXPIRED":
      return "expired";
    case "CERT_NOT_YET_VALID":
      return "not-yet-valid";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "HOSTNAME_MISMATCH":
      return "name";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_GET_ISSUER_CERT":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "CERT_UNTRUSTED":
      return "untrusted";
    case "CERT_REVOKED":
      return "revoked";
    default:
      return "other";
  }
}

/** The TCP phase of a probe run. The times are readings of the clock of the runner. */
export interface TcpPhase {
  readonly address: string;
  readonly port: number;
  readonly family: 4 | 6;
  readonly start: number;
  readonly end: number;
  readonly outcome: ConnectOutcome;
  readonly code?: string | undefined;
}

/** This function connects to an address and a port, and gives the socket when it connected. */
export function connectPhase(dial: Dial, address: string, port: number, w: Watch, clock: Clock): Promise<{ socket?: Socket; phase: TcpPhase }> {
  const family = isIP(address) === 6 ? 6 : 4;
  const start = clock.now();
  return new Promise((resolve) => {
    const socket = dial({ host: address, port, family });
    socket.on("error", ignore);
    let done = false;
    const finish = (outcome: ConnectOutcome, code?: string): void => {
      if (done) return;
      done = true;
      const phase: TcpPhase = { address, port, family, start, end: clock.now(), outcome, ...(code === undefined ? {} : { code }) };
      if (outcome === "connected") resolve({ socket, phase });
      else {
        socket.destroy();
        resolve({ phase });
      }
    };
    socket.once("connect", () => finish("connected"));
    socket.once("error", (error) => (w.expired() ? finish("timeout") : finish(connectOutcome(codeOf(error)), codeOf(error))));
    socket.once("close", () => (w.expired() ? finish("timeout") : finish("error", "ECLOSED")));
    w.guard(socket);
  });
}

/** This function gives the observation of a TCP phase. */
export function tcpObservation(phase: TcpPhase): Observation {
  const { start, end, ...rest } = phase;
  return observe(TCP_CONNECT, target(phase.address, phase.port), { ...rest, ms: end - start }, { start, end });
}

/** The trust of the certificates of a TLS probe. */
export interface TrustStore {
  readonly context: tls.SecureContext;
  readonly publicRoots: ReadonlySet<string>;
}

function systemRoots(): readonly string[] {
  // `getCACertificates` is in Node.js 22.15 and later.
  const get: unknown = (tls as { getCACertificates?: unknown }).getCACertificates;
  if (typeof get !== "function") return [];
  try {
    const roots: unknown = get.call(tls, "system");
    return Array.isArray(roots) ? roots.filter((root): root is string => typeof root === "string") : [];
  } catch {
    return [];
  }
}

/**
 * This function makes the store of trust of a TLS probe. It has the public roots of Node.js, the roots of the computer
 * and the roots that the user gives. A chain that ends at a public root has the trust `public`. A chain that ends at a
 * different root has the trust `private`, for example the root of a proxy that examines TLS.
 */
export function trustStore(extraRoots: readonly string[] = []): TrustStore {
  const publicRoots = new Set(tls.rootCertificates.map((pem) => new X509Certificate(pem).fingerprint256));
  const context = tls.createSecureContext({ ca: [...tls.rootCertificates, ...systemRoots(), ...extraRoots] });
  return { context, publicRoots };
}

function text(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : value;
}

function isoTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toISOString();
}

function namesOf(subjectAltName: string | undefined): string[] {
  if (subjectAltName === undefined || subjectAltName.length === 0) return [];
  return subjectAltName
    .split(", ")
    .map((entry) => entry.replace(/^(?:DNS|IP Address):/, ""))
    .filter((entry) => entry.length > 0);
}

// Node.js links a certificate to itself only when the check of the chain found it as a root. Thus this function
// examines the certificate: its issuer is its subject, and its own key verifies its signature. It does not use
// `checkIssued`, because OpenSSL then also requires the key usage `keyCertSign`, and a server certificate has none.
function isSelfSigned(raw: Buffer): boolean {
  try {
    const certificate = new X509Certificate(raw);
    return certificate.issuer === certificate.subject && certificate.verify(certificate.publicKey);
  } catch {
    return false;
  }
}

function certificateOf(socket: tls.TLSSocket, store: TrustStore): TlsCertificate | undefined {
  const leaf = socket.getPeerCertificate(true);
  if (Object.keys(leaf).length === 0) return undefined;
  let top: tls.DetailedPeerCertificate = leaf;
  let chain = 1;
  const seen = new Set([leaf.fingerprint256]);
  while (top.issuerCertificate !== undefined && !seen.has(top.issuerCertificate.fingerprint256)) {
    top = top.issuerCertificate;
    seen.add(top.fingerprint256);
    chain += 1;
  }
  const authorized = socket.authorized;
  const reason: unknown = socket.authorizationError;
  return {
    subject: text(leaf.subject.CN) || text(leaf.subject.O),
    issuer: text(leaf.issuer.CN) || text(leaf.issuer.O),
    names: namesOf(leaf.subjectaltname),
    validFrom: isoTime(leaf.valid_from),
    validTo: isoTime(leaf.valid_to),
    fingerprint256: leaf.fingerprint256,
    selfSigned: isSelfSigned(leaf.raw),
    chain,
    trust: !authorized ? "none" : store.publicRoots.has(top.fingerprint256) ? "public" : "private",
    ...(authorized ? {} : { problem: certProblem(reason instanceof Error ? (codeOf(reason) ?? reason.message) : String(reason)) }),
  };
}

/** The TLS phase of a probe run. */
export interface TlsPhase {
  readonly servername?: string | undefined;
  readonly start: number;
  readonly end: number;
  readonly outcome: HandshakeOutcome;
  readonly protocol?: string | undefined;
  readonly cipher?: string | undefined;
  readonly alpn?: string | undefined;
  readonly code?: string | undefined;
  readonly certificate?: TlsCertificate | undefined;
}

/** The input of a TLS handshake. */
export interface HandshakeInput {
  readonly address: string;
  /** The name for SNI and for the check of the certificate. With no name, the check uses the address. */
  readonly servername?: string | undefined;
  readonly alpn?: readonly string[] | undefined;
}

/**
 * This function does a TLS handshake on a connected socket. It does not refuse a certificate that is not valid: it
 * gives the outcome `cert-error` and the problem of the certificate.
 */
export function handshakePhase(
  socket: Socket,
  input: HandshakeInput,
  store: TrustStore,
  w: Watch,
  clock: Clock,
): Promise<{ secure?: tls.TLSSocket; phase: TlsPhase }> {
  const start = clock.now();
  const servername = input.servername !== undefined && isIP(input.servername) === 0 ? input.servername : undefined;
  return new Promise((resolve) => {
    const secure = tls.connect({
      socket,
      host: input.address,
      ...(servername === undefined ? {} : { servername }),
      ...(input.alpn === undefined ? {} : { ALPNProtocols: [...input.alpn] }),
      secureContext: store.context,
      rejectUnauthorized: false,
    });
    secure.on("error", ignore);
    let done = false;
    const base = { ...(servername === undefined ? {} : { servername }), start };
    const finish = (phase: TlsPhase, ok: boolean): void => {
      if (done) return;
      done = true;
      if (ok) resolve({ secure, phase });
      else {
        secure.destroy();
        resolve({ phase });
      }
    };
    secure.once("secureConnect", () => {
      const cipher = secure.getCipher().name;
      const protocol = secure.getProtocol() ?? undefined;
      const alpn = typeof secure.alpnProtocol === "string" ? secure.alpnProtocol : undefined;
      const certificate = certificateOf(secure, store);
      finish(
        {
          ...base,
          end: clock.now(),
          outcome: secure.authorized ? "ok" : "cert-error",
          ...(protocol === undefined ? {} : { protocol }),
          ...(cipher.length === 0 ? {} : { cipher }),
          ...(alpn === undefined ? {} : { alpn }),
          ...(certificate === undefined ? {} : { certificate }),
        },
        true,
      );
    });
    secure.once("error", (error) => {
      const code = codeOf(error);
      finish({ ...base, end: clock.now(), outcome: handshakeOutcome(error, w.expired()), ...(code === undefined ? {} : { code }) }, false);
    });
    secure.once("close", () => finish({ ...base, end: clock.now(), outcome: w.expired() ? "timeout" : "closed" }, false));
    w.guard(secure);
  });
}

/** This function gives the observation of a TLS phase. */
export function tlsObservation(address: string, port: number, phase: TlsPhase): Observation {
  const { start, end, ...rest } = phase;
  return observe(TLS_HANDSHAKE, target(address, port), { address, port, ...rest, ms: end - start }, { start, end });
}

/** The fields of a response head that an HTTP fact keeps. */
export const KEPT_FIELDS: readonly string[] = ["server", "via", "location", "content-type", "content-length", "alt-svc", "x-cache", "cf-ray"];

/** The HTTP phase of a probe run. */
export interface HttpPhase {
  readonly method: "GET" | "HEAD";
  readonly host: string;
  readonly path: string;
  readonly start: number;
  /** The time of the head of the response. */
  readonly head?: number | undefined;
  readonly end: number;
  readonly outcome: HttpOutcome;
  readonly status?: number | undefined;
  readonly version?: string | undefined;
  readonly fields: Readonly<Record<string, string>>;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly code?: string | undefined;
}

/** The input of an HTTP exchange. */
export interface ExchangeInput {
  readonly method: "GET" | "HEAD";
  readonly host: string;
  readonly path: string;
  readonly maxBytes: number;
}

function httpOutcome(thrown: unknown, expired: boolean): HttpOutcome {
  const end = endOf(thrown, expired);
  if (end !== undefined) return end;
  return (codeOf(thrown) ?? "").startsWith("HPE_") ? "protocol" : "error";
}

/** This function sends one HTTP/1.1 request on a connected socket, and reads the response up to a limit of bytes. */
export function exchangePhase(socket: Socket, input: ExchangeInput, w: Watch, clock: Clock): Promise<HttpPhase> {
  return new Promise((resolve) => {
    let done = false;
    let head: number | undefined;
    let status: number | undefined;
    let version: string | undefined;
    let fields: Record<string, string> = {};
    let bytes = 0;
    let truncated = false;
    const start = clock.now();
    const finish = (outcome: HttpOutcome, code?: string): void => {
      if (done) return;
      done = true;
      resolve({
        method: input.method,
        host: input.host,
        path: input.path,
        start,
        ...(head === undefined ? {} : { head }),
        end: clock.now(),
        outcome,
        ...(status === undefined ? {} : { status }),
        ...(version === undefined ? {} : { version }),
        fields,
        bytes,
        truncated,
        ...(code === undefined ? {} : { code }),
      });
      socket.destroy();
    };
    const req = request({
      createConnection: () => socket,
      method: input.method,
      path: input.path,
      headers: { host: input.host, "user-agent": "netdiag", accept: "*/*", connection: "close" },
    });
    req.on("error", (error) => finish(httpOutcome(error, w.expired()), codeOf(error)));
    req.on("close", () => finish(w.expired() ? "timeout" : "closed"));
    req.on("response", (res) => {
      head = clock.now();
      status = res.statusCode;
      version = res.httpVersion;
      fields = Object.fromEntries(
        KEPT_FIELDS.flatMap((name) => {
          const value = res.headers[name];
          return value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]];
        }),
      );
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes >= input.maxBytes) {
          truncated = true;
          finish("response");
        }
      });
      res.on("end", () => finish("response"));
      res.on("error", (error) => finish(httpOutcome(error, w.expired()), codeOf(error)));
    });
    req.end();
  });
}

/** This function gives the observation of an HTTP phase. */
export function httpObservation(address: string, port: number, scheme: "http" | "https", phase: HttpPhase): Observation {
  const { start, end, head, ...rest } = phase;
  const time: FactTime = { start, end };
  return observe(
    HTTP_RESPONSE,
    target(address, port),
    { address, port, scheme, ...rest, ...(head === undefined ? {} : { ttfbMs: head - start }), ms: end - start },
    time,
  );
}
