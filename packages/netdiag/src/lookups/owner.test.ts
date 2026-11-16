import { fakeClock } from "@mark1russell7/algebra/clock";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PATH_OWNER, cidrContains, createRunner, isFactOf, scopeOf, type Fact, type Grant, type PathOwner, type Runner } from "../index.ts";
import { ownerProbe, type OwnerInput, type RdapGet, type RdapReply, type RdapRequest } from "./owner.ts";
import { RDAP_BOOTSTRAP, RDAP_REGISTRIES, networkQuery, readBootstrap, readNetwork, secureBase, serviceFor } from "./rdap.ts";

// The probe of the owners on a fake port. Each answer of a registry is a fixture of this file, so the tests send no request.

const IPV4 = JSON.stringify({
  version: "1.0",
  publication: "2026-11-03T22:00:01Z",
  services: [
    [["8.0.0.0/8"], ["http://rdap.arin.net/registry", "https://rdap.arin.net/registry"]],
    [["193.0.0.0/8"], ["https://rdap.db.ripe.net/"]],
    [["1.0.0.0/8"], ["https://rdap.apnic.net/"]],
    [["1.1.0.0/16"], ["https://rdap.example.net/"]],
    [["45.0.0.0/8"], ["http://rdap.lacnic.net/rdap/"]],
    [["41.0.0.0/8"], ["https://rdap.afrinic.net/rdap/"]],
  ],
});

const IPV6 = JSON.stringify({ version: "1.0", services: [[["2001:4860::/32"], ["https://rdap.arin.net/registry/"]]] });

/** An RDAP object of a network of ARIN, with the extensions `cidr0` and `arin_originas0`. */
const ARIN_NETWORK = JSON.stringify({
  objectClassName: "ip network",
  handle: "NET-8-8-8-0-2",
  startAddress: "8.8.8.0",
  endAddress: "8.8.8.255",
  name: "EXAMPLE-8",
  cidr0_cidrs: [{ v4prefix: "8.8.8.0", length: 24 }],
  arin_originas0_originautnums: [64500, 64500, 0],
  remarks: [{ title: "Registration Comments", description: ["Not a description."] }],
  entities: [
    { objectClassName: "entity", handle: "ABUSE-1", roles: ["abuse"], vcardArray: ["vcard", [["fn", {}, "text", "Abuse desk"]]] },
    { objectClassName: "entity", handle: "EX-1", roles: ["registrant"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example\u0007 Networks\n Inc."]]] },
  ],
});

/** An RDAP object of a network of RIPE NCC: the `descr` is a remark with no title, and the registrant is one level down. */
const RIPE_NETWORK = JSON.stringify({
  objectClassName: "ip network",
  handle: "193.0.0.0 - 193.0.7.255",
  startAddress: "193.0.0.0",
  endAddress: "193.0.7.255",
  name: "EXAMPLE-NET",
  country: "nl",
  remarks: [{ description: ["", "Example network of a test"] }],
  entities: [{ roles: ["administrative"], entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Example NCC"]]] }] }],
});

const IPV6_NETWORK = JSON.stringify({
  objectClassName: "ip network",
  handle: "NET6-2001-4860-1",
  startAddress: "2001:4860::",
  endAddress: "2001:4860:ffff:ffff:ffff:ffff:ffff:ffff",
  cidr0_cidrs: [{ v6prefix: "2001:4860::", length: 32 }],
});

const json = (body: string): RdapReply => ({ status: 200, headers: { "content-type": "application/rdap+json" }, body });

/** The answers of the fake port, by URL. An error is a registry with no answer: the port throws it. */
const ANSWERS: Readonly<Record<string, RdapReply | Error>> = {
  [RDAP_BOOTSTRAP.ipv4]: json(IPV4),
  [RDAP_BOOTSTRAP.ipv6]: json(IPV6),
  "https://rdap.arin.net/registry/ip/8.8.8.8": json(ARIN_NETWORK),
  "https://rdap.db.ripe.net/ip/193.0.6.139": json(RIPE_NETWORK),
  "https://rdap.apnic.net/ip/1.0.0.1": { status: 404, headers: {}, body: '{"errorCode":404}' },
  "https://rdap.arin.net/registry/ip/2001:4860:4860::8888": json(IPV6_NETWORK),
  "https://rdap.arin.net/registry/ip/8.8.4.4": { status: 301, headers: { Location: "https://rdap.db.ripe.net/ip/8.8.4.4" }, body: "" },
  "https://rdap.db.ripe.net/ip/8.8.4.4": json(ARIN_NETWORK),
  "https://rdap.arin.net/registry/ip/8.1.1.1": { status: 302, headers: { location: "https://rdap.example.net/ip/8.1.1.1" }, body: "" },
  "https://rdap.arin.net/registry/ip/8.2.2.2": { status: 307, headers: { location: "/registry/ip/8.2.2.2" }, body: "" },
  "https://rdap.arin.net/registry/ip/8.3.3.3": new Error("rdap.arin.net gave no answer: connection reset"),
  "https://rdap.afrinic.net/rdap/ip/41.0.0.1": { status: 503, headers: {}, body: "" },
  "https://rdap.db.ripe.net/ip/193.0.0.1": json('{"objectClassName":"entity","handle":"X"}'),
};

/** This function makes a fake port. It keeps each request, and it gives the answer of `ANSWERS`, else a 404. */
function fakePort(answers: Readonly<Record<string, RdapReply | Error>> = ANSWERS): { readonly get: RdapGet; readonly requests: RdapRequest[] } {
  const requests: RdapRequest[] = [];
  const get: RdapGet = (request) => {
    requests.push(request);
    const answer = answers[request.url];
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer ?? { status: 404, headers: {}, body: "" });
  };
  return { get, requests };
}

const GRANTS: readonly Grant[] = ["data.iana.org", ...RDAP_REGISTRIES].map((host) => ({ kind: "host", host, basis: "named", note: "the user allowed the lookups of the owners" }));

function runnerWith(grants: readonly Grant[] = GRANTS): Runner {
  const scope = scopeOf(grants);
  if (scope.tag === "err") throw new Error(scope.error.join(" "));
  return createRunner({ scope: scope.value, clock: fakeClock(0) });
}

function ownersOf(facts: readonly Fact[]): PathOwner[] {
  return facts.flatMap((fact) => (isFactOf(PATH_OWNER, fact) ? [fact.value] : []));
}

describe("the RDAP data", () => {
  it("reads a bootstrap of IANA, and gives the service of the longest range that holds an address", () => {
    const read = readBootstrap(IPV4, "ipv4");
    if (read.tag === "err") throw new Error(read.error);
    expect(read.value.publication).toBe("2026-11-03T22:00:01Z");
    expect(serviceFor(read.value, "1.1.1.1")?.urls).toEqual(["https://rdap.example.net/"]);
    expect(serviceFor(read.value, "1.2.3.4")?.urls).toEqual(["https://rdap.apnic.net/"]);
    expect(serviceFor(read.value, "9.9.9.9")).toBeUndefined();
    const arin = serviceFor(read.value, "8.8.8.8");
    expect(arin === undefined ? undefined : secureBase(arin)?.href).toBe("https://rdap.arin.net/registry");
  });

  it("refuses a bootstrap that is not a list of pairs, or that has a range of the other family", () => {
    expect(readBootstrap("not json", "ipv4").tag).toBe("err");
    expect(readBootstrap('{"services":[["8.0.0.0/8"]]}', "ipv4").tag).toBe("err");
    expect(readBootstrap(IPV6, "ipv4")).toEqual({ tag: "err", error: 'The bootstrap of IPv4 has the range "2001:4860::/32", which is not an IPv4 range.' });
  });

  it("puts the query of an address under the path of the base URL, with or without a slash at its end", () => {
    expect(networkQuery(new URL("https://rdap.arin.net/registry"), "8.8.8.8").href).toBe("https://rdap.arin.net/registry/ip/8.8.8.8");
    expect(networkQuery(new URL("https://rdap.lacnic.net/rdap/"), "[2001:DB8::1]").href).toBe("https://rdap.lacnic.net/rdap/ip/2001:db8::1");
  });

  it("reads a network of ARIN: the registrant, the cidr0 ranges and the origin AS numbers, with no control characters", () => {
    expect(readNetwork(ARIN_NETWORK)).toEqual({
      tag: "ok",
      value: {
        handle: "NET-8-8-8-0-2",
        name: "EXAMPLE-8",
        start: "8.8.8.0",
        end: "8.8.8.255",
        cidrs: ["8.8.8.0/24"],
        holder: "Example Networks Inc.",
        description: undefined,
        country: undefined,
        originAs: [64500],
      },
    });
  });

  it("reads a network of RIPE NCC: the description with no title, the country, and a registrant one level down", () => {
    const read = readNetwork(RIPE_NETWORK);
    expect(read.tag === "ok" && read.value).toMatchObject({ holder: "Example NCC", description: "Example network of a test", country: "NL", cidrs: [], originAs: [] });
  });

  it("refuses a body that is not an RDAP network, and cuts a long text of a registry", () => {
    expect(readNetwork("[]")).toEqual({ tag: "err", error: "The body is not a JSON object." });
    expect(readNetwork('{"objectClassName":"entity"}').tag).toBe("err");
    expect(readNetwork('{"objectClassName":"ip network","handle":"N","startAddress":"x","endAddress":"8.8.8.8"}').tag).toBe("err");
    const long = readNetwork(JSON.stringify({ objectClassName: "ip network", handle: "N", startAddress: "8.8.8.0", endAddress: "8.8.8.255", name: "n".repeat(500) }));
    expect(long.tag === "ok" && long.value.name?.length).toBe(200);
  });

  it("gives the service of the longest range for each address, as a search of each range gives it", () => {
    const read = readBootstrap(IPV4, "ipv4");
    if (read.tag === "err") throw new Error(read.error);
    const bootstrap = read.value;
    fc.assert(
      fc.property(fc.ipV4(), (address) => {
        const holding = bootstrap.services.flatMap((service) => service.ranges.filter((range) => cidrContains(range, address)).map((range) => ({ service, prefix: range.prefix })));
        const longest = holding.sort((a, b) => b.prefix - a.prefix)[0]?.service;
        expect(serviceFor(bootstrap, address)).toBe(longest);
      }),
    );
  });
});

describe("the probe of the owners", () => {
  const INPUT: OwnerInput = {
    addresses: ["10.0.0.1", "8.8.8.8", "193.0.6.139", "100.64.0.1", "1.0.0.1", "2001:4860:4860::8888", "8.8.8.8", "1.1.1.1", "45.0.0.1", "9.9.9.9"],
  };

  it("gives one fact for each different address, and looks up only the public addresses", async () => {
    const port = fakePort();
    const outcome = await runnerWith().run(ownerProbe(port.get), INPUT);
    if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
    const owners = ownersOf(outcome.facts);
    expect(owners.map((owner) => [owner.address, owner.outcome])).toEqual([
      ["10.0.0.1", "special"],
      ["8.8.8.8", "found"],
      ["193.0.6.139", "found"],
      ["100.64.0.1", "special"],
      ["1.0.0.1", "unregistered"],
      ["2001:4860:4860::8888", "found"],
      ["1.1.1.1", "unlisted"],
      ["45.0.0.1", "unlisted"],
      ["9.9.9.9", "unlisted"],
    ]);
    expect(owners[0]).toEqual({ address: "10.0.0.1", outcome: "special", class: "private" });
    expect(owners[1]).toMatchObject({ registry: "rdap.arin.net", network: { holder: "Example Networks Inc.", originAs: [64500] } });
    expect(owners[6]?.detail).toBe("The registry rdap.example.net of 1.1.1.1 is not in the permitted registries.");
    expect(owners[7]?.detail).toBe("The registry of 45.0.0.1 has no URL with https.");
    expect(port.requests.map((request) => request.url)).toEqual([
      RDAP_BOOTSTRAP.ipv4,
      RDAP_BOOTSTRAP.ipv6,
      "https://rdap.arin.net/registry/ip/8.8.8.8",
      "https://rdap.db.ripe.net/ip/193.0.6.139",
      "https://rdap.apnic.net/ip/1.0.0.1",
      "https://rdap.arin.net/registry/ip/2001:4860:4860::8888",
    ]);
    expect(port.requests[2]).toMatchObject({ host: "rdap.arin.net", what: "the network of 8.8.8.8", headers: { accept: "application/rdap+json, application/json" } });
  });

  it("gives the same facts again from the raw output, with no request", async () => {
    const probe = ownerProbe(fakePort().get);
    const outcome = await runnerWith().run(probe, INPUT);
    if (outcome.status !== "done") throw new Error(outcome.status);
    expect(probe.parse(JSON.parse(JSON.stringify(outcome.raw)) as typeof outcome.raw, INPUT).map((observation) => observation.value)).toEqual(ownersOf(outcome.facts));
  });

  it("follows a redirect to an permitted registry, and stops at a redirect to another place or after the limit", async () => {
    const port = fakePort();
    const outcome = await runnerWith().run(ownerProbe(port.get, { maxRedirects: 2 }), { addresses: ["8.8.4.4", "8.1.1.1", "8.2.2.2"] });
    if (outcome.status !== "done") throw new Error(outcome.status);
    const [moved, away, loop] = ownersOf(outcome.facts);
    expect(moved).toMatchObject({ outcome: "found", registry: "rdap.db.ripe.net" });
    expect(away).toMatchObject({ outcome: "failed", registry: "rdap.arin.net", detail: "rdap.arin.net sent the lookup to a place that is not an permitted registry: https://rdap.example.net/ip/8.1.1.1." });
    expect(loop).toMatchObject({ outcome: "failed", detail: "rdap.arin.net gave more than 2 redirects for 8.2.2.2." });
    expect(port.requests.filter((request) => request.url.endsWith("/8.2.2.2"))).toHaveLength(3);
    expect(port.requests.some((request) => request.host === "rdap.example.net")).toBe(false);
  });

  it("gives the outcome failed for a registry with no answer, an error status or a body that is not a network", async () => {
    const outcome = await runnerWith().run(ownerProbe(fakePort().get), { addresses: ["8.3.3.3", "41.0.0.1", "193.0.0.1", "8.8.8.8"] });
    if (outcome.status !== "done") throw new Error(outcome.status);
    expect(ownersOf(outcome.facts).map((owner) => [owner.outcome, owner.detail])).toEqual([
      ["failed", "rdap.arin.net gave no answer: connection reset"],
      ["failed", "rdap.afrinic.net gave the status 503."],
      ["failed", 'The body is not an RDAP object of the class "ip network".'],
      ["found", undefined],
    ]);
  });

  it("gives the outcome failed for each address of a family when the bootstrap of IANA gives no answer", async () => {
    const port = fakePort({ ...ANSWERS, [RDAP_BOOTSTRAP.ipv4]: { status: 500, headers: {}, body: "" } });
    const outcome = await runnerWith().run(ownerProbe(port.get), { addresses: ["8.8.8.8", "2001:4860:4860::8888"] });
    if (outcome.status !== "done") throw new Error(outcome.status);
    expect(ownersOf(outcome.facts).map((owner) => [owner.outcome, owner.detail])).toEqual([
      ["failed", "The bootstrap of IANA for IPv4 gave the status 500."],
      ["found", undefined],
    ]);
    expect(port.requests).toHaveLength(3);
  });

  it("refuses the run when the scope does not allow a registry, and refuses an input that is not an address", async () => {
    const refused = await runnerWith(GRANTS.slice(0, 3)).run(ownerProbe(fakePort().get), { addresses: ["8.8.8.8"] });
    expect(refused).toMatchObject({ status: "refused", peer: { host: "rdap.apnic.net" } });
    const only = await runnerWith(GRANTS.slice(0, 2)).run(ownerProbe(fakePort().get), { addresses: ["8.8.8.8"], registries: ["RDAP.ARIN.NET"] });
    expect(only.status).toBe("done");
    const bad = await runnerWith().run(ownerProbe(fakePort().get), { addresses: ["8.8.8.8", "example.com"] });
    expect(bad).toEqual({ status: "failed", stage: "probe", error: '"example.com" is not an IP address.' });
    const many = await runnerWith().run(ownerProbe(fakePort().get), { addresses: Array.from({ length: 65 }, (_, index) => `8.8.${index}.1`) });
    expect(many.status).toBe("failed");
  });

  it("gives a fact that passes the check of its kind for each answer of a registry", async () => {
    const status = fc.constantFrom(200, 301, 302, 404, 429, 500, 503);
    const body = fc.oneof(fc.constant(ARIN_NETWORK), fc.constant(RIPE_NETWORK), fc.json(), fc.string({ maxLength: 40 }));
    await fc.assert(
      fc.asyncProperty(status, body, fc.option(fc.webUrl(), { nil: undefined }), async (code, text, location) => {
        const answers = { ...ANSWERS, "https://rdap.arin.net/registry/ip/8.8.8.8": { status: code, headers: location === undefined ? {} : { location }, body: text } };
        const outcome = await runnerWith().run(ownerProbe(fakePort(answers).get), { addresses: ["8.8.8.8"] });
        expect(outcome.status).toBe("done");
        const [owner] = outcome.status === "done" ? ownersOf(outcome.facts) : [];
        expect(PATH_OWNER.check(owner)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it("stops at the signal, and gives no fact", async () => {
    const controller = new AbortController();
    const get: RdapGet = (_request, signal) => {
      controller.abort(new Error("The user stopped the check."));
      return Promise.reject(signal.reason as Error);
    };
    const outcome = await runnerWith().run(ownerProbe(get), { addresses: ["8.8.8.8"] }, controller.signal);
    expect(outcome).toEqual({ status: "aborted", reason: "The user stopped the check." });
  });
});
