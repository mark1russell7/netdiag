import { fakeClock } from "@mark1russell7/algebra/clock";
import { startDnsServer, type DnsServer } from "@netdiag/fixtures";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { PATH_ORIGIN, addressBytes, createRunner, isFactOf, scopeOf, type Fact, type Grant, type PathOrigin, type Runner } from "../index.ts";
import { nodeResolveTxt } from "../probes/native.ts";
import { CYMRU_ZONES, originQuery, readOrigin } from "./cymru.ts";
import { ORIGIN_CONCURRENCY, originProbe, type OriginInput, type TxtAnswer, type TxtQuery, type TxtResolve } from "./origin.ts";

// The probe of the origins on a fake port. Each answer of Team Cymru is a fixture of this file, so the tests send no
// query to the internet. The port over `node:dns` gets its answers from a DNS server of the fixtures on the loopback address.

const RESOLVER = "192.0.2.53";

const ok = (...records: string[][]): TxtAnswer => ({ outcome: "ok", records });

/** The answers of the fake port, by name. An error is a resolver with no answer: the port throws it. */
const ANSWERS: Readonly<Record<string, TxtAnswer | Error>> = {
  "31.108.90.216.origin.asn.cymru.com": ok(["23028 | 216.90.108.0/24 | US | arin | 1998-09-25"]),
  "8.8.8.8.origin.asn.cymru.com": ok(["15169 | 8.8.8.0/24 | US | arin | 2023-12-28"]),
  "8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.origin6.asn.cymru.com": ok(["15169 | 2001:4860::/32 | US | arin | 2005-03-14"]),
  "1.1.1.1.origin.asn.cymru.com": { outcome: "servfail", records: [], code: "ESERVFAIL" },
  "1.0.0.1.origin.asn.cymru.com": new Error("The resolver gave no answer."),
  "4.4.8.8.origin.asn.cymru.com": ok(["not a record"]),
};

/**
 * This function makes a fake port. It keeps each query and the largest number of open queries. It gives the answer of
 * `answers`, else NXDOMAIN.
 */
function fakePort(answers: Readonly<Record<string, TxtAnswer | Error>> = ANSWERS): { readonly resolve: TxtResolve; readonly queries: TxtQuery[]; readonly peak: () => number } {
  const queries: TxtQuery[] = [];
  let open = 0;
  let peak = 0;
  const resolve: TxtResolve = async (query) => {
    queries.push(query);
    open += 1;
    peak = Math.max(peak, open);
    for (let tick = 0; tick < 3; tick += 1) await Promise.resolve();
    open -= 1;
    const answer = answers[query.name];
    if (answer instanceof Error) throw answer;
    return answer ?? { outcome: "nxdomain", records: [], code: "ENOTFOUND" };
  };
  return { resolve, queries, peak: () => peak };
}

const ZONE_GRANTS: readonly Grant[] = Object.values(CYMRU_ZONES).map((host): Grant => ({ kind: "host", host, basis: "named", note: "the user allowed the lookups of the origins" }));

const GRANTS: readonly Grant[] = [{ kind: "range", cidr: `${RESOLVER}/32`, basis: "named", note: "the resolver" }, ...ZONE_GRANTS];

function runnerWith(grants: readonly Grant[] = GRANTS): Runner {
  const scope = scopeOf(grants);
  if (scope.tag === "err") throw new Error(scope.error.join(" "));
  return createRunner({ scope: scope.value, clock: fakeClock(0) });
}

function originsOf(facts: readonly Fact[]): PathOrigin[] {
  return facts.flatMap((fact) => (isFactOf(PATH_ORIGIN, fact) ? [fact.value] : []));
}

describe("the names of the queries of Team Cymru", () => {
  it("puts the parts of an IPv4 address in the reverse order under origin.asn.cymru.com, also for a mapped address", () => {
    expect(originQuery("216.90.108.31")).toBe("31.108.90.216.origin.asn.cymru.com");
    expect(originQuery(" ::FFFF:216.90.108.31 ")).toBe("31.108.90.216.origin.asn.cymru.com");
  });

  it("puts the 32 digits of the full IPv6 address in the reverse order under origin6.asn.cymru.com", () => {
    const google = "8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.origin6.asn.cymru.com";
    expect(originQuery("2001:4860:4860::8888")).toBe(google);
    expect(originQuery("2001:4860:4860:0:0:0:0:8888")).toBe(google);
    expect(originQuery("[2001:4860:4860:0000::8888]")).toBe(google);
    expect(originQuery("2001:db8::1")).toBe("1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.origin6.asn.cymru.com");
    expect(originQuery("::1")).toBe(`1${".0".repeat(31)}.origin6.asn.cymru.com`);
  });

  it("gives the bytes of the address again from the digits of an IPv6 name", () => {
    fc.assert(
      fc.property(fc.ipV6(), (address) => {
        const name = originQuery(address);
        if (name.endsWith(CYMRU_ZONES.ipv4)) return;
        const digits = name.slice(0, -CYMRU_ZONES.ipv6.length - 1).split(".").reverse();
        expect(digits).toHaveLength(32);
        const bytes = Array.from({ length: 16 }, (_, index) => Number.parseInt(`${digits[index * 2] ?? ""}${digits[index * 2 + 1] ?? ""}`, 16));
        expect(bytes).toEqual(addressBytes(address));
      }),
    );
  });

  it("refuses a text that is not an IP address", () => {
    expect(() => originQuery("example.com")).toThrow(RangeError);
  });
});

describe("the TXT answer of Team Cymru", () => {
  it("reads one AS number, the prefix, the country, the registry and the date", () => {
    expect(readOrigin([["23028 | 216.90.108.0/24 | US | arin | 1998-09-25"]], "216.90.108.31")).toEqual({
      tag: "ok",
      value: { originAs: [23028], prefix: "216.90.108.0/24", country: "US", registry: "arin", allocated: "1998-09-25" },
    });
  });

  it("reads two or more AS numbers, extra spaces and the strings of one record", () => {
    expect(readOrigin([["13335 209242 | 104.16.0.0/13 | US | arin | 2014-03-28"]], "104.16.1.1")).toMatchObject({ tag: "ok", value: { originAs: [13335, 209242] } });
    expect(readOrigin([["  23028   |216.90.108.0/24|US |  arin|1998-09-25 "]], "216.90.108.31")).toMatchObject({ tag: "ok", value: { originAs: [23028], prefix: "216.90.108.0/24", registry: "arin" } });
    expect(readOrigin([["23028 | 216.90.108.0/24 ", "| US | arin | 1998-09-25"]], "216.90.108.31")).toMatchObject({ tag: "ok", value: { country: "US", allocated: "1998-09-25" } });
    expect(readOrigin([["64500 | 8.8.8.0/24 | | | "]], "8.8.8.8")).toEqual({ tag: "ok", value: { originAs: [64500], prefix: "8.8.8.0/24" } });
  });

  it("takes the record with the longest prefix of two TXT records, and joins the AS numbers of that prefix", () => {
    const records = [["16509 | 52.94.0.0/16 | US | arin | 2011-05-10"], ["16509 14618 | 52.94.0.0/22 | US | arin | 2011-05-10"], ["64500 | 52.94.0.0/22 | US | arin | 2011-05-10"]];
    expect(readOrigin(records, "52.94.1.1")).toMatchObject({ tag: "ok", value: { originAs: [16509, 14618, 64500], prefix: "52.94.0.0/22" } });
  });

  it("refuses an answer with no record, and each malformed record with a clear reason", () => {
    expect(readOrigin([], "8.8.8.8")).toEqual({ tag: "err", error: "The answer has no TXT record." });
    expect(readOrigin([["not a record"]], "8.8.8.8")).toEqual({ tag: "err", error: 'The TXT record "not a record" does not have 5 fields separated by "|".' });
    expect(readOrigin([["NA | 8.8.8.0/24 | US | arin | 2000-01-01"]], "8.8.8.8")).toEqual({
      tag: "err",
      error: 'The TXT record "NA | 8.8.8.0/24 | US | arin | 2000-01-01" has no list of AS numbers from 1 to 4294967295.',
    });
    expect(readOrigin([["0 | 8.8.8.0/24 | US | arin | 2000-01-01"]], "8.8.8.8").tag).toBe("err");
    expect(readOrigin([["4294967296 | 8.8.8.0/24 | US | arin | 2000-01-01"]], "8.8.8.8").tag).toBe("err");
    expect(readOrigin([["64500 | 8.8.8.0 | US | arin | 2000-01-01"]], "8.8.8.8")).toMatchObject({ tag: "err", error: expect.stringContaining("has no BGP prefix") });
    expect(readOrigin([["64500 | 9.9.9.0/24 | US | arin | 2000-01-01"]], "8.8.8.8")).toEqual({ tag: "err", error: "The prefix 9.9.9.0/24 of the TXT record does not hold 8.8.8.8." });
    expect(readOrigin([["64500 | 8.8.8.0/24 | USA | arin | 2000-01-01"]], "8.8.8.8")).toMatchObject({ tag: "err", error: expect.stringContaining("country code") });
    expect(readOrigin([["64500 | 8.8.8.0/24 | US | ARIN! | 2000-01-01"]], "8.8.8.8")).toMatchObject({ tag: "err", error: expect.stringContaining("registry") });
    expect(readOrigin([["64500 | 8.8.8.0/24 | US | arin | 2000/01/01"]], "8.8.8.8")).toMatchObject({ tag: "err", error: expect.stringContaining("YYYY-MM-DD") });
    expect(readOrigin([["64500 | 8.8.8.0/24 | US | arin | 2000-01-01"], ["bad"]], "8.8.8.8").tag).toBe("err");
    expect(readOrigin([["64500 | 8.8.8.0/24 | US | arin | 2000-01-01"]], "example.com").tag).toBe("err");
  });

  it("reads each record that it makes from an address and AS numbers", () => {
    fc.assert(
      fc.property(fc.ipV4(), fc.uniqueArray(fc.integer({ min: 1, max: 4_294_967_295 }), { minLength: 1, maxLength: 4 }), (address, numbers) => {
        const prefix = `${address.split(".").slice(0, 3).join(".")}.0/24`;
        const read = readOrigin([[`${numbers.join(" ")} | ${prefix} | ZZ | ripencc | 2001-02-03`]], address);
        expect(read).toEqual({ tag: "ok", value: { originAs: numbers, prefix, country: "ZZ", registry: "ripencc", allocated: "2001-02-03" } });
      }),
    );
  });
});

describe("the probe of the origins", () => {
  const INPUT: OriginInput = {
    addresses: ["10.0.0.1", "216.90.108.31", "8.8.8.8", "::ffff:216.90.108.31", "2001:4860:4860::8888", "198.51.100.7", "9.9.9.9", "1.1.1.1", "1.0.0.1", "8.8.4.4"],
    resolver: RESOLVER,
  };

  it("gives one fact for each different address, and sends one query for each public address", async () => {
    const port = fakePort();
    const outcome = await runnerWith().run(originProbe(port.resolve), INPUT);
    if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
    const origins = originsOf(outcome.facts);
    expect(origins.map((origin) => [origin.address, origin.outcome])).toEqual([
      ["10.0.0.1", "special"],
      ["216.90.108.31", "found"],
      ["8.8.8.8", "found"],
      ["2001:4860:4860::8888", "found"],
      ["198.51.100.7", "special"],
      ["9.9.9.9", "unrouted"],
      ["1.1.1.1", "failed"],
      ["1.0.0.1", "failed"],
      ["8.8.4.4", "failed"],
    ]);
    expect(origins[0]).toEqual({ address: "10.0.0.1", outcome: "special", class: "private" });
    expect(origins[1]).toEqual({ address: "216.90.108.31", outcome: "found", originAs: [23028], prefix: "216.90.108.0/24", country: "US", registry: "arin", allocated: "1998-09-25" });
    expect(origins[3]).toMatchObject({ originAs: [15169], prefix: "2001:4860::/32" });
    expect(origins[4]).toEqual({ address: "198.51.100.7", outcome: "special", class: "documentation" });
    expect(origins[5]).toEqual({ address: "9.9.9.9", outcome: "unrouted" });
    expect(origins.slice(6).map((origin) => origin.detail)).toEqual([
      "The query 1.1.1.1.origin.asn.cymru.com gave the outcome servfail (ESERVFAIL).",
      "The resolver gave no answer.",
      'The TXT record "not a record" does not have 5 fields separated by "|".',
    ]);
    expect(port.queries.map((query) => query.name)).toEqual([
      "31.108.90.216.origin.asn.cymru.com",
      "8.8.8.8.origin.asn.cymru.com",
      "8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.origin6.asn.cymru.com",
      "9.9.9.9.origin.asn.cymru.com",
      "1.1.1.1.origin.asn.cymru.com",
      "1.0.0.1.origin.asn.cymru.com",
      "4.4.8.8.origin.asn.cymru.com",
    ]);
    expect(port.queries[0]).toEqual({ name: "31.108.90.216.origin.asn.cymru.com", resolver: RESOLVER, port: 53, timeoutMs: 5000 });
    expect(port.peak()).toBe(ORIGIN_CONCURRENCY);
    expect(outcome.raw.resolver).toBe(`${RESOLVER}:53`);
  });

  it("gives the same facts again from the raw output, with no query", async () => {
    const probe = originProbe(fakePort().resolve);
    const outcome = await runnerWith().run(probe, INPUT);
    if (outcome.status !== "done") throw new Error(outcome.status);
    expect(probe.parse(JSON.parse(JSON.stringify(outcome.raw)) as typeof outcome.raw, INPUT).map((observation) => observation.value)).toEqual(originsOf(outcome.facts));
  });

  it("gives the outcome failed for a public address with no lookup in the raw output, and for an answer that is too long", async () => {
    const probe = originProbe(fakePort().resolve);
    expect(probe.parse({ resolver: `${RESOLVER}:53`, lookups: [] }, { addresses: ["8.8.8.8"], resolver: RESOLVER }).map((observation) => observation.value)).toEqual([
      { address: "8.8.8.8", outcome: "failed", detail: "The probe did not look up 8.8.8.8." },
    ]);
    const long = fakePort({ "8.8.8.8.origin.asn.cymru.com": ok(["x".repeat(5000)]) });
    const outcome = await runnerWith().run(originProbe(long.resolve), { addresses: ["8.8.8.8"], resolver: RESOLVER });
    if (outcome.status !== "done") throw new Error(outcome.status);
    expect(originsOf(outcome.facts)[0]).toEqual({ address: "8.8.8.8", outcome: "failed", detail: "The answer has 5000 code units, more than the limit of 4096." });
  });

  it("names the resolver and the zone of each family of the public addresses as peers", async () => {
    const withoutIpv4 = await runnerWith(GRANTS.filter((grant) => grant.kind !== "host" || grant.host !== CYMRU_ZONES.ipv4)).run(originProbe(fakePort().resolve), INPUT);
    expect(withoutIpv4).toMatchObject({ status: "refused", peer: { host: CYMRU_ZONES.ipv4 } });
    const ipv4Only = await runnerWith(GRANTS.filter((grant) => grant.kind !== "host" || grant.host !== CYMRU_ZONES.ipv6)).run(originProbe(fakePort().resolve), { addresses: ["8.8.8.8"], resolver: RESOLVER });
    expect(ipv4Only.status).toBe("done");
    const noResolver = await runnerWith(ZONE_GRANTS).run(originProbe(fakePort().resolve), INPUT);
    expect(noResolver).toMatchObject({ status: "refused", peer: { host: RESOLVER, port: 53 } });
    const port = fakePort();
    const special = await runnerWith([GRANTS[0] as Grant]).run(originProbe(port.resolve), { addresses: ["10.0.0.1", "fe80::1"], resolver: RESOLVER, port: 5353 });
    expect(special.status === "done" && originsOf(special.facts).map((origin) => origin.class)).toEqual(["private", "link-local"]);
    expect(port.queries).toEqual([]);
  });

  it("refuses an input with an address that is not an IP address, a bad resolver, a bad time limit or too many addresses", async () => {
    const run = (input: OriginInput) => runnerWith().run(originProbe(fakePort().resolve), input);
    expect(await run({ addresses: ["8.8.8.8", "example.com"], resolver: RESOLVER })).toEqual({ status: "failed", stage: "probe", error: '"example.com" is not an IP address.' });
    expect(await run({ addresses: ["8.8.8.8"], resolver: "dns.example" })).toEqual({ status: "failed", stage: "probe", error: '"dns.example" is not an IP address of a resolver.' });
    expect((await run({ addresses: ["8.8.8.8"], resolver: RESOLVER, port: 0 })).status).toBe("failed");
    expect((await run({ addresses: ["8.8.8.8"], resolver: RESOLVER, timeoutMs: 0 })).status).toBe("failed");
    expect((await run({ addresses: Array.from({ length: 65 }, (_, index) => `8.8.${index}.1`), resolver: RESOLVER })).status).toBe("failed");
  });

  it("gives a fact that passes the check of its kind for each answer of a resolver", async () => {
    const outcomes = fc.constantFrom<TxtAnswer["outcome"]>("ok", "nxdomain", "nodata", "servfail", "refused", "timeout", "unreachable", "error");
    const record = fc.oneof(fc.constant(["15169 | 8.8.8.0/24 | US | arin | 2023-12-28"]), fc.array(fc.string({ maxLength: 60 }), { maxLength: 3 }));
    await fc.assert(
      fc.asyncProperty(outcomes, fc.array(record, { maxLength: 3 }), async (outcome, records) => {
        const port = fakePort({ "8.8.8.8.origin.asn.cymru.com": { outcome, records } });
        const run = await runnerWith().run(originProbe(port.resolve), { addresses: ["8.8.8.8", "10.0.0.1"], resolver: RESOLVER });
        expect(run.status).toBe("done");
        for (const origin of run.status === "done" ? originsOf(run.facts) : []) expect(PATH_ORIGIN.check(origin)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it("stops at the signal, and gives no fact", async () => {
    const controller = new AbortController();
    const resolve: TxtResolve = (_query, signal) => {
      controller.abort(new Error("The user stopped the check."));
      return Promise.reject(signal.reason as Error);
    };
    const outcome = await runnerWith().run(originProbe(resolve), { addresses: ["8.8.8.8"], resolver: RESOLVER }, controller.signal);
    expect(outcome).toEqual({ status: "aborted", reason: "The user stopped the check." });
  });
});

describe("the fact kind path.origin", () => {
  it("refuses a value with the fields of another outcome", () => {
    expect(PATH_ORIGIN.check({ address: "8.8.8.8", outcome: "found", originAs: [15169], prefix: "8.8.8.0/24" })).toBe(true);
    expect(PATH_ORIGIN.check({ address: "8.8.8.8", outcome: "found", originAs: [15169] })).toBe(false);
    expect(PATH_ORIGIN.check({ address: "8.8.8.8", outcome: "found", originAs: [], prefix: "8.8.8.0/24" })).toBe(false);
    expect(PATH_ORIGIN.check({ address: "8.8.8.8", outcome: "found", originAs: [0], prefix: "8.8.8.0/24" })).toBe(false);
    expect(PATH_ORIGIN.check({ address: "8.8.8.8", outcome: "unrouted", prefix: "8.8.8.0/24" })).toBe(false);
    expect(PATH_ORIGIN.check({ address: "10.0.0.1", outcome: "special" })).toBe(false);
    expect(PATH_ORIGIN.check({ address: "10.0.0.1", outcome: "lost" })).toBe(false);
  });
});

describe("the port of TXT queries over node:dns", () => {
  const LOCAL = "127.0.0.1";
  const servers: DnsServer[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
  });

  async function server(): Promise<DnsServer> {
    const started = await startDnsServer({
      host: LOCAL,
      zone: {
        "31.108.90.216.origin.asn.cymru.com": { rcode: 0, txt: [["23028 | 216.90.108.0/24 | US | arin | 1998-09-25"]] },
        "empty.example": { rcode: 0 },
        "fail.example": { rcode: 2 },
        "silent.example": "silent",
      },
    });
    servers.push(started);
    return started;
  }

  it("gives the records, and each failure of a query as an outcome", async () => {
    const { port } = await server();
    const query = (name: string): Promise<TxtAnswer> => nodeResolveTxt({ name, resolver: LOCAL, port, timeoutMs: 1000 }, new AbortController().signal);
    expect(await query("31.108.90.216.origin.asn.cymru.com")).toEqual(ok(["23028 | 216.90.108.0/24 | US | arin | 1998-09-25"]));
    expect(await query("missing.example")).toEqual({ outcome: "nxdomain", records: [], code: "ENOTFOUND" });
    expect(await query("empty.example")).toEqual({ outcome: "nodata", records: [], code: "ENODATA" });
    expect(await query("fail.example")).toMatchObject({ outcome: "servfail", records: [] });
  });

  it("throws the reason of the signal when the signal stops the query", async () => {
    const { port, asked } = await server();
    const controller = new AbortController();
    const pending = nodeResolveTxt({ name: "silent.example", resolver: LOCAL, port, timeoutMs: 60_000 }, controller.signal);
    while (!asked.includes("silent.example")) await new Promise((resolve) => setImmediate(resolve));
    controller.abort(new Error("The user stopped the check."));
    await expect(pending).rejects.toThrow("The user stopped the check.");
  });

  it("gives a fact found through the probe and a resolver on the loopback address", async () => {
    const { port } = await server();
    const grants: Grant[] = [{ kind: "range", cidr: `${LOCAL}/32`, basis: "named" }, ...ZONE_GRANTS];
    const outcome = await runnerWith(grants).run(originProbe(nodeResolveTxt), { addresses: ["216.90.108.31"], resolver: LOCAL, port, timeoutMs: 1000 });
    if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
    expect(originsOf(outcome.facts)).toEqual([{ address: "216.90.108.31", outcome: "found", originAs: [23028], prefix: "216.90.108.0/24", country: "US", registry: "arin", allocated: "1998-09-25" }]);
  });
});
