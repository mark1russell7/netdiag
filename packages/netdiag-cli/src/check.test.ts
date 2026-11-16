import { createServer as createHttpsServer } from "node:https";
import { realClock } from "@mark1russell7/algebra/clock";
import type { ToolRunOptions } from "@mark1russell7/netdiag/tools";
import { authority, fakeToolHost, listen, startDnsServer, type Authority, type DnsServer, type FakeRule, type Pems } from "@netdiag/fixtures";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PATH_OWNER, RDAP_BOOTSTRAP, isFactOf, type RdapGet, type VisitRole } from "@mark1russell7/netdiag";
import { check } from "./check.ts";
import { createNetdiagCli } from "./cli.ts";
import { formatReport, type CheckReport } from "./report.ts";

// The check from end to end on the loopback addresses: a DNS server of the fixtures on 127.0.0.1, an HTTPS server on
// 127.0.0.2 and a fake host of ping. No assertion examines a time.

const NAME = "www.shop.test";
const REFERENCE = "ref.shop.test";
/** A name that the zone has, and that the user does not name. The check never asks for it or probes its address. */
const OUTSIDE = "outside.shop.test";
const RESOLVER = "127.0.0.1";
const SERVER = "127.0.0.2";
const OUTSIDE_ADDRESS = "127.0.0.3";
/** The roles of the probes that send packets. A later role, for example a passive read of this computer, is not in the list. */
const ROLES: readonly VisitRole[] = ["target", "reference", "gateway"];
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

let ca: Authority;
let leaf: Pems;

beforeAll(async () => {
  ca = await authority("netdiag check root");
  leaf = await ca.issue([NAME, REFERENCE, SERVER]);
}, 60_000);

async function httpsServer(): Promise<number> {
  const server = createHttpsServer(leaf, (_request, response) => response.end("shop"));
  const listening = await listen(server, SERVER);
  closers.push(() => listening.close());
  return listening.port;
}

async function dnsServer(): Promise<DnsServer> {
  const server = await startDnsServer({
    host: RESOLVER,
    zone: { [NAME]: { rcode: 0, a: [SERVER] }, [REFERENCE]: { rcode: 0, a: [SERVER] }, [OUTSIDE]: { rcode: 0, a: [OUTSIDE_ADDRESS] } },
  });
  closers.push(() => server.close());
  return server;
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

/** A fake ping that answers each address, so that only the scope of the check limits the requests. The rules of `first` go first. */
function pingHost(first: readonly FakeRule[] = []) {
  const version: FakeRule = [(args) => args[0] === "-V", { exitCode: 0, stdout: "ping from iputils 20240117\n", stderr: "" }];
  const reply: FakeRule = [() => true, { exitCode: 0, stdout: "", stderr: "" }];
  const replies = [SERVER, RESOLVER, OUTSIDE_ADDRESS].map((address): FakeRule => [(args) => args.at(-1) === address, { exitCode: 0, stdout: pingText(address), stderr: "" }]);
  return fakeToolHost<ToolRunOptions>("linux", [...first, version, ...replies, reply]);
}

/** A public address in the range of the bootstrap below. The fake registry has no network for it. */
const PUBLIC_HOP = "8.8.4.4";
const BOOTSTRAP = JSON.stringify({ version: "1.0", publication: "2026-11-03T22:00:01Z", services: [[["8.0.0.0/8"], ["https://rdap.arin.net/registry/"]]] });
const hop = (count: number, host: string) => ({ count, host, "Loss%": 0, Snt: 2, Last: 0.5, Best: 0.4, Avg: 0.6, Wrst: 1.2, StDev: 0.1 });
/** The JSON report of mtr 0.95 for the path to the server: a private router, a public router and the server. */
const MTR_REPORT = JSON.stringify({ report: { mtr: { src: "lab", dst: SERVER, tos: 0, tests: 2 }, hubs: [hop(1, "10.0.0.1"), hop(2, PUBLIC_HOP), hop(3, SERVER)] } });
const MTR_RULES: readonly FakeRule[] = [
  [(args, command) => command === "mtr" && args[0] === "--version", { exitCode: 0, stdout: "mtr 0.95\n", stderr: "" }],
  [(args, command) => command === "mtr" && args[0] === "--json", { exitCode: 0, stdout: MTR_REPORT, stderr: "" }],
];

describe("a check from end to end", () => {
  it("looks up the owners of the hops of mtr with owners, through the port of RDAP", async () => {
    const port = await httpsServer();
    const urls: string[] = [];
    const rdap: RdapGet = (request) => {
      urls.push(request.url);
      return Promise.resolve(request.url === RDAP_BOOTSTRAP.ipv4 ? { status: 200, headers: {}, body: BOOTSTRAP } : { status: 404, headers: {}, body: "" });
    };
    const deps = { clock: realClock, tools: pingHost(MTR_RULES), resolvers: [], tls: { roots: [ca.cert] }, rdap };
    const report = await check({ target: `${SERVER}:${port}`, pingCount: 0, owners: true, mtrCycles: 2 }, deps);
    const owners = report.facts.flatMap(({ fact }) => (isFactOf(PATH_OWNER, fact) ? [`${fact.value.address} ${fact.value.outcome}`] : []));
    expect(owners).toEqual(["10.0.0.1 special", `${PUBLIC_HOP} unregistered`, `${SERVER} special`]);
    expect(urls).toEqual([RDAP_BOOTSTRAP.ipv4, `https://rdap.arin.net/registry/ip/${PUBLIC_HOP}`]);
    expect(formatReport(report)).toContain(`  ${PUBLIC_HOP}: the registry has no network for this address`);
    // Without the option owners, the check looks up no owner, also with a port.
    const plain = await check({ target: `${SERVER}:${port}`, pingCount: 0, mtrCycles: 2 }, deps);
    expect(plain.facts.some(({ fact }) => isFactOf(PATH_OWNER, fact))).toBe(false);
    expect(urls).toHaveLength(2);
  });

  it("probes only the named hosts, the resolver, the gateway and the addresses of the named hosts", async () => {
    const port = await httpsServer();
    const dns = await dnsServer();
    const tools = pingHost();
    const report = await check(
      { target: `https://${NAME}:${port}/`, reference: [`${REFERENCE}:${port}`], resolver: `${RESOLVER}:${dns.port}`, gateway: RESOLVER, pingCount: 2 },
      { clock: realClock, tools, resolvers: [], tls: { roots: [ca.cert] } },
    );
    expect(report.problems.filter((item) => ROLES.includes(item.role))).toEqual([]);
    expect([...new Set(dns.asked)].sort()).toEqual([NAME, REFERENCE].sort());
    const pinged = tools.calls.filter((call) => call.command === "ping" && call.args[0] !== "-V").map((call) => call.args.at(-1));
    expect([...new Set(pinged)].sort()).toEqual([RESOLVER, SERVER].sort());
    // The check also reads the Wi-Fi link of this computer. The fake iw gives no interface.
    expect(tools.calls.filter((call) => call.command === "iw").map((call) => call.args.join(" "))).toEqual(["--version", "dev"]);
    // The scope rule holds the probes that send packets. A passive read of this computer has no remote subject.
    const active = new Set(["dns.answer", "icmp.echo", "tcp.connect", "tls.handshake", "http.response"]);
    const subjects = new Set(report.facts.filter((item) => active.has(item.fact.kind)).map((item) => item.fact.subject.host));
    expect(subjects.size).toBeGreaterThan(0);
    for (const host of subjects) expect([NAME, REFERENCE, SERVER, RESOLVER]).toContain(host);
    expect(subjects.has(OUTSIDE_ADDRESS)).toBe(false);
    expect(report.facts.map((item) => `${item.role} ${item.fact.kind}`)).toEqual(
      expect.arrayContaining(["target dns.answer", "target icmp.echo", "target http.response", "reference http.response", "gateway icmp.echo"]),
    );
  });

  it("reads the visit into evidence, causes and a JSON report", async () => {
    const port = await httpsServer();
    const dns = await dnsServer();
    const report = await check(
      { target: NAME, port, reference: [`${REFERENCE}:${port}`], resolver: `${RESOLVER}:${dns.port}`, pingCount: 2 },
      { clock: realClock, tools: pingHost(), resolvers: [], tls: { roots: [ca.cert] } },
    );
    expect(report.evidence).toContainEqual(expect.objectContaining({ feature: "dns.answer", value: "ok", primary: true }));
    expect(report.evidence).toContainEqual(expect.objectContaining({ feature: "http.status", value: "ok", primary: true }));
    expect(report.evidence).toContainEqual(expect.objectContaining({ feature: "http.status", value: "ok", primary: false }));
    expect(report.causes.reduce((sum, cause) => sum + cause.probability, 0)).toBeCloseTo(1, 9);
    // The user gave no gateway, so a next step can ask for it. No step probes a host outside the scope.
    for (const step of report.choices) expect(["target.", "reference.", "gateway."].some((role) => step.id.startsWith(role))).toBe(true);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("gives a check of the command line its result through the program", async () => {
    const port = await httpsServer();
    const dns = await dnsServer();
    const out: string[] = [];
    const errors: string[] = [];
    const cli = createNetdiagCli({
      print: {
        info: (message) => out.push(message),
        error: (message) => errors.push(message),
        success: (message) => out.push(message),
        warning: (message) => errors.push(message),
        table: () => undefined,
        spin: () => ({ stop: () => undefined, succeed: () => undefined, fail: () => undefined, text: "" }),
      },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, env: {} },
      check: (options, signal) => check(options, { clock: realClock, tools: pingHost(), resolvers: [], tls: { roots: [ca.cert] }, signal }),
    });
    const code = await cli.run(["check", NAME, "--port", String(port), "--resolver", `${RESOLVER}:${dns.port}`, "--ping-count", "2", "--json"]);
    expect(errors).toEqual([]);
    expect(code).toBe(0);
    const report = JSON.parse(out.join("\n")) as CheckReport;
    expect(report).toMatchObject({ format: "netdiag-check/1", target: `${NAME}:${port}` });
    expect(report.problems.filter((item) => ROLES.includes(item.role))).toEqual([]);
  });
});
