import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CONNECT_OUTCOMES,
  DNS_ANSWER,
  DNS_ANSWER_VALUES,
  DNS_OUTCOMES,
  ECHO_OUTCOMES,
  GATEWAY_REPLY_VALUES,
  HANDSHAKE_OUTCOMES,
  HTTP_OUTCOMES,
  HTTP_RESPONSE,
  HTTP_TTFB_BINS,
  ICMP_ECHO,
  ICMP_REPLY_VALUES,
  LOSS_MIN_SENT,
  PATH_LOSS_BINS,
  PATH_REPORT,
  PATH_TRACE,
  STANDARD_CATALOG,
  STANDARD_FEATURES,
  TCP_CONNECT,
  TCP_CONNECT_VALUES,
  TCP_TIME_BINS,
  TLS_HANDSHAKE,
  TLS_HANDSHAKE_VALUES,
  TLS_RATIO_BINS,
  TLS_TRUST_VALUES,
  TRUSTS,
  binOf,
  diagnose,
  isLocalName,
  readEvidence,
  target,
  type Bin,
  type DnsAnswer,
  type Evidence,
  type Fact,
  type FactKind,
  type HttpResponse,
  type IcmpEcho,
  type PathReport,
  type PathTrace,
  type TcpConnect,
  type TlsHandshake,
  type Trust,
} from "./index.ts";

type Entry = readonly [FactKind<unknown>, unknown, number?];

/** This function makes facts in the order of a runner. Each fact starts at the end of the fact before it. */
function factsOf(entries: readonly Entry[]): Fact[] {
  let time = 0;
  return entries.map(([kind, value, ms], index) => {
    const start = time;
    time += ms ?? 1;
    return { id: `f${index}`, kind: kind.kind, layer: kind.layer, subject: target("192.0.2.1"), time: { start, end: time }, source: { probe: "test", version: "1" }, value };
  });
}

const RESOLVER = "192.0.2.53:53";

function dns(name: string, record: "A" | "AAAA", outcome: DnsAnswer["outcome"], addresses: string[] = []): Entry {
  const value: DnsAnswer = { name, record, resolver: RESOLVER, outcome, addresses, ms: 5 };
  return [DNS_ANSWER, value, 5];
}

function tcp(address: string, port: number, outcome: TcpConnect["outcome"], ms = 10): Entry {
  const value: TcpConnect = { address, port, family: address.includes(":") ? 6 : 4, outcome, ms };
  return [TCP_CONNECT, value, ms];
}

function echo(address: string, outcome: IcmpEcho["outcome"], sent = 4, received = outcome === "reply" ? sent : 0): Entry {
  const value: IcmpEcho = { address, outcome, sent, received, rttMs: Array.from({ length: received }, () => 2) };
  return [ICMP_ECHO, value, 50];
}

/** This function makes a report of mtr with two hops. The second hop is the address when the outcome is `reached`. */
function report(address: string, outcome: PathReport["outcome"], sent = LOSS_MIN_SENT, received = sent): Entry {
  const hops = [
    { ttl: 1, address: "192.0.2.254", sent, received: sent },
    outcome === "reached" ? { ttl: 2, address, sent, received } : { ttl: 2, sent, received: 0 },
  ];
  const value: PathReport = outcome === "error" ? { address, outcome, cycles: sent, hops: [], detail: "spawn mtr ENOENT" } : { address, outcome, cycles: sent, hops };
  return [PATH_REPORT, value, 1000];
}

function trace(address: string): Entry {
  const value: PathTrace = { address, outcome: "reached", maxHops: 30, hops: [{ ttl: 1, addresses: [address], sent: 3, received: 3, rttMs: [1, 1, 1] }] };
  return [PATH_TRACE, value, 100];
}

function certificate(trust: Trust): NonNullable<TlsHandshake["certificate"]> {
  return {
    subject: "example.com",
    issuer: "Test root",
    names: ["example.com"],
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: "2027-01-01T00:00:00.000Z",
    fingerprint256: "AA:BB",
    selfSigned: false,
    chain: 2,
    trust,
  };
}

function tls(address: string, outcome: TlsHandshake["outcome"], ms: number, trust?: Trust): Entry {
  const value: TlsHandshake = { address, port: 443, outcome, ms, ...(trust === undefined ? {} : { certificate: certificate(trust) }) };
  return [TLS_HANDSHAKE, value, ms];
}

function http(address: string, outcome: HttpResponse["outcome"], status?: number, ttfbMs?: number): Entry {
  const value: HttpResponse = {
    address,
    port: 443,
    scheme: "https",
    method: "GET",
    host: "example.com",
    path: "/",
    outcome,
    ...(status === undefined ? {} : { status }),
    fields: {},
    bytes: 0,
    truncated: false,
    ...(ttfbMs === undefined ? {} : { ttfbMs }),
    ms: (ttfbMs ?? 0) + 1,
  };
  return [HTTP_RESPONSE, value, value.ms];
}

function valuesOf(evidence: readonly Evidence[], feature: string): string[] {
  return evidence.filter((item) => item.feature === feature).map((item) => item.value);
}

function featureValues(id: string): readonly string[] {
  const feature = STANDARD_FEATURES.find((f) => f.id === id);
  if (feature === undefined) throw new Error(`The catalog has no feature ${id}.`);
  return feature.values;
}

describe("the tables of the readers", () => {
  it.each<[string, Readonly<Record<string, string | undefined>>]>([
    ["dns.answer", DNS_ANSWER_VALUES],
    ["tcp.connect", TCP_CONNECT_VALUES],
    ["tls.handshake", TLS_HANDSHAKE_VALUES],
    ["tls.trust", TLS_TRUST_VALUES],
    ["icmp.reply", ICMP_REPLY_VALUES],
    ["gateway.reply", GATEWAY_REPLY_VALUES],
  ])("give only values of the feature %s", (id, table) => {
    for (const value of Object.values(table)) if (value !== undefined) expect(featureValues(id)).toContain(value);
  });

  it.each<[string, readonly Bin[]]>([
    ["tcp.time", TCP_TIME_BINS],
    ["tls.ratio", TLS_RATIO_BINS],
    ["http.ttfb", HTTP_TTFB_BINS],
  ])("give each value of the feature %s from a bin", (id, bins) => {
    expect(bins.map((bin) => bin.value)).toEqual(featureValues(id));
    expect(bins.at(-1)?.below).toBeUndefined();
  });

  it("give each value of the feature path.loss from a bin of the share of replies", () => {
    expect(PATH_LOSS_BINS.map((bin) => bin.value).sort()).toEqual([...featureValues("path.loss")].sort());
    expect(PATH_LOSS_BINS.at(-1)?.below).toBeUndefined();
  });

  it("put a number at a limit in the next bin", () => {
    expect([149.9, 150, 899, 900, 5000].map((ms) => binOf(TCP_TIME_BINS, ms))).toEqual(["short", "long", "long", "retry", "retry"]);
    expect([2.9, 3, 7.9, 8].map((r) => binOf(TLS_RATIO_BINS, r))).toEqual(["low", "mid", "mid", "high"]);
    expect([18 / 20, 19 / 20, 57 / 60, 99 / 100, 1].map((r) => binOf(PATH_LOSS_BINS, r))).toEqual(["high", "some", "some", "some", "none"]);
    expect(() => binOf([{ below: 1, value: "a" }], 2)).toThrow(RangeError);
  });

  it("tell a local name", () => {
    expect(["router", "nas.local", "printer.lan", "a.home.arpa", "x.test", "LOCALHOST", "srv.corp."].map(isLocalName)).toEqual([true, true, true, true, true, true, true]);
    expect(["example.com", "example.co.uk", "lan.example.com"].map(isLocalName)).toEqual([false, false, false]);
  });
});

describe("readEvidence", () => {
  it("gives one dns.answer for a name and a resolver, and one answer ok decides", () => {
    const { evidence } = readEvidence(factsOf([dns("example.com", "AAAA", "timeout"), dns("example.com", "A", "ok", ["93.184.216.34"]), dns("example.com", "AAAA", "timeout")]));
    expect(evidence.filter((e) => e.feature === "dns.answer")).toEqual([{ feature: "dns.answer", value: "ok", primary: true, facts: ["f0", "f1", "f2"] }]);
    expect(valuesOf(readEvidence(factsOf([dns("example.com", "AAAA", "nodata")])).evidence, "dns.answer")).toEqual(["ok"]);
    expect(valuesOf(readEvidence(factsOf([dns("example.com", "A", "unreachable")])).evidence, "dns.answer")).toEqual(["unreachable"]);
  });

  it("gives dns.address for a public name only, and one private address decides", () => {
    const facts = factsOf([dns("example.com", "A", "ok", ["93.184.216.34"]), dns("example.com", "AAAA", "ok", ["fd00::5"]), dns("router.lan", "A", "ok", ["192.168.1.1"])]);
    expect(readEvidence(facts).evidence.filter((e) => e.feature === "dns.address")).toEqual([{ feature: "dns.address", value: "private", primary: true, facts: ["f0", "f1"] }]);
  });

  it("gives ip.family from the TCP connects to the addresses of each family", () => {
    const answers = [dns("example.com", "A", "ok", ["93.184.216.34"]), dns("example.com", "AAAA", "ok", ["2606:2800::1"])];
    const family = (...connects: Entry[]): string[] => valuesOf(readEvidence(factsOf([...answers, ...connects])).evidence, "ip.family");
    expect(family(tcp("93.184.216.34", 443, "connected"), tcp("2606:2800::1", 443, "timeout"))).toEqual(["ipv4-only"]);
    expect(family(tcp("93.184.216.34", 443, "connected"), tcp("2606:2800::1", 443, "connected"))).toEqual(["both"]);
    expect(family(tcp("93.184.216.34", 443, "refused"), tcp("2606:2800::1", 443, "connected"))).toEqual(["ipv6-only"]);
    expect(family(tcp("93.184.216.34", 443, "connected"))).toEqual([]);
    expect(family(tcp("93.184.216.34", 443, "timeout"), tcp("2606:2800::1", 443, "timeout"))).toEqual([]);
  });

  it("gives tcp.connect from the last fact, and tcp.time only for a connection", () => {
    const { evidence } = readEvidence(factsOf([tcp("192.0.2.1", 443, "timeout", 3000), tcp("192.0.2.1", 443, "connected", 40), tcp("192.0.2.1", 80, "refused", 1)]));
    expect(evidence.map(({ feature, value }) => `${feature}=${value}`)).toEqual(["tcp.connect=connected", "tcp.time=short", "tcp.connect=refused"]);
  });

  it("gives tls.ratio from the last TCP connect before the handshake", () => {
    const facts = factsOf([tcp("192.0.2.1", 443, "connected", 50), tcp("192.0.2.1", 443, "connected", 10), tls("192.0.2.1", "ok", 100, "public")]);
    const { evidence } = readEvidence(facts);
    expect(evidence.filter((e) => e.feature.startsWith("tls.")).map(({ feature, value }) => `${feature}=${value}`)).toEqual(["tls.handshake=ok", "tls.trust=public", "tls.ratio=high"]);
    expect(valuesOf(readEvidence(factsOf([tls("192.0.2.1", "ok", 100, "public")])).evidence, "tls.ratio")).toEqual([]);
  });

  it("counts a TCP time below 1 ms as 1 ms in a ratio", () => {
    expect(valuesOf(readEvidence(factsOf([tcp("127.0.0.1", 443, "connected", 0.01), tls("127.0.0.1", "ok", 2, "private")])).evidence, "tls.ratio")).toEqual(["low"]);
  });

  it("gives tls.trust private for a chain with no root of the store", () => {
    expect(valuesOf(readEvidence(factsOf([tls("192.0.2.1", "cert-error", 30, "none")])).evidence, "tls.trust")).toEqual(["private"]);
  });

  it("gives http.status and http.ttfb", () => {
    const status = (entry: Entry): string[] => valuesOf(readEvidence(factsOf([entry])).evidence, "http.status");
    expect([http("192.0.2.1", "response", 204), http("192.0.2.1", "response", 302), http("192.0.2.1", "response", 404), http("192.0.2.1", "response", 503)].map(status)).toEqual([
      ["ok"],
      ["ok"],
      ["client-error"],
      ["server-error"],
    ]);
    expect([http("192.0.2.1", "timeout"), http("192.0.2.1", "reset"), http("192.0.2.1", "protocol")].map(status)).toEqual([["none"], ["none"], ["none"]]);
    const { evidence } = readEvidence(factsOf([tcp("192.0.2.1", 443, "connected", 10), http("192.0.2.1", "response", 200, 250)]));
    expect(valuesOf(evidence, "http.ttfb")).toEqual(["high"]);
  });

  it("gives gateway.reply for the gateway and icmp.reply for each other address", () => {
    const facts = factsOf([echo("192.0.2.1", "reply"), echo("198.51.100.7", "none"), echo("203.0.113.9", "unreachable"), echo("::FFFF:192.0.2.1", "unreachable")]);
    const { evidence } = readEvidence(facts, { gateway: "192.0.2.1" });
    expect(evidence.map((e) => [e.feature, e.value, e.facts])).toEqual([
      ["gateway.reply", "none", ["f0", "f3"]],
      ["icmp.reply", "none", ["f1"]],
      ["icmp.reply", "unreachable", ["f2"]],
    ]);
    expect(valuesOf(readEvidence(facts).evidence, "icmp.reply")).toEqual(["unreachable", "none", "unreachable"]);
  });

  it("gives path.loss only for replies to LOSS_MIN_SENT requests or more", () => {
    const n = LOSS_MIN_SENT;
    const facts = factsOf([echo("192.0.2.1", "reply", n, n), echo("192.0.2.2", "reply", n, n - 1), echo("192.0.2.3", "reply", n, n - 2), echo("192.0.2.4", "reply", n - 1, 1), echo("192.0.2.5", "none", n)]);
    expect(valuesOf(readEvidence(facts).evidence, "path.loss")).toEqual(["none", "some", "high"]);
  });

  it("gives path.loss from the last hop of a report of mtr, and the last fact of ping or mtr decides", () => {
    const n = LOSS_MIN_SENT;
    expect(readEvidence(factsOf([report("192.0.2.1", "reached", n, n - 1)])).evidence).toEqual([{ feature: "path.loss", value: "some", primary: true, facts: ["f0"] }]);
    const both = readEvidence(factsOf([report("192.0.2.1", "reached", n, n), echo("192.0.2.1", "reply", n, n - 2)])).evidence;
    expect(both.filter((e) => e.feature === "path.loss")).toEqual([{ feature: "path.loss", value: "high", primary: true, facts: ["f0", "f1"] }]);
  });

  it("gives no evidence for a report that did not reach the address, a short report, or a trace", () => {
    const facts = factsOf([report("192.0.2.1", "stopped"), report("192.0.2.1", "error"), report("192.0.2.1", "reached", LOSS_MIN_SENT - 1), trace("192.0.2.1")]);
    const { evidence, skipped } = readEvidence(facts);
    expect(evidence).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      'The outcome "stopped" of path.report has no value of the feature path.loss.',
      'The outcome "error" of path.report has no value of the feature path.loss.',
      `The last hop of the report has ${LOSS_MIN_SENT - 1} probes. The feature path.loss needs ${LOSS_MIN_SENT} probes or more.`,
      "The catalog has no feature for the hops of a path. The lab runs fit such a feature later.",
    ]);
  });

  it("marks the facts of a reference host", () => {
    const facts = factsOf([tcp("192.0.2.1", 443, "connected"), tcp("198.51.100.1", 443, "connected")]);
    const { evidence } = readEvidence(facts, { primary: (fact) => (fact.value as TcpConnect).address === "192.0.2.1" });
    expect(evidence.filter((e) => e.feature === "tcp.connect").map((e) => e.primary)).toEqual([true, false]);
  });

  it("gives the reason for each fact that gives no evidence", () => {
    const facts = factsOf([
      [{ kind: "wifi.scan", layer: "wifi", summary: "", check: (_value: unknown): _value is unknown => true }, {}],
      [TCP_CONNECT, { address: "192.0.2.1", port: 0, family: 4, outcome: "connected", ms: 1 }],
      tcp("192.0.2.1", 443, "error"),
      dns("example.com", "A", "error"),
      tls("192.0.2.1", "not-tls", 3),
      tls("192.0.2.1", "closed", 3),
      http("192.0.2.1", "error"),
      http("192.0.2.1", "response", 101),
      [ICMP_ECHO, { address: "192.0.2.1", outcome: "error", sent: 0, received: 0, rttMs: [], detail: "spawn ping ENOENT" }],
    ]);
    const { evidence, skipped } = readEvidence(facts);
    expect(evidence).toEqual([]);
    expect(skipped.map((s) => s.fact)).toEqual(["f0", "f1", "f3", "f2", "f4", "f5", "f6", "f7", "f8"]);
    expect(skipped.find((s) => s.fact === "f8")?.reason).toBe('The outcome "error" of icmp.echo has no value of the feature icmp.reply.');
    expect(skipped[0]?.reason).toBe("netdiag has no reader for the kind wifi.scan.");
    expect(skipped[1]?.reason).toBe("The value does not pass the check of the kind tcp.connect.");
    expect(skipped.find((s) => s.fact === "f4")?.reason).toBe('The outcome "not-tls" of tls.handshake has no value of the feature tls.handshake.');
    expect(skipped.find((s) => s.fact === "f7")?.reason).toBe('The outcome "response 101" of http.response has no value of the feature http.status.');
  });
});

describe("the readers and the model", () => {
  const top = (entries: readonly Entry[], primary?: (fact: Fact) => boolean): string | undefined =>
    diagnose(STANDARD_CATALOG, readEvidence(factsOf(entries), { primary }).evidence).causes[0]?.id;

  it("names the cause of each typical case", () => {
    expect(top([dns("example.com", "A", "unreachable")])).toBe("resolver.down");
    expect(top([dns("example.com", "A", "nxdomain")])).toBe("name.missing");
    expect(top([dns("example.com", "A", "ok", ["93.184.216.34"]), tcp("93.184.216.34", 443, "refused", 20)])).toBe("port.closed");
    expect(top([dns("example.com", "A", "ok", ["93.184.216.34"]), tcp("93.184.216.34", 443, "connected", 20), tls("93.184.216.34", "cert-error", 40, "public")])).toBe("tls.cert-invalid");
    expect(top([dns("example.com", "A", "ok", ["93.184.216.34"]), tcp("93.184.216.34", 443, "connected", 20), tls("93.184.216.34", "ok", 40, "public"), http("93.184.216.34", "response", 503, 30)])).toBe(
      "server.error",
    );
  });

  it("names a silent resolver, not a down interface, when the gateway replies", () => {
    const gateway = "192.0.2.254";
    const cause = (entries: readonly Entry[]): string | undefined => diagnose(STANDARD_CATALOG, readEvidence(factsOf(entries), { gateway }).evidence).causes[0]?.id;
    expect(cause([dns("example.com", "A", "timeout")])).not.toBe("resolver.down");
    expect(cause([dns("example.com", "A", "timeout"), echo(gateway, "reply")])).toBe("resolver.down");
    expect(cause([dns("example.com", "A", "timeout"), echo(gateway, "none")])).toMatch(/^(interface|gateway)\.down$/);
  });

  it("names a captive portal: a private address and a certificate with no root of the store", () => {
    expect(top([dns("example.com", "A", "ok", ["10.0.0.5"]), tcp("10.0.0.5", 443, "connected", 5), tls("10.0.0.5", "cert-error", 12, "none")])).toBe("captive.portal");
  });

  it("names a TLS proxy from the target and a reference host", () => {
    const entries = [tcp("93.184.216.34", 443, "connected", 5), tls("93.184.216.34", "ok", 80, "private"), tcp("198.51.100.7", 443, "connected", 6), tls("198.51.100.7", "ok", 90, "private")];
    expect(top(entries, (fact) => (fact.value as { address: string }).address === "93.184.216.34")).toBe("tls.proxy");
  });
});

describe("a property of the readers", () => {
  const address = fc.constantFrom("93.184.216.34", "10.0.0.1", "2606:2800::1", "fd00::1");
  const ms = fc.double({ min: 0, max: 5000, noNaN: true });
  const dnsEntry = fc
    .record({ name: fc.constantFrom("example.com", "router.lan"), record: fc.constantFrom("A" as const, "AAAA" as const), outcome: fc.constantFrom(...DNS_OUTCOMES), ms })
    .map(({ name, record, outcome, ms: time }): Entry => {
      const addresses = outcome !== "ok" ? [] : record === "A" ? ["93.184.216.34", "10.0.0.1"] : ["2606:2800::1"];
      return [DNS_ANSWER, { name, record, resolver: RESOLVER, outcome, addresses, ms: time }, 1];
    });
  const tcpEntry = fc.record({ address, port: fc.constantFrom(80, 443), outcome: fc.constantFrom(...CONNECT_OUTCOMES), ms }).map(
    (v): Entry => [TCP_CONNECT, { ...v, family: v.address.includes(":") ? 6 : 4 }, Math.max(v.ms, 0.001)],
  );
  const tlsEntry = fc.record({ address, outcome: fc.constantFrom(...HANDSHAKE_OUTCOMES), ms, trust: fc.option(fc.constantFrom(...TRUSTS), { nil: undefined }) }).map(
    ({ trust, ...v }): Entry => [TLS_HANDSHAKE, { ...v, port: 443, ...(trust === undefined ? {} : { certificate: certificate(trust) }) }, 1],
  );
  const icmpEntry = fc
    .record({ address, outcome: fc.constantFrom(...ECHO_OUTCOMES), sent: fc.integer({ min: 1, max: 40 }), share: fc.double({ min: 0, max: 1, noNaN: true }) })
    .map(({ address: a, outcome, sent, share }) => echo(a, outcome, outcome === "error" ? 0 : sent, outcome === "reply" ? Math.max(1, Math.round(share * sent)) : 0));
  const reportEntry = fc
    .record({ address, outcome: fc.constantFrom("reached" as const, "stopped" as const, "error" as const), sent: fc.integer({ min: 1, max: 40 }), share: fc.double({ min: 0, max: 1, noNaN: true }) })
    .map(({ address: a, outcome, sent, share }) => report(a, outcome, sent, Math.max(1, Math.round(share * sent))));
  const traceEntry = address.map((a) => trace(a));
  const httpEntry = fc
    .record({ address, outcome: fc.constantFrom(...HTTP_OUTCOMES), status: fc.constantFrom(101, 200, 302, 404, 503), ttfb: fc.option(ms, { nil: undefined }) })
    .map(({ address: a, outcome, status, ttfb }) => http(a, outcome, outcome === "response" ? status : undefined, outcome === "response" ? ttfb : undefined));

  it("gives only evidence that the model uses, and accounts for each fact", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(dnsEntry, tcpEntry, tlsEntry, httpEntry, icmpEntry, reportEntry, traceEntry), { maxLength: 24 }), fc.boolean(), fc.option(address, { nil: undefined }), (entries, split, gateway) => {
        const facts = factsOf(entries);
        for (const fact of facts) expect([DNS_ANSWER, TCP_CONNECT, TLS_HANDSHAKE, HTTP_RESPONSE, ICMP_ECHO, PATH_REPORT, PATH_TRACE].find((k) => k.kind === fact.kind)?.check(fact.value)).toBe(true);
        const reading = readEvidence(facts, { ...(split ? { primary: (fact: Fact) => Number(fact.id.slice(1)) % 2 === 0 } : {}), gateway });
        expect(diagnose(STANDARD_CATALOG, reading.evidence).ignored).toEqual([]);
        const seen = new Set([...reading.evidence.flatMap((e) => e.facts ?? []), ...reading.skipped.map((s) => s.fact)]);
        expect([...seen].sort()).toEqual(facts.map((f) => f.id).sort());
        const keys = reading.evidence.map((e) => `${e.feature}|${String(e.primary)}|${(e.facts ?? []).join(",")}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { seed: 20261115, numRuns: 300 },
    );
  });
});
