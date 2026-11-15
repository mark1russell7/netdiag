import { createServer as createHttpsServer } from "node:https";
import { realClock } from "@mark1russell7/algebra/clock";
import { authority, fakeToolHost, listen, startDnsServer, type Authority, type FakeRule, type Pems, type Zone } from "@netdiag/fixtures";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DNS_ANSWER, HTTP_RESPONSE, ICMP_ECHO, LINK_STATE, isFactOf, visitTarget, type Grant, type VisitInput, type VisitOptions, type VisitStep } from "./index.ts";
import type { InterfaceTable } from "./probes/link.ts";
import type { ToolRunOptions } from "./tools/index.ts";

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
  for await (const step of visitTarget(input, { clock: realClock, tls: { roots: [ca.cert] }, interfaces: () => TABLE, ...options })) steps.push(step);
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

  it("refuses a grant with a problem before the first probe", async () => {
    await expect(visit({ target: { host: SERVER }, grants: [range("not a range")] })).rejects.toThrow(RangeError);
  });
});
