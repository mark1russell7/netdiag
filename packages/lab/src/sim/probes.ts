import type { FakeClock } from "@mark1russell7/algebra/clock";
import { DEFAULT_TIMEOUT_MS, DNS_PROBE, dnsOutcome, formatTarget, triesOf, tryTimeoutOf, httpProbe, target, type HttpInput, type HttpPhase, type HttpRaw, type InterfaceTable, type Probe, type TcpPhase, type TlsCertificate, type TlsPhase } from "@mark1russell7/netdiag";
import { SERVER_HTTP_MS, SERVER_TLS_MS, SIM_ADDRESSES, type End, type Family, type Fate, type Hop, type Packet, type SimNetwork } from "./network.ts";
import { WIFI_INTERFACE, WIRED_INTERFACE } from "./tools.ts";

// The probes of the simulated client that do not start a tool: the DNS query and the HTTP request. Each probe keeps
// the id, the peers and the reader of the real probe, and replaces only `run`. Its raw output has the form that the real
// probe gives for the fate of its packets in the model. The link probe reads the table of interfaces of `interfacesOf`.

/** The size of a full TCP segment of a path with an MTU of 1500 bytes, with its headers. */
const FULL_SEGMENT = 1500;

/** The times of the SYN tries of Linux in one connect, in ms after the first SYN: an initial RTO of 1 s that doubles. */
export const SYN_TRIES_MS: readonly number[] = [0, 1000, 3000, 7000, 15_000];

/** The smallest RTO of Linux, in ms. */
const MIN_RTO_MS = 200;

/** This function gives the table of interfaces of the client, in the form of `os.networkInterfaces`. */
export function interfacesOf(net: SimNetwork): InterfaceTable {
  const loopback = { lo: [{ address: "127.0.0.1", cidr: "127.0.0.1/8", internal: true }] };
  // libuv lists only an interface with the flags IFF_UP and IFF_RUNNING. An interface with no carrier is not in the table.
  if (net.adminDown || net.carrierDown) return loopback;
  const name = net.setup.medium === "wifi" ? WIFI_INTERFACE : WIRED_INTERFACE;
  const v4 = { address: SIM_ADDRESSES.client[4], cidr: `${SIM_ADDRESSES.client[4]}/24`, internal: false };
  const v6 = { address: SIM_ADDRESSES.client[6], cidr: `${SIM_ADDRESSES.client[6]}/64`, internal: false };
  return { ...loopback, [name]: net.setup.ipv6 ? [v4, v6] : [v4] };
}

/** This function gives the DNS probe of the simulated client. The answer comes from the DNS of the model. */
export function simDnsProbe(net: SimNetwork, clock: FakeClock): typeof DNS_PROBE {
  return {
    ...DNS_PROBE,
    run(input) {
      const record = input.record ?? "A";
      const start = clock.now();
      const tries = triesOf(input.tries);
      const answer = net.dns(input.name, record, tryTimeoutOf(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, tries), tries);
      clock.block(answer.ms);
      const base = { name: input.name, record, resolver: formatTarget(target(input.resolver, input.port ?? 53)), start, end: clock.now(), tries };
      if (answer.code !== undefined) return Promise.resolve({ ...base, outcome: answer.code === "ETIMEOUT" ? "timeout" : dnsOutcome(answer.code), addresses: [], code: answer.code });
      return Promise.resolve({ ...base, outcome: "ok", addresses: [...answer.addresses], ...(answer.ttl === undefined ? {} : { ttl: answer.ttl }) });
    },
  };
}

/** The time of the end of one exchange of TCP segments with its retransmissions, or `undefined` when the deadline comes first. */
function exchange(net: SimNetwork, out: Packet, back: Packet, hops: readonly Hop[], from: number, to: number, startAt: number, deadline: number, rto: number): { at: number; fate: Fate } | undefined {
  let at = startAt;
  let wait = rto;
  for (;;) {
    const there = net.walk(out, hops, "out", from, to);
    const fate = there.fate === "arrive" ? net.walk(back, hops, "back", from, to) : there;
    if (fate.fate === "arrive") {
      const ms = there.fate === "arrive" ? there.ms + fate.ms : fate.ms;
      return at + ms > deadline ? undefined : { at: at + ms, fate };
    }
    // A message "packet too big" makes the sender cut its segments to the MTU of the path. The next try passes it.
    if (fate.fate === "too-big") {
      out = out.size > fate.mtu ? { ...out, size: fate.mtu } : out;
      back = back.size > fate.mtu ? { ...back, size: fate.mtu } : back;
      at += fate.ms;
    } else if (fate.fate === "reset") return { at: at + fate.ms, fate };
    else {
      at += wait;
      wait *= 2;
    }
    if (at > deadline) return undefined;
  }
}

/** The certificate that a client gets from an end, or from a TLS proxy. */
function certificateOf(net: SimNetwork, end: End, proxied: boolean): TlsCertificate {
  const name = net.certificateName(end);
  const problem = proxied ? undefined : net.certFault(end);
  const portal = end === "portal";
  const selfSigned = portal;
  const trust = proxied ? "private" : portal || problem === "untrusted" ? "none" : "public";
  return {
    subject: `CN=${name}`,
    issuer: portal ? `CN=${name}` : proxied ? "CN=Sim Inspection CA" : "CN=Sim Public CA R1",
    names: problem === "name" ? ["other.shop-lab.net"] : [name],
    validFrom: "2026-09-01T00:00:00.000Z",
    validTo: problem === "expired" ? "2026-10-01T00:00:00.000Z" : "2027-09-01T00:00:00.000Z",
    fingerprint256: `SIM:${name}:${proxied ? "proxy" : (problem ?? "ok")}`,
    selfSigned,
    chain: selfSigned ? 1 : problem === "untrusted" ? 1 : 2,
    trust,
    ...(problem === undefined ? {} : { problem }),
  };
}

/**
 * This function gives the HTTP probe of the simulated client: one HTTPS request with a TCP phase, a TLS phase and an HTTP
 * phase. One deadline from the start covers the three phases, as in the real probe.
 */
export function simHttpProbe(net: SimNetwork, clock: FakeClock): Probe<HttpInput, HttpRaw> {
  const real = httpProbe();
  return {
    ...real,
    run(input) {
      const raw = request(net, input, clock.now());
      clock.block(raw.end - clock.now());
      return Promise.resolve(raw.raw);
    },
  };
}

function request(net: SimNetwork, input: HttpInput, start: number): { readonly end: number; readonly raw: HttpRaw } {
  const port = input.port ?? (input.scheme === "https" ? 443 : 80);
  const family: Family = input.address.includes(":") ? 6 : 4;
  const deadline = start + (input.timeoutMs ?? 5000);
  const scheme = input.scheme;
  const tcpBase = { address: input.address, port, family, start };
  const done = (tcp: TcpPhase, tls?: TlsPhase, http?: HttpPhase): { end: number; raw: HttpRaw } => ({
    end: http?.end ?? tls?.end ?? tcp.end,
    raw: { scheme, tcp, ...(tls === undefined ? {} : { tls }), ...(http === undefined ? {} : { http }) },
  });
  const local = net.localError(family);
  if (local !== undefined) return done({ ...tcpBase, end: start + 0.1, outcome: "unreachable", code: "ENETUNREACH" });
  const end = net.endOf(input.address);
  if (end === undefined) return done({ ...tcpBase, end: deadline, outcome: "timeout" });
  const hops = net.hops(end);
  const proxy = net.proxyOn(end);
  const near = proxy === undefined ? hops.length - 1 : proxy.hop;

  // The TCP phase: the SYN tries of Linux. An ICMP error or a RST ends the connect at once.
  let connected: number | undefined;
  let rtt = 0;
  for (const offset of SYN_TRIES_MS) {
    const at = start + offset;
    if (at >= deadline) break;
    const syn: Packet = { end, family, kind: "syn", size: family === 4 ? 60 : 80, df: true };
    const fate = net.roundTrip(syn, syn, hops, near);
    if (fate.fate === "arrive") {
      if (at + fate.ms <= deadline) connected = at + fate.ms;
      rtt = fate.ms;
      break;
    }
    if (fate.fate === "reset") return done({ ...tcpBase, end: at + fate.ms, outcome: "refused", code: "ECONNREFUSED" });
    if (fate.fate === "unreachable") {
      if (at + fate.ms > deadline) break;
      return done({ ...tcpBase, end: at + fate.ms, outcome: "unreachable", code: fate.code === "host" ? "EHOSTUNREACH" : "ENETUNREACH" });
    }
  }
  if (connected === undefined) return done({ ...tcpBase, end: deadline, outcome: "timeout" });
  const tcp: TcpPhase = { ...tcpBase, end: connected, outcome: "connected" };
  // Karn: only the SYN that got its answer gives a sample of the round trip time.
  const rto = Math.max(MIN_RTO_MS, 3 * rtt);
  if (scheme !== "https") return done(tcp);

  // The TLS phase. The ClientHello is small, and the flight of the server has full segments.
  const servername = input.host;
  const tlsBase = { ...(servername === undefined ? {} : { servername }), start: connected };
  const hello: Packet = { end, family, kind: "data", size: 580, df: true };
  const flight: Packet = { end, family, kind: "data", size: FULL_SEGMENT, df: true };
  const timeoutTls = (): TlsPhase => ({ ...tlsBase, end: deadline, outcome: "timeout" });
  const resetAt = net.resetHop(end);
  if (resetAt !== undefined) {
    const there = net.walk(hello, hops, "out", 0, resetAt);
    if (there.fate !== "arrive") return done(tcp, timeoutTls());
    return done(tcp, { ...tlsBase, end: connected + 2 * there.ms, outcome: "reset", code: "ECONNRESET" });
  }
  const first = exchange(net, hello, flight, hops, 0, near, connected, deadline, rto);
  if (first === undefined) return done(tcp, timeoutTls());
  let handshakeEnd = first.at + SERVER_TLS_MS;
  if (proxy !== undefined && proxy.status === undefined) {
    // The proxy makes its own connection to the server, and it waits for the certificate of the server.
    const upstream = exchange(net, hello, flight, hops, near + 1, hops.length - 1, handshakeEnd, deadline, rto);
    if (upstream === undefined) return done(tcp, timeoutTls());
    handshakeEnd = upstream.at + net.proxyMs;
  }
  if (handshakeEnd > deadline) return done(tcp, timeoutTls());
  if (proxy === undefined && net.tlsMismatch(end)) {
    return done(tcp, { ...tlsBase, end: first.at, outcome: "alert", code: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION" });
  }
  const certificate = certificateOf(net, end, proxy !== undefined);
  const secure = { protocol: "TLSv1.3", cipher: "TLS_AES_128_GCM_SHA256", alpn: "http/1.1", certificate };
  if (certificate.problem !== undefined || certificate.trust === "none") return done(tcp, { ...tlsBase, end: handshakeEnd, outcome: "cert-error", ...secure });
  const tls: TlsPhase = { ...tlsBase, end: handshakeEnd, outcome: "ok", ...secure };

  // The HTTP phase: one small request, then the head and the body of the response in full segments.
  const httpBase = { method: input.method ?? "GET", host: input.host ?? input.address, path: input.path ?? "/", start: handshakeEnd, fields: { server: "sim" } } as const;
  const response = exchange(net, hello, flight, hops, 0, near, handshakeEnd, deadline, rto);
  if (response === undefined) return done(tcp, tls, { ...httpBase, end: deadline, outcome: "timeout", bytes: 0, truncated: false });
  let head = response.at + SERVER_HTTP_MS;
  let status = proxy?.status;
  if (status === undefined) {
    if (proxy !== undefined) {
      const upstream = exchange(net, hello, flight, hops, near + 1, hops.length - 1, head, deadline, rto);
      if (upstream === undefined) return done(tcp, tls, { ...httpBase, end: deadline, outcome: "timeout", bytes: 0, truncated: false });
      head = upstream.at + SERVER_HTTP_MS;
    }
    head += net.serverDelay(end);
    status = net.serverStatus(end);
  }
  if (head > deadline) return done(tcp, tls, { ...httpBase, end: deadline, outcome: "timeout", bytes: 0, truncated: false });
  const http: HttpPhase = { ...httpBase, head, end: head + 0.5, outcome: "response", status, version: "1.1", bytes: 1024, truncated: false };
  return done(tcp, tls, http);
}
