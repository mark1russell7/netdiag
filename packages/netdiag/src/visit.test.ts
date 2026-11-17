import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { realClock } from "@mark1russell7/algebra/clock";
import { authority, fakeToolHost, listen, startDnsServer, type Authority, type FakeRule, type Pems, type Zone } from "@netdiag/fixtures";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  CYMRU_ZONES,
  DNS_ANSWER,
  HTTP_RESPONSE,
  ICMP_ECHO,
  LINK_STATE,
  PATH_MTU,
  PATH_ORIGIN,
  PATH_OWNER,
  RDAP_BOOTSTRAP,
  RDAP_REGISTRIES,
  TCP_CONNECT,
  TLS_HANDSHAKE,
  WIFI_LINK,
  isFactOf,
  largePacketsLost,
  target,
  visitTarget,
  type Fact,
  type Grant,
  type RdapGet,
  type TxtResolve,
  type VisitInput,
  DNS_PROBE,
  HTTP_PROBE,
  type VisitOptions,
  type VisitStep,
} from "./index.ts";
import { LINK_SUBJECT, type InterfaceTable } from "./probes/link.ts";
import type { ToolRunOptions } from "./tools/index.ts";
import { pingProbe } from "./tools/ping.ts";

// The visit operates on the loopback addresses: a DNS server of the fixtures on 127.0.0.1, an HTTPS server on
// 127.0.0.2 and a fake host of ping. No assertion examines a time.

const NAME = "www.shop.test";
const RESOLVER = "127.0.0.1";
const SERVER = "127.0.0.2";
/** The interfaces of the link probe: loopback, and one interface on the network of the gateway `192.0.2.1`. */
const TABLE: InterfaceTable = {
  lo: [{ address: "127.0.0.1", cidr: "127.0.0.1/8", internal: true }],
  eth0: [{ address: "192.0.2.10", cidr: "192.0.2.10/24", internal: false }],
};
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

let ca: Authority;
let leaf: Pems;

beforeAll(async () => {
  ca = await authority("netdiag visit root");
  leaf = await ca.issue([NAME, SERVER]);
}, 60_000);

async function httpsServer(): Promise<number> {
  const server = createHttpsServer(leaf, (_request, response) => response.end("shop"));
  const listening = await listen(server, SERVER);
  closers.push(() => listening.close());
  return listening.port;
}

async function resolver(zone: Zone): Promise<{ readonly address: string; readonly port: number }> {
  const server = await startDnsServer({ zone, host: RESOLVER });
  closers.push(() => server.close());
  return { address: server.host, port: server.port };
}

/** The English output of iputils ping: two requests, two replies. */
function pingText(address: string): string {
  return [
    `PING ${address} (${address}) 56(84) bytes of data.`,
    `64 bytes from ${address}: icmp_seq=1 ttl=64 time=0.045 ms`,
    `64 bytes from ${address}: icmp_seq=2 ttl=64 time=0.051 ms`,
    "",
    `--- ${address} ping statistics ---`,
    "2 packets transmitted, 2 received, 0% packet loss, time 201ms",
    "",
  ].join("\n");
}

function pingHost(addresses: readonly string[]) {
  const version: FakeRule = [(args) => args[0] === "-V", { exitCode: 0, stdout: "ping from iputils 20240117\n", stderr: "" }];
  const replies = addresses.map((address): FakeRule => [(args) => args.at(-1) === address, { exitCode: 0, stdout: pingText(address), stderr: "" }]);
  return fakeToolHost<ToolRunOptions>("linux", [version, ...replies]);
}

const range = (cidr: string): Grant => ({ kind: "range", cidr, basis: "owned" });

async function visit(input: VisitInput, options: Partial<VisitOptions> = {}): Promise<VisitStep[]> {
  const steps: VisitStep[] = [];
  // The fake tool hosts of most tests have no Wi-Fi tool. The tests of the Wi-Fi read set the option wifi.
  for await (const step of visitTarget(input, { clock: realClock, tls: { roots: [ca.cert] }, interfaces: () => TABLE, wifi: false, ...options })) steps.push(step);
  return steps;
}

/** This function gives each fact of a visit as its role, its kind and the host of its subject. */
function shape(steps: readonly VisitStep[]): string[] {
  return steps.flatMap((step) => (step.kind === "fact" ? [`${step.role} ${step.fact.kind} ${step.fact.subject.host}`] : []));
}

function problems(steps: readonly VisitStep[]): string[] {
  return steps.flatMap((step) => (step.kind === "problem" ? [step.problem] : []));
}

describe("the visit of a target", () => {
  it("asks A and AAAA, then pings and requests each address, in the order of the roles", async () => {
    const port = await httpsServer();
    const dns = await resolver({ [NAME]: { rcode: 0, a: [SERVER], aaaa: ["00000000000000000000000000000001"] } });
    const tools = pingHost([SERVER, "::1", RESOLVER]);
    const grants = [range(`${RESOLVER}/32`), range(`${SERVER}/32`), range("::1/128")];
    const steps = await visit({ target: { host: NAME, port }, references: [{ host: SERVER, port }], gateway: RESOLVER, resolver: dns, grants }, { tools, pingCount: 2 });
    expect(problems(steps)).toEqual([]);
    const facts = shape(steps);
    expect(facts.filter((fact) => fact.includes(" dns.answer "))).toEqual([`target dns.answer ${NAME}`, `target dns.answer ${NAME}`]);
    expect(facts.filter((fact) => fact.includes(" icmp.echo "))).toEqual([`target icmp.echo ${SERVER}`, "target icmp.echo ::1", `reference icmp.echo ${SERVER}`, `gateway icmp.echo ${RESOLVER}`]);
    // The HTTPS server listens on 127.0.0.2 only. Thus the request to ::1 ends at the TCP connect.
    expect(facts.filter((fact) => fact.includes(" tcp.connect "))).toEqual([`target tcp.connect ${SERVER}`, "target tcp.connect ::1", `reference tcp.connect ${SERVER}`]);
    expect(facts.filter((fact) => fact.includes(" http.response "))).toEqual([`target http.response ${SERVER}`, `reference http.response ${SERVER}`]);
    const records = steps.flatMap((step) => (step.kind === "fact" && isFactOf(DNS_ANSWER, step.fact) ? [step.fact.value.record] : []));
    expect(records).toEqual(["A", "AAAA"]);
    const statuses = steps.flatMap((step) => (step.kind === "fact" && isFactOf(HTTP_RESPONSE, step.fact) && step.fact.subject.host === SERVER ? [step.fact.value.status] : []));
    expect(statuses).toEqual([200, 200]);
    const echoes = steps.flatMap((step) => (step.kind === "fact" && isFactOf(ICMP_ECHO, step.fact) ? [step.fact.value.outcome] : []));
    expect(echoes).toEqual(["reply", "reply", "reply", "reply"]);
    expect(tools.calls.filter((call) => call.args[0] !== "-V").map((call) => call.args.at(-1))).toEqual([SERVER, "::1", SERVER, RESOLVER]);
  });

  it("puts the addresses of a name with a host grant in the scope", async () => {
    const port = await httpsServer();
    const dns = await resolver({ [NAME]: { rcode: 0, a: [SERVER] } });
    const grants: Grant[] = [range(`${RESOLVER}/32`), { kind: "host", host: NAME, basis: "named" }];
    const steps = await visit({ target: { host: NAME, port }, resolver: dns, grants });
    expect(problems(steps)).toEqual([]);
    expect(shape(steps).filter((fact) => fact.includes(" http.response "))).toEqual([`target http.response ${SERVER}`]);
  });

  it("gives a problem for an address out of the scope, and sends it no packet", async () => {
    const port = await httpsServer();
    const dns = await resolver({ [NAME]: { rcode: 0, a: [SERVER] } });
    const tools = pingHost([SERVER]);
    const steps = await visit({ target: { host: NAME, port }, resolver: dns, grants: [range(`${RESOLVER}/32`)] }, { tools, pingCount: 2 });
    const found = problems(steps);
    expect(found).toHaveLength(2);
    expect(found.every((problem) => problem.includes("refused") && problem.includes("not in the scope"))).toBe(true);
    expect(tools.calls).toEqual([]);
  });

  it("gives a problem for a name with no resolver", async () => {
    const steps = await visit({ target: { host: NAME }, grants: [range(`${RESOLVER}/32`)] });
    expect(steps.filter((step) => step.kind === "problem")).toEqual([{ kind: "problem", role: "target", host: NAME, problem: `The visit has no DNS resolver for the name ${NAME}.` }]);
    expect(shape(steps)).toEqual(["local link.state localhost"]);
  });

  it("starts no tool with a ping count of 0, and no tool with no tool host", async () => {
    const port = await httpsServer();
    const tools = pingHost([SERVER]);
    const quiet = await visit({ target: { host: SERVER, port }, gateway: SERVER, grants: [range(`${SERVER}/32`)] }, { tools, pingCount: 0 });
    expect(tools.calls).toEqual([]);
    const plain = await visit({ target: { host: SERVER, port }, gateway: SERVER, grants: [range(`${SERVER}/32`)] });
    for (const steps of [quiet, plain]) expect(shape(steps)).toEqual([`local link.state ${SERVER}`, `target tcp.connect ${SERVER}`, `target tls.handshake ${SERVER}`, `target http.response ${SERVER}`]);
  });

  it("reads the link first, to the gateway of the input, and sends no packet for it", async () => {
    const tools = pingHost([]);
    const states: [string, string | undefined][] = [];
    for (const gateway of ["192.0.2.1", "198.51.100.1", undefined]) {
      const steps = await visit({ target: { host: NAME }, gateway, grants: [range(`${RESOLVER}/32`)] }, { tools, pingCount: 0 });
      const first = steps[0];
      expect(first?.kind === "fact" && first.role === "local" && isFactOf(LINK_STATE, first.fact)).toBe(true);
      if (first?.kind === "fact" && isFactOf(LINK_STATE, first.fact)) states.push([first.fact.value.state, first.fact.value.via]);
    }
    expect(states).toEqual([["up", "eth0"], ["down", undefined], ["up", undefined]]);
    expect(tools.calls).toEqual([]);
    const alone = await visit({ target: { host: NAME }, grants: [] }, { interfaces: () => ({ lo: TABLE["lo"] }) });
    expect(alone[0]?.kind === "fact" && isFactOf(LINK_STATE, alone[0].fact) && alone[0].fact.value.state).toBe("down");
  });

  it("reads the Wi-Fi link after the link, with the tool of the system, and sends no packet for it", async () => {
    const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
    const iw = (match: (args: readonly string[]) => boolean, stdout: string): FakeRule => [(args, command) => command === "iw" && match(args), ok(stdout)];
    const tools = fakeToolHost<ToolRunOptions>("linux", [
      iw((args) => args[0] === "--version", "iw version 6.9\n"),
      iw((args) => args.join(" ") === "dev", "phy#0\n\tInterface wlan0\n\t\tifindex 3\n\t\ttype managed\n"),
      iw((args) => args.at(-1) === "link", "Connected to 02:00:00:00:00:aa (on wlan0)\n\tSSID: lab-net\n\tfreq: 5180\n\tsignal: -80 dBm\n"),
      iw((args) => args.at(-1) === "dump", ""),
    ]);
    const steps = await visit({ target: { host: NAME }, grants: [range(`${RESOLVER}/32`)] }, { tools, pingCount: 0, wifi: true });
    expect(shape(steps)).toEqual(["local link.state localhost", "local wifi.link localhost"]);
    const wifi = steps[1];
    expect(wifi?.kind === "fact" && isFactOf(WIFI_LINK, wifi.fact) ? wifi.fact.value : undefined).toMatchObject({ interface: "wlan0", state: "connected", ssid: "lab-net", signalDbm: -80, channel: 36, band: "5" });
    expect(tools.calls.map((call) => [call.command, ...call.args].join(" "))).toEqual(["iw --version", "iw dev", "iw dev wlan0 link", "iw dev wlan0 survey dump"]);
  });

  it("reads the Wi-Fi link by default, gives a problem for a Wi-Fi tool that does not start, and does not read it with wifi false", async () => {
    const input: VisitInput = { target: { host: NAME }, grants: [range(`${RESOLVER}/32`)] };
    const missing = fakeToolHost<ToolRunOptions>("linux", []);
    const steps = await visit(input, { tools: missing, pingCount: 0, wifi: undefined });
    expect(steps.filter((step) => step.kind === "problem" && step.role === "local")).toEqual([
      { kind: "problem", role: "local", host: "localhost", problem: "The read of the Wi-Fi link did not end: unavailable: The tool iw does not start: no rule." },
    ]);
    const off = fakeToolHost<ToolRunOptions>("linux", []);
    const quiet = await visit(input, { tools: off, pingCount: 0, wifi: false });
    expect(quiet.some((step) => step.role === "local" && step.kind === "problem")).toBe(false);
    expect(off.calls).toEqual([]);
  });

  it("refuses a grant with a problem before the first probe", async () => {
    await expect(visit({ target: { host: SERVER }, grants: [range("not a range")] })).rejects.toThrow(RangeError);
  });

  it("uses the probes of the options with the parse of the real probes, and needs no port for them", async () => {
    const queries: string[] = [];
    const dns: VisitOptions["probes"] = {
      dns: {
        ...DNS_PROBE,
        available: () => Promise.resolve({ available: true }),
        run: (input) => {
          queries.push(`${input.record ?? "A"} ${input.name}`);
          const base = { name: input.name, record: input.record ?? "A", resolver: `${input.resolver}:53`, start: 0, end: 4 };
          return Promise.resolve(input.record === "AAAA" ? { ...base, outcome: "nodata" as const, addresses: [] } : { ...base, outcome: "ok" as const, addresses: [SERVER] });
        },
      },
      http: {
        ...HTTP_PROBE,
        available: () => Promise.resolve({ available: true }),
        run: (input) => Promise.resolve({ scheme: input.scheme, tcp: { address: input.address, port: 443, family: 4 as const, start: 0, end: 7, outcome: "refused" as const } }),
      },
    };
    const ping = pingHost([SERVER]);
    const grants = [range(`${SERVER}/32`), range(`${RESOLVER}/32`)];
    const steps = await visit({ target: { host: NAME }, resolver: { address: RESOLVER }, grants }, { probes: { ...dns, ping: pingProbe(ping) }, pingCount: 2 });
    expect(problems(steps)).toEqual([]);
    expect(queries).toEqual([`A ${NAME}`, `AAAA ${NAME}`]);
    expect(shape(steps)).toEqual([`local link.state ${LINK_SUBJECT}`, `target dns.answer ${NAME}`, `target dns.answer ${NAME}`, `target icmp.echo ${SERVER}`, `target tcp.connect ${SERVER}`]);
    const connect = steps.flatMap((step) => (step.kind === "fact" && isFactOf(TCP_CONNECT, step.fact) ? [step.fact.value.outcome] : []));
    expect(connect).toEqual(["refused"]);
    const none = await visit({ target: { host: SERVER }, grants }, { probes: { ping: pingProbe(ping) }, pingCount: 0, mtu: "never" });
    expect(shape(none).some((fact) => fact.includes(" icmp.echo "))).toBe(false);
  });
});

/** A server that takes each TCP connect and sends nothing: the TLS handshake times out, as on a path that drops large packets. */
async function silentServer(): Promise<number> {
  const listening = await listen(createTcpServer(), SERVER);
  closers.push(() => listening.close());
  return listening.port;
}

/** This function gives the MTU searches of the calls of a fake tool host: the address of each call with `-M do`. */
function mtuCalls(calls: readonly { readonly args: readonly string[] }[]): (string | undefined)[] {
  return calls.filter((call) => call.args.includes("-M")).map((call) => call.args.at(-1));
}

describe("the MTU search of a visit", () => {
  const grants = [range(`${SERVER}/32`)];

  it("searches the MTU after a TLS handshake that times out, with the default auto", async () => {
    const port = await silentServer();
    const tools = pingHost([SERVER]);
    const steps = await visit({ target: { host: SERVER, port }, grants }, { tools, pingCount: 0, httpTimeoutMs: 300 });
    expect(problems(steps)).toEqual([]);
    // The input has no gateway, so the link fact has the subject of this computer.
    expect(shape(steps)).toEqual([`local link.state ${LINK_SUBJECT}`, `target tcp.connect ${SERVER}`, `target tls.handshake ${SERVER}`, `target path.mtu ${SERVER}`]);
    // Each try of the fake host gets replies, so the search ends with one try at the ceiling.
    expect(mtuCalls(tools.calls)).toEqual([SERVER]);
    const mtu = steps.flatMap((step) => (step.kind === "fact" && isFactOf(PATH_MTU, step.fact) ? [step.fact.value] : []));
    expect(mtu.map((value) => value.outcome)).toEqual(["measured"]);
  });

  it("does not search with mtu never, and does not search after a request that works", async () => {
    const silent = await silentServer();
    const tools = pingHost([SERVER]);
    const never = await visit({ target: { host: SERVER, port: silent }, grants }, { tools, pingCount: 0, httpTimeoutMs: 300, mtu: "never" });
    expect(shape(never).some((fact) => fact.includes(" path.mtu "))).toBe(false);
    const port = await httpsServer();
    const works = await visit({ target: { host: SERVER, port }, grants }, { tools, pingCount: 0 });
    expect(shape(works).some((fact) => fact.includes(" path.mtu "))).toBe(false);
    expect(mtuCalls(tools.calls)).toEqual([]);
  });

  it("searches after each request with mtu always, and not with no tool host", async () => {
    const port = await httpsServer();
    const tools = pingHost([SERVER]);
    const always = await visit({ target: { host: SERVER, port }, grants }, { tools, pingCount: 0, mtu: "always" });
    expect(shape(always).at(-1)).toBe(`target path.mtu ${SERVER}`);
    expect(mtuCalls(tools.calls)).toEqual([SERVER]);
    const plain = await visit({ target: { host: SERVER, port }, grants }, { mtu: "always" });
    expect(shape(plain).some((fact) => fact.includes(" path.mtu "))).toBe(false);
  });
});

/** The JSON report of mtr 0.95 for a path. The host `???` is a hop with no answer. */
function mtrReport(dst: string, hosts: readonly string[]): string {
  const hubs = hosts.map((host, index) =>
    host === "???"
      ? { count: index + 1, host, "Loss%": 100, Snt: 2, Last: 0, Best: 0, Avg: 0, Wrst: 0, StDev: 0 }
      : { count: index + 1, host, "Loss%": 0, Snt: 2, Last: 0.5, Best: 0.4, Avg: 0.6, Wrst: 1.2, StDev: 0.1 },
  );
  return JSON.stringify({ report: { mtr: { src: "lab", dst, tos: 0, tests: 2 }, hubs } });
}

function mtrHost(report: string) {
  const version: FakeRule = [(args, command) => command === "mtr" && args[0] === "--version", { exitCode: 0, stdout: "mtr 0.95\n", stderr: "" }];
  const run: FakeRule = [(args, command) => command === "mtr" && args[0] === "--json", { exitCode: 0, stdout: report, stderr: "" }];
  return fakeToolHost<ToolRunOptions>("linux", [version, run]);
}

/** A public address of the range of the bootstrap below. */
const PUBLIC_HOP = "8.8.4.4";
const BOOTSTRAP = JSON.stringify({ version: "1.0", publication: "2026-11-03T22:00:01Z", services: [[["8.0.0.0/8"], ["https://rdap.arin.net/registry/"]]] });
const NETWORK = JSON.stringify({ objectClassName: "ip network", handle: "NET-8-8-4-0-1", startAddress: "8.8.4.0", endAddress: "8.8.4.255", name: "EXAMPLE-8" });

/** A fake port of RDAP: the bootstrap of IPv4, the network of `PUBLIC_HOP`, and the status 404 for each other URL. */
function rdapPort(): { readonly get: RdapGet; readonly urls: string[] } {
  const urls: string[] = [];
  const get: RdapGet = (request) => {
    urls.push(request.url);
    const body = request.url === RDAP_BOOTSTRAP.ipv4 ? BOOTSTRAP : request.url.endsWith(`/ip/${PUBLIC_HOP}`) ? NETWORK : undefined;
    return Promise.resolve(body === undefined ? { status: 404, headers: {}, body: "" } : { status: 200, headers: { "content-type": "application/rdap+json" }, body });
  };
  return { get, urls };
}

function owners(steps: readonly VisitStep[]): string[] {
  return steps.flatMap((step) => (step.kind === "fact" && isFactOf(PATH_OWNER, step.fact) ? [`${step.role} ${step.fact.value.address} ${step.fact.value.outcome}`] : []));
}

describe("the owners of the hops of a visit", () => {
  const registries: Grant[] = [new URL(RDAP_BOOTSTRAP.ipv4).hostname, ...RDAP_REGISTRIES].map((host) => ({ kind: "host", host, basis: "named" }));
  const grants = [range(`${SERVER}/32`), ...registries];
  const report = mtrReport(SERVER, ["10.0.0.1", "???", PUBLIC_HOP, SERVER]);

  it("looks up each hop after mtr, and looks up a hop of the reference only when it is new", async () => {
    const port = await httpsServer();
    const tools = mtrHost(report);
    const rdap = rdapPort();
    const input: VisitInput = { target: { host: SERVER, port }, references: [{ host: SERVER, port }], grants };
    const steps = await visit(input, { tools, pingCount: 0, mtrCycles: 2, owners: rdap.get });
    expect(problems(steps)).toEqual([]);
    expect(owners(steps)).toEqual(["target 10.0.0.1 special", `target ${PUBLIC_HOP} found`, `target ${SERVER} special`]);
    expect(rdap.urls).toEqual([RDAP_BOOTSTRAP.ipv4, `https://rdap.arin.net/registry/ip/${PUBLIC_HOP}`]);
    const facts = shape(steps).filter((fact) => fact.startsWith("target "));
    expect(facts.indexOf(`target path.report ${SERVER}`)).toBeLessThan(facts.indexOf(`target path.owner ${PUBLIC_HOP}`));
  });

  it("looks up no owner with no port and with no mtr, and gives a problem for a registry out of the scope", async () => {
    const port = await httpsServer();
    const rdap = rdapPort();
    const plain = await visit({ target: { host: SERVER, port }, grants }, { tools: mtrHost(report), pingCount: 0, mtrCycles: 2 });
    expect(owners(plain)).toEqual([]);
    const noMtr = mtrHost(report);
    const quiet = await visit({ target: { host: SERVER, port }, grants }, { tools: noMtr, pingCount: 0, owners: rdap.get });
    expect(owners(quiet)).toEqual([]);
    expect(noMtr.calls).toEqual([]);
    const refused = await visit({ target: { host: SERVER, port }, grants: [range(`${SERVER}/32`)] }, { tools: mtrHost(report), pingCount: 0, mtrCycles: 2, owners: rdap.get });
    expect(owners(refused)).toEqual([]);
    expect(problems(refused)).toEqual([expect.stringMatching(/^The lookup of the owners of the hops to 127\.0\.0\.2 did not end: /)]);
    expect(rdap.urls).toEqual([]);
  });
});

describe("the origin AS of the hops of a visit", () => {
  const zones: Grant[] = Object.values(CYMRU_ZONES).map((host): Grant => ({ kind: "host", host, basis: "named" }));
  const report = mtrReport(SERVER, ["10.0.0.1", PUBLIC_HOP, SERVER]);

  it("looks up the origin of each hop after mtr through the resolver of the input, and gives a problem with no resolver", async () => {
    const port = await httpsServer();
    const names: string[] = [];
    const origins: TxtResolve = (query) => {
      names.push(`${query.name} ${query.resolver}:${query.port}`);
      return Promise.resolve({ outcome: "nxdomain", records: [], code: "ENOTFOUND" });
    };
    const routes = (steps: readonly VisitStep[]): string[] =>
      steps.flatMap((step) => (step.kind === "fact" && isFactOf(PATH_ORIGIN, step.fact) ? [`${step.fact.value.address} ${step.fact.value.outcome}`] : []));
    const grants = [range(`${SERVER}/32`), range("127.0.0.1/32"), ...zones];
    const input: VisitInput = { target: { host: SERVER, port }, resolver: { address: "127.0.0.1", port: 5353 }, grants };
    const steps = await visit(input, { tools: mtrHost(report), pingCount: 0, mtrCycles: 2, origins });
    expect(problems(steps)).toEqual([]);
    expect(routes(steps)).toEqual(["10.0.0.1 special", `${PUBLIC_HOP} unrouted`, `${SERVER} special`]);
    expect(names).toEqual(["4.4.8.8.origin.asn.cymru.com 127.0.0.1:5353"]);
    const alone = await visit({ target: { host: SERVER, port }, grants }, { tools: mtrHost(report), pingCount: 0, mtrCycles: 2, origins });
    expect(routes(alone)).toEqual([]);
    expect(problems(alone)).toEqual([`The visit has no DNS resolver for the lookups of the origin AS of the hops to ${SERVER}.`]);
    expect(names).toHaveLength(1);
  });
});

describe("largePacketsLost", () => {
  const base = { subject: target(SERVER), time: { start: 0, end: 1 }, source: { probe: "test", version: "0" } };
  const connect = (outcome: "connected" | "refused"): Fact => ({
    ...base,
    id: "f1",
    kind: TCP_CONNECT.kind,
    layer: "tcp",
    value: { address: SERVER, port: 443, family: 4, outcome, ms: 1 },
  });
  const handshake = (outcome: "ok" | "timeout"): Fact => ({
    ...base,
    id: "f2",
    kind: TLS_HANDSHAKE.kind,
    layer: "tls",
    value: { address: SERVER, port: 443, outcome, ms: 1 },
  });

  it("gives true for a connect, then a TLS handshake that times out", () => {
    expect(largePacketsLost([connect("connected"), handshake("timeout")])).toBe(true);
  });

  it("gives false with no connect, after a refused connect, and after a handshake that works", () => {
    expect(largePacketsLost([handshake("timeout")])).toBe(false);
    expect(largePacketsLost([connect("refused"), handshake("timeout")])).toBe(false);
    expect(largePacketsLost([connect("connected"), handshake("ok")])).toBe(false);
  });
});
