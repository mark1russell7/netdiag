import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer, Socket, type Server } from "node:net";
import { createServer as createTlsServer, type TlsOptions } from "node:tls";
import { fakeClock, realClock, type Clock, type FakeClock } from "@mark1russell7/algebra/clock";
import { faultPlanOf, type Fault } from "@mark1russell7/rigor-chaos";
import { startFaultProxy, type FaultProxy } from "@mark1russell7/rigor-proxy";
import { authority, expiredValidity, listen, selfSigned as selfSignedPems, startDnsServer, type Authority, type Pems, type Zone } from "@netdiag/fixtures";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DNS_ANSWER,
  DNS_PROBE,
  HTTP_RESPONSE,
  TCP_CONNECT,
  TCP_PROBE,
  TLS_HANDSHAKE,
  createRunner,
  httpProbe,
  scopeOf,
  tcpProbe,
  tlsProbe,
  type DnsAnswer,
  type Fact,
  type HttpResponse,
  type ProbeOutcome,
  type Runner,
  type TcpConnect,
  type TlsHandshake,
} from "../index.ts";

const LOCAL = "127.0.0.1";
const closers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

function runnerWith(clock: Clock): Runner {
  const scope = scopeOf([{ kind: "range", cidr: "127.0.0.0/8", basis: "owned" }], { maxPortsPerHost: 64 });
  if (scope.tag === "err") throw new Error(scope.error.join(" "));
  return createRunner({ scope: scope.value, clock });
}

/** This function starts a server on a free port of the loopback address, and closes it after the test. */
async function serve(server: Server | HttpServer): Promise<number> {
  const listening = await listen(server, LOCAL);
  closers.push(() => listening.close());
  return listening.port;
}

async function proxyTo(port: number, fault: Fault): Promise<number> {
  const proxy: FaultProxy = await startFaultProxy({ target: { host: LOCAL, port }, plan: faultPlanOf([fault]) });
  closers.push(() => proxy.close());
  return proxy.port;
}

function factOf<V>(outcome: ProbeOutcome<unknown>, kind: { kind: string }): V {
  if (outcome.status !== "done") throw new Error(`The run did not end: ${JSON.stringify(outcome)}`);
  const fact = outcome.facts.find((f: Fact) => f.kind === kind.kind);
  if (fact === undefined) throw new Error(`The run gave no fact ${kind.kind}: ${outcome.facts.map((f) => f.kind).join(", ")}`);
  return fact.value as V;
}

function kindsOf(outcome: ProbeOutcome<unknown>): string[] {
  return outcome.status === "done" ? outcome.facts.map((fact) => fact.kind) : [];
}

/** This function waits until the fake clock has a timer, then moves it past the time limit. */
async function expire(clock: FakeClock, ms: number, ready: () => boolean = () => true): Promise<void> {
  await vi.waitFor(() => {
    if (clock.pending === 0 || !ready()) throw new Error("The probe has no timer yet.");
  });
  await clock.advance(ms);
}

// A DNS server on UDP with a fixed zone. A name that is not in the zone gets NXDOMAIN.
const ZONE: Zone = {
  "ok.test": { rcode: 0, a: ["192.0.2.10", "192.0.2.11"], aaaa: ["20010db8000000000000000000000010"] },
  "empty.test": { rcode: 0 },
  "fail.test": { rcode: 2 },
  "refuse.test": { rcode: 5 },
  "slow.test": "silent",
};

async function dnsServer(): Promise<{ port: number; asked: readonly string[] }> {
  const server = await startDnsServer({ zone: ZONE, host: LOCAL });
  closers.push(() => server.close());
  return { port: server.port, asked: server.asked };
}

describe("the DNS probe", () => {
  it("gives the addresses and the lowest TTL", async () => {
    const { port } = await dnsServer();
    const runner = runnerWith(realClock);
    const a = await runner.run(DNS_PROBE, { name: "ok.test", resolver: LOCAL, port });
    expect(factOf<DnsAnswer>(a, DNS_ANSWER)).toMatchObject({ outcome: "ok", record: "A", addresses: ["192.0.2.10", "192.0.2.11"], ttl: 240, resolver: `${LOCAL}:${port}` });
    const aaaa = await runner.run(DNS_PROBE, { name: "ok.test", record: "AAAA", resolver: LOCAL, port });
    expect(factOf<DnsAnswer>(aaaa, DNS_ANSWER)).toMatchObject({ outcome: "ok", addresses: ["2001:db8::10"] });
    if (a.status === "done") expect(a.facts[0]?.subject).toEqual({ host: "ok.test", kind: "name" });
  });

  it.each([
    ["missing.test", "nxdomain"],
    ["empty.test", "nodata"],
    ["fail.test", "servfail"],
    ["refuse.test", "refused"],
  ])("gives the outcome of %s: %s", async (name, outcome) => {
    const { port } = await dnsServer();
    const result = await runnerWith(realClock).run(DNS_PROBE, { name, resolver: LOCAL, port });
    expect(factOf<DnsAnswer>(result, DNS_ANSWER)).toMatchObject({ outcome, addresses: [] });
  });

  it("gives a timeout when the resolver does not answer", async () => {
    const { port, asked } = await dnsServer();
    const clock = fakeClock(1000);
    const pending = runnerWith(clock).run(DNS_PROBE, { name: "slow.test", resolver: LOCAL, port, timeoutMs: 60_000 });
    await expire(clock, 60_000, () => asked.includes("slow.test"));
    expect(factOf<DnsAnswer>(await pending, DNS_ANSWER)).toMatchObject({ outcome: "timeout", ms: 60_000 });
  });

  it("stops when the signal stops the run", async () => {
    const { port, asked } = await dnsServer();
    const controller = new AbortController();
    const pending = runnerWith(realClock).run(DNS_PROBE, { name: "slow.test", resolver: LOCAL, port, timeoutMs: 60_000 }, controller.signal);
    await vi.waitFor(() => expect(asked).toContain("slow.test"));
    controller.abort(new Error("The user stopped the diagnosis."));
    expect(await pending).toEqual({ status: "aborted", reason: "The user stopped the diagnosis." });
  });

  it("refuses a resolver that is not in the scope, and an address in place of a name", async () => {
    const runner = runnerWith(realClock);
    expect(await runner.run(DNS_PROBE, { name: "ok.test", resolver: "192.0.2.53" })).toMatchObject({ status: "refused" });
    expect(await runner.run(DNS_PROBE, { name: "192.0.2.1", resolver: LOCAL })).toMatchObject({ status: "failed", stage: "probe" });
  });
});

describe("the TCP probe", () => {
  it("connects to a port that listens", async () => {
    const port = await serve(createNetServer());
    const result = await runnerWith(realClock).run(TCP_PROBE, { address: LOCAL, port });
    expect(kindsOf(result)).toEqual(["tcp.connect"]);
    expect(factOf<TcpConnect>(result, TCP_CONNECT)).toMatchObject({ address: LOCAL, port, family: 4, outcome: "connected" });
  });

  it("gives refused for a port with no listener", async () => {
    const server = createNetServer();
    const port = await serve(server);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = await runnerWith(realClock).run(TCP_PROBE, { address: LOCAL, port });
    expect(factOf<TcpConnect>(result, TCP_CONNECT)).toMatchObject({ outcome: "refused", code: "ECONNREFUSED" });
  }, 15_000);

  it("gives a timeout when the connect does not end", async () => {
    const clock = fakeClock(0);
    const probe = tcpProbe({ dial: () => new Socket() });
    const pending = runnerWith(clock).run(probe, { address: LOCAL, port: 9, timeoutMs: 3000 });
    await expire(clock, 3000);
    expect(factOf<TcpConnect>(await pending, TCP_CONNECT)).toMatchObject({ outcome: "timeout", ms: 3000 });
  });

  it("stops when the signal stops the run", async () => {
    const controller = new AbortController();
    const pending = runnerWith(realClock).run(tcpProbe({ dial: () => new Socket() }), { address: LOCAL, port: 9 }, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    expect(await pending).toMatchObject({ status: "aborted" });
  });

  it("connects only to an IP address in the scope", async () => {
    const runner = runnerWith(realClock);
    expect(await runner.run(TCP_PROBE, { address: "localhost", port: 80 })).toMatchObject({ status: "failed", stage: "probe" });
    expect(await runner.run(TCP_PROBE, { address: "192.0.2.1", port: 80 })).toMatchObject({ status: "refused" });
    expect(await runner.run(TCP_PROBE, { address: LOCAL, port: 0 })).toMatchObject({ status: "failed", stage: "probe" });
  });
});

let ca: Authority;
let leaf: Pems;
let expired: Pems;
let selfSigned: Pems;

beforeAll(async () => {
  ca = await authority("netdiag test root");
  leaf = await ca.issue(["localhost", LOCAL]);
  expired = await ca.issue(["localhost", LOCAL], expiredValidity());
  selfSigned = await selfSignedPems(["localhost", LOCAL]);
}, 60_000);

async function tlsServer(options: TlsOptions): Promise<number> {
  const server = createTlsServer({ ALPNProtocols: ["http/1.1"], ...options }, (socket) => socket.on("error", () => undefined));
  server.on("tlsClientError", () => undefined);
  return serve(server);
}

describe("the TLS probe", () => {
  it("measures the handshake, and names a private root", async () => {
    const port = await tlsServer(leaf);
    const result = await runnerWith(realClock).run(tlsProbe({ roots: [ca.cert] }), { address: LOCAL, port, servername: "localhost", alpn: ["http/1.1"] });
    expect(kindsOf(result)).toEqual(["tcp.connect", "tls.handshake"]);
    const handshake = factOf<TlsHandshake>(result, TLS_HANDSHAKE);
    expect(handshake).toMatchObject({ outcome: "ok", servername: "localhost", protocol: "TLSv1.3", alpn: "http/1.1" });
    expect(handshake.certificate).toMatchObject({ subject: "localhost", issuer: "netdiag test root", names: ["localhost", LOCAL], chain: 2, selfSigned: false, trust: "private" });
    expect(handshake.certificate?.problem).toBeUndefined();
  });

  it("gives the trust public to a chain that ends at a root of the option publicRoots", async () => {
    const port = await tlsServer(leaf);
    const runner = runnerWith(realClock);
    const lab = factOf<TlsHandshake>(await runner.run(tlsProbe({ publicRoots: [ca.cert] }), { address: LOCAL, port, servername: "localhost" }), TLS_HANDSHAKE);
    expect(lab).toMatchObject({ outcome: "ok", certificate: { trust: "public" } });
    const both = factOf<TlsHandshake>(await runner.run(tlsProbe({ roots: [ca.cert], publicRoots: [ca.cert] }), { address: LOCAL, port, servername: "localhost" }), TLS_HANDSHAKE);
    expect(both.certificate?.trust).toBe("public");
  });

  it("checks the address when the input has no name", async () => {
    const port = await tlsServer(leaf);
    const result = await runnerWith(realClock).run(tlsProbe({ roots: [ca.cert] }), { address: LOCAL, port });
    expect(factOf<TlsHandshake>(result, TLS_HANDSHAKE)).toMatchObject({ outcome: "ok", certificate: { trust: "private" } });
  });

  // The trust names the root of the chain, also for a certificate that is not valid.
  it.each<[string, () => Pems, readonly string[], string, string, string]>([
    ["an unknown root", () => leaf, [], "localhost", "untrusted", "none"],
    ["a different name", () => leaf, ["ca"], "other.test", "name", "private"],
    ["an expired certificate", () => expired, ["ca"], "localhost", "expired", "private"],
    ["a self-signed certificate", () => selfSigned, [], "localhost", "untrusted", "none"],
  ])("gives cert-error for %s", async (_name, pems, roots, servername, problem, trust) => {
    const port = await tlsServer(pems());
    const probe = tlsProbe({ roots: roots.map(() => ca.cert) });
    const handshake = factOf<TlsHandshake>(await runnerWith(realClock).run(probe, { address: LOCAL, port, servername }), TLS_HANDSHAKE);
    expect(handshake).toMatchObject({ outcome: "cert-error", certificate: { trust, problem } });
  });

  it("names the self-signed certificate", async () => {
    const port = await tlsServer(selfSigned);
    const runner = runnerWith(realClock);
    const unknown = factOf<TlsHandshake>(await runner.run(tlsProbe(), { address: LOCAL, port, servername: "localhost" }), TLS_HANDSHAKE);
    expect(unknown.certificate).toMatchObject({ selfSigned: true, chain: 1, trust: "none" });
    const trusted = factOf<TlsHandshake>(await runner.run(tlsProbe({ roots: [selfSigned.cert] }), { address: LOCAL, port, servername: "localhost" }), TLS_HANDSHAKE);
    expect(trusted).toMatchObject({ outcome: "ok", certificate: { selfSigned: true, chain: 1, trust: "private" } });
  });

  it("gives alert when the client and the server have no cipher in common", async () => {
    const port = await tlsServer({ ...leaf, ciphers: "ECDHE-RSA-AES128-GCM-SHA256", maxVersion: "TLSv1.2" });
    const handshake = factOf<TlsHandshake>(await runnerWith(realClock).run(tlsProbe({ roots: [ca.cert] }), { address: LOCAL, port }), TLS_HANDSHAKE);
    expect(handshake.outcome).toBe("alert");
    expect(handshake.code).toMatch(/^ERR_SSL_/);
  });

  it("gives not-tls for a server that speaks HTTP", async () => {
    const port = await serve(createHttpServer((_req, res) => res.end("plain")));
    const handshake = factOf<TlsHandshake>(await runnerWith(realClock).run(TLS_PROBE_LOCAL(), { address: LOCAL, port }), TLS_HANDSHAKE);
    expect(handshake.outcome).toBe("not-tls");
  });

  it.each<[Fault["kind"], string]>([
    ["reset", "reset"],
    ["cut", "closed"],
  ])("gives %s → %s when the path ends the handshake", async (kind, outcome) => {
    const port = await proxyTo(await tlsServer(leaf), { connection: 0, direction: "down", at: { frame: 0 }, kind } as Fault);
    const result = await runnerWith(realClock).run(tlsProbe({ roots: [ca.cert] }), { address: LOCAL, port });
    expect(factOf<TcpConnect>(result, TCP_CONNECT).outcome).toBe("connected");
    expect(factOf<TlsHandshake>(result, TLS_HANDSHAKE).outcome).toBe(outcome);
  });

  it("gives a timeout when the server does not answer the handshake", async () => {
    let connected = false;
    const port = await serve(createNetServer(() => (connected = true)));
    const clock = fakeClock(0);
    const pending = runnerWith(clock).run(tlsProbe(), { address: LOCAL, port, timeoutMs: 4000 });
    await expire(clock, 4000, () => connected);
    const result = await pending;
    expect(factOf<TcpConnect>(result, TCP_CONNECT).outcome).toBe("connected");
    expect(factOf<TlsHandshake>(result, TLS_HANDSHAKE)).toMatchObject({ outcome: "timeout" });
  });
});

function TLS_PROBE_LOCAL() {
  return tlsProbe({ roots: [ca.cert] });
}

describe("the HTTP probe", () => {
  const body = (size: number): string => "x".repeat(size);

  async function httpServer(status = 200, size = 5): Promise<number> {
    return serve(
      createHttpServer((_req, res) => {
        res.writeHead(status, { server: "netdiag-test", "content-type": "text/plain", "content-length": size, "x-other": "dropped" });
        res.end(body(size));
      }),
    );
  }

  it("gives the facts of TCP and HTTP", async () => {
    const port = await httpServer();
    const result = await runnerWith(realClock).run(httpProbe(), { address: LOCAL, port, scheme: "http", path: "/health" });
    expect(kindsOf(result)).toEqual(["tcp.connect", "http.response"]);
    const response = factOf<HttpResponse>(result, HTTP_RESPONSE);
    expect(response).toMatchObject({
      outcome: "response",
      status: 200,
      version: "1.1",
      method: "GET",
      host: `${LOCAL}:${port}`,
      path: "/health",
      bytes: 5,
      truncated: false,
      fields: { server: "netdiag-test", "content-type": "text/plain", "content-length": "5" },
    });
    expect(response.fields["x-other"]).toBeUndefined();
    expect(response.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(response.ms).toBeGreaterThanOrEqual(response.ttfbMs ?? 0);
  });

  it("gives the facts of TCP, TLS and HTTP for https", async () => {
    let host: string | undefined;
    const server = createHttpsServer({ ...leaf, ALPNProtocols: ["http/1.1"] }, (req, res) => {
      host = req.headers.host;
      res.end("secure");
    });
    const port = await serve(server);
    const result = await runnerWith(realClock).run(httpProbe({ roots: [ca.cert] }), { address: LOCAL, port, scheme: "https", host: "localhost" });
    expect(kindsOf(result)).toEqual(["tcp.connect", "tls.handshake", "http.response"]);
    expect(factOf<TlsHandshake>(result, TLS_HANDSHAKE)).toMatchObject({ outcome: "ok", servername: "localhost", alpn: "http/1.1" });
    expect(factOf<HttpResponse>(result, HTTP_RESPONSE)).toMatchObject({ scheme: "https", status: 200, bytes: 6 });
    expect(host).toBe(`localhost:${port}`);
  });

  it("sends no request when the certificate is not valid, and keeps the problem", async () => {
    let asked = false;
    const port = await serve(
      createHttpsServer(leaf, (_req, res) => {
        asked = true;
        res.end("ok");
      }),
    );
    const result = await runnerWith(realClock).run(httpProbe(), { address: LOCAL, port, scheme: "https", host: "localhost", path: "/secret-token" });
    expect(kindsOf(result)).toEqual(["tcp.connect", "tls.handshake"]);
    expect(factOf<TlsHandshake>(result, TLS_HANDSHAKE)).toMatchObject({ outcome: "cert-error", certificate: { problem: "untrusted" } });
    expect(asked).toBe(false);
  });

  it("gives the status of an error", async () => {
    const port = await httpServer(503);
    expect(factOf<HttpResponse>(await runnerWith(realClock).run(httpProbe(), { address: LOCAL, port, scheme: "http" }), HTTP_RESPONSE)).toMatchObject({
      outcome: "response",
      status: 503,
    });
  });

  it("stops the read of the body at the limit", async () => {
    const port = await httpServer(200, 200_000);
    const response = factOf<HttpResponse>(await runnerWith(realClock).run(httpProbe(), { address: LOCAL, port, scheme: "http", maxBytes: 1024 }), HTTP_RESPONSE);
    expect(response.truncated).toBe(true);
    expect(response.bytes).toBeGreaterThanOrEqual(1024);
    expect(response.bytes).toBeLessThan(200_000);
  });

  it("reads no body for HEAD", async () => {
    const port = await httpServer();
    expect(factOf<HttpResponse>(await runnerWith(realClock).run(httpProbe(), { address: LOCAL, port, scheme: "http", method: "HEAD" }), HTTP_RESPONSE)).toMatchObject({
      method: "HEAD",
      status: 200,
      bytes: 0,
    });
  });

  it("gives a timeout when the server does not answer the request", async () => {
    let asked = false;
    const port = await serve(createHttpServer(() => (asked = true)));
    const clock = fakeClock(0);
    const pending = runnerWith(clock).run(httpProbe(), { address: LOCAL, port, scheme: "http", timeoutMs: 2000 });
    await expire(clock, 2000, () => asked);
    const response = factOf<HttpResponse>(await pending, HTTP_RESPONSE);
    expect(response).toMatchObject({ outcome: "timeout" });
    expect(response.status).toBeUndefined();
  });

  it("gives reset when the path resets the connection before the response", async () => {
    const port = await proxyTo(await httpServer(), { connection: 0, direction: "down", at: { frame: 0 }, kind: "reset" });
    expect(factOf<HttpResponse>(await runnerWith(realClock).run(httpProbe(), { address: LOCAL, port, scheme: "http" }), HTTP_RESPONSE).outcome).toBe("reset");
  });

  it("gives protocol for a server that does not speak HTTP", async () => {
    const port = await serve(createNetServer((socket) => socket.once("data", () => socket.end("HELLO THERE\r\n\r\n"))));
    const response = factOf<HttpResponse>(await runnerWith(realClock).run(httpProbe(), { address: LOCAL, port, scheme: "http" }), HTTP_RESPONSE);
    expect(response.outcome).toBe("protocol");
    expect(response.code).toMatch(/^HPE_/);
  });

  it("refuses a path that is not a path", async () => {
    expect(await runnerWith(realClock).run(httpProbe(), { address: LOCAL, port: 80, scheme: "http", path: "http://x/" })).toMatchObject({
      status: "failed",
      stage: "probe",
    });
  });
});

describe("the records of the probes", () => {
  it("gives the same facts again from a raw output in JSON", async () => {
    const port = await serve(createHttpServer((_req, res) => res.end("again")));
    const probe = httpProbe();
    const input = { address: LOCAL, port, scheme: "http" } as const;
    const result = await runnerWith(realClock).run(probe, input);
    if (result.status !== "done") throw new Error(result.status);
    const replay = probe.parse(JSON.parse(JSON.stringify(result.raw)), input);
    expect(replay.map((o) => o.value)).toEqual(result.facts.map((f) => f.value));
    for (const fact of result.facts) expect(JSON.parse(JSON.stringify(fact))).toEqual(fact);
  });

  it("refuses values that do not pass the check of their kind", () => {
    expect(DNS_ANSWER.check({ name: "a.test", record: "A", resolver: "x", outcome: "ok", addresses: [], ms: 1 })).toBe(false);
    expect(TCP_CONNECT.check({ address: LOCAL, port: 70000, family: 4, outcome: "connected", ms: 1 })).toBe(false);
    expect(TLS_HANDSHAKE.check({ address: LOCAL, port: 443, outcome: "maybe", ms: 1 })).toBe(false);
    expect(HTTP_RESPONSE.check({ address: LOCAL, port: 80, scheme: "http", method: "GET", host: "h", path: "/", outcome: "response", fields: {}, bytes: 0, truncated: false, ms: 1 })).toBe(
      false,
    );
  });
});
