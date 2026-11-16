import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realClock } from "@mark1russell7/algebra/clock";
import { CYMRU_ZONES, RDAP_REGISTRIES, STANDARD_CATALOG, decideScope, lookupGrants, originProbe, ownerProbe, scopeOf, type Fact } from "@mark1russell7/netdiag";
import { signsOf } from "../cases.ts";
import type { ToolRunOptions } from "@mark1russell7/netdiag/tools";
import { authority, fakeToolHost, startDnsServer, type Authority, type FakeRule } from "@netdiag/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { refuseRdap, refuseTxt, startAgent } from "./agent.ts";
import { KERNEL_CASES, KERNEL_LATER, KERNEL_REFERENCE_NAME, KERNEL_TARGET_NAME, TOWARD_TARGET, applySteps, faultPlan, kernelZone, type StepLab } from "./cases.ts";
import { httpsArgs, parseHttpsArgs, startHttps } from "./https.ts";
import { agentArgs, LOOKUP_REASON, parseAgentArgs, visitInputOf, visitOf, type AgentLine, type AgentPlan } from "./protocol.ts";
import { parseZoneArg, zoneArg } from "./resolver.ts";
import { IMAGE_FILES, NODE_IMAGE, REPOSITORY_ROOT, kernelPlan, kernelTarget, wherePlan } from "./world.ts";

// The parts of the kernel lab that operate with no Docker. CI starts the worlds (lab-kernel.yml). No assertion examines a time.

const PEERS = { target: "172.20.0.2", reference: "172.20.0.3" };

describe("the kernel cases", () => {
  it("have different ids, a hypothesis of the catalog as the truth, and signs with values of the catalog", () => {
    expect(new Set(KERNEL_CASES.map((c) => c.id)).size).toBe(KERNEL_CASES.length);
    const ids = new Set(STANDARD_CATALOG.hypotheses.map((h) => h.id));
    for (const labCase of KERNEL_CASES) {
      expect(ids.has(labCase.truth), labCase.id).toBe(true);
      expect(labCase.signs.length, labCase.id).toBeGreaterThan(0);
      for (const sign of labCase.signs.flatMap(signsOf)) expect(STANDARD_CATALOG.features.get(sign.feature)?.values, `${labCase.id} ${sign.feature}`).toContain(sign.value);
    }
  });

  it("cover the second slice, and the list for later has the other kernel classes of the catalog", () => {
    expect(KERNEL_CASES.map((c) => c.truth)).toEqual(["none", "filter.drop", "filter.icmp", "path.loss", "path.mtu", "host.down", "filter.reset", "gateway.down"]);
    const ids = new Set(STANDARD_CATALOG.hypotheses.map((h) => h.id));
    expect(KERNEL_LATER.map((later) => later.hypothesis)).toEqual(["ipv6.broken"]);
    for (const later of KERNEL_LATER) expect(ids.has(later.hypothesis), later.hypothesis).toBe(true);
  });
});

describe("faultPlan and applySteps", () => {
  it("ends each lift with forget, and has no step for the control", () => {
    for (const labCase of KERNEL_CASES) expect(faultPlan(labCase.fault, PEERS).lift.at(-1), labCase.id).toEqual({ op: "forget" });
    expect(faultPlan(null, PEERS).apply).toEqual([]);
  });

  it("turns the offload off before the MTU drop, faces the two servers, and reverses each step", () => {
    const mtu = KERNEL_CASES.find((c) => c.id === "path.mtu")!;
    const plan = faultPlan(mtu.fault, PEERS);
    const options = { above: 1200, protocol: "all", peers: [PEERS.target, PEERS.reference] };
    expect(plan.apply).toEqual([
      { op: "offload", on: false, at: TOWARD_TARGET },
      { op: "offload", on: false, at: "target" },
      { op: "fault", kind: "mtu", at: TOWARD_TARGET, options },
    ]);
    expect(plan.lift).toEqual([
      { op: "lift", kind: "mtu", at: TOWARD_TARGET, options },
      { op: "offload", on: true, at: TOWARD_TARGET },
      { op: "offload", on: true, at: "target" },
      { op: "forget" },
    ]);
  });

  it("gives the options of each network fault to its fault and to its lift", () => {
    const planOf = (id: string) => faultPlan(KERNEL_CASES.find((c) => c.id === id)!.fault, PEERS);
    const reject = { direction: "out", protocol: "all", code: "host" };
    expect(planOf("host.down").apply).toEqual([{ op: "fault", kind: "reject", at: TOWARD_TARGET, options: reject }]);
    expect(planOf("host.down").lift).toEqual([{ op: "lift", kind: "reject", at: TOWARD_TARGET, options: reject }, { op: "forget" }]);
    expect(planOf("filter.reset").apply).toEqual([{ op: "fault", kind: "rst", at: "target", options: { handshake: "pass" } }]);
    // a silence takes no options: the harness refuses each option of it
    expect(planOf("gateway.down").apply).toEqual([{ op: "fault", kind: "silence", at: TOWARD_TARGET, options: {} }]);
  });

  it("does each step on the lab in sequence", async () => {
    const calls: string[] = [];
    const stamp = { t0: 0, t1: 0 };
    const lab: StepLab = {
      fault: (kind, at) => (calls.push(`fault ${kind} ${JSON.stringify(at)}`), Promise.resolve(stamp)),
      lift: (kind, at) => (calls.push(`lift ${kind} ${JSON.stringify(at)}`), Promise.resolve()),
      netem: (spec, at) => (calls.push(`netem ${spec} ${JSON.stringify(at)}`), Promise.resolve(stamp)),
      targetSysctl: (values) => (calls.push(`sysctl ${JSON.stringify(values)}`), Promise.resolve({ ...values })),
      offload: (on, at) => (calls.push(`offload ${on} ${JSON.stringify(at)}`), Promise.resolve()),
      forget: () => (calls.push("forget"), Promise.resolve()),
    };
    for (const labCase of KERNEL_CASES) {
      const plan = faultPlan(labCase.fault, PEERS);
      await applySteps(lab, plan.apply);
      await applySteps(lab, plan.lift);
    }
    expect(calls).toEqual([
      "forget",
      'fault blackhole "target"',
      'lift blackhole "target"',
      "forget",
      'sysctl {"net.ipv4.icmp_echo_ignore_all":"1"}',
      'sysctl {"net.ipv4.icmp_echo_ignore_all":"0"}',
      "forget",
      'netem loss 20% "target"',
      'netem null "target"',
      "forget",
      'offload false {"hop":"gw","toward":"target"}',
      'offload false "target"',
      'fault mtu {"hop":"gw","toward":"target"}',
      'lift mtu {"hop":"gw","toward":"target"}',
      'offload true {"hop":"gw","toward":"target"}',
      'offload true "target"',
      "forget",
      'fault reject {"hop":"gw","toward":"target"}',
      'lift reject {"hop":"gw","toward":"target"}',
      "forget",
      'fault rst "target"',
      'lift rst "target"',
      "forget",
      'fault silence {"hop":"gw","toward":"target"}',
      'lift silence {"hop":"gw","toward":"target"}',
      "forget",
    ]);
  });
});

describe("the protocol of the agent", () => {
  const plan: AgentPlan = kernelPlan({ ...PEERS, resolver: "172.20.0.4", gateway: "172.21.0.1" });

  it("reads its own arguments back, and has the three lab hosts and the gateway in the scope", () => {
    expect(parseAgentArgs(agentArgs(plan))).toEqual(plan);
    expect(plan.grants).toEqual(["172.20.0.2/32", "172.20.0.3/32", "172.20.0.4/32", "172.21.0.1/32"]);
    expect(plan.references).toEqual([KERNEL_REFERENCE_NAME]);
    expect(visitInputOf(plan).gateway).toBe("172.21.0.1");
    const plain: AgentPlan = { ...plan, gateway: undefined };
    expect(agentArgs(plain)).not.toContain("--gateway");
    expect(parseAgentArgs(agentArgs(plain))).not.toHaveProperty("gateway");
    expect(visitInputOf(plain)).not.toHaveProperty("gateway");
  });

  const where = wherePlan({ ...PEERS, resolver: "172.20.0.4", gateway: "172.21.0.1" });

  it("gives the option --owners only to a plan with owners, and reads it back", () => {
    expect(agentArgs(plan)).not.toContain("--owners");
    expect(agentArgs(where)).toContain("--owners");
    expect(parseAgentArgs(agentArgs(where))).toEqual(where);
  });

  it("grants the hosts of the lookups by name only with owners, so the scope permits the peers of the two probes", () => {
    const hosts = lookupGrants(LOOKUP_REASON).map((grant) => `${grant.host} ${grant.basis}`);
    expect(hosts).toEqual(["data.iana.org named", ...RDAP_REGISTRIES.map((host) => `${host} named`), `${CYMRU_ZONES.ipv4} named`, `${CYMRU_ZONES.ipv6} named`]);
    expect(visitInputOf(where).grants).toEqual([...visitInputOf(plan).grants, ...lookupGrants(LOOKUP_REASON)]);
    expect(visitInputOf(plan).grants.every((grant) => grant.kind === "range")).toBe(true);
    const peers = [
      ...ownerProbe(refuseRdap).peers({ addresses: ["172.21.0.1", "8.8.8.8"] }),
      ...originProbe(refuseTxt).peers({ addresses: ["172.21.0.1", "8.8.8.8", "2001:4860::8888"], resolver: "172.20.0.4" }),
    ];
    const scopeOfPlan = (agent: AgentPlan) => {
      const scope = scopeOf(visitInputOf(agent).grants);
      if (scope.tag === "err") throw new Error(scope.error.join(" "));
      return scope.value;
    };
    for (const peer of peers) expect(decideScope(scopeOfPlan(where), peer).allowed, peer.host).toBe(true);
    expect(peers.filter((peer) => !decideScope(scopeOfPlan(plan), peer).allowed).map((peer) => peer.host)).toContain("data.iana.org");
  });

  it("refuses an empty scope and a port that is not a number", () => {
    const args = agentArgs(plan);
    expect(() => parseAgentArgs(args.filter((arg) => !arg.endsWith("/32") && arg !== "--grant"))).toThrow(RangeError);
    expect(() => parseAgentArgs(args.map((arg) => (arg === "443" ? "https" : arg)))).toThrow(RangeError);
  });

  const fact = (id: string, host: string): Fact => ({
    id,
    kind: "tcp.connect",
    layer: "tcp",
    subject: { host, kind: "ipv4", port: 443 },
    time: { start: 0, end: 1 },
    source: { probe: "tcp", version: "1" },
    value: { address: host, port: 443, family: 4, outcome: "connected", ms: 1 },
  });

  it("reads the facts of the target as primary, and keeps the problems", () => {
    const lines: AgentLine[] = [
      { ev: "fact", t: 1, role: "target", host: KERNEL_TARGET_NAME, fact: fact("f1", PEERS.target) },
      { ev: "fact", t: 2, role: "reference", host: KERNEL_REFERENCE_NAME, fact: fact("f2", PEERS.reference) },
      { ev: "problem", t: 3, role: "reference", host: KERNEL_REFERENCE_NAME, problem: "The ping of x did not end." },
      { ev: "done", t: 4 },
    ];
    const visit = visitOf(JSON.parse(JSON.stringify(lines)) as AgentLine[]);
    if (visit.status !== "visited") throw new Error("no visit");
    expect(visit.facts.map((each) => each.id)).toEqual(["f1", "f2"]);
    expect(visit.facts.map((each) => visit.read.primary?.(each))).toEqual([true, false]);
    expect(visit.problems).toEqual(["The ping of x did not end."]);
    expect(visit.read.gateway).toBeUndefined();
    expect(visit.steps).toEqual([
      { kind: "fact", role: "target", host: KERNEL_TARGET_NAME, fact: fact("f1", PEERS.target) },
      { kind: "fact", role: "reference", host: KERNEL_REFERENCE_NAME, fact: fact("f2", PEERS.reference) },
      { kind: "problem", role: "reference", host: KERNEL_REFERENCE_NAME, problem: "The ping of x did not end." },
    ]);
  });

  it("keeps no step of a line with no host, and gives a problem for it", () => {
    const lines = [
      { ev: "fact", t: 1, role: "target", fact: fact("f1", PEERS.target) },
      { ev: "problem", t: 2, role: "target", problem: "The ping of x did not end." },
      { ev: "done", t: 3 },
    ];
    const visit = visitOf(lines);
    if (visit.status !== "visited") throw new Error("no visit");
    expect(visit.steps).toEqual([]);
    expect(visit.problems).toHaveLength(2);
    expect(visit.problems[1]).toBe("The agent wrote a problem line that is not valid.");
  });

  it("reads the facts of the roles local and gateway as facts that are not primary, and keeps the gateway", () => {
    const lines: AgentLine[] = [
      { ev: "fact", t: 1, role: "local", host: "172.21.0.1", fact: fact("f1", "172.21.0.1") },
      { ev: "fact", t: 2, role: "gateway", host: "172.21.0.1", fact: fact("f2", "172.21.0.1") },
      { ev: "done", t: 3 },
    ];
    const visit = visitOf(JSON.parse(JSON.stringify(lines)) as AgentLine[], undefined, "172.21.0.1");
    if (visit.status !== "visited") throw new Error("no visit");
    expect(visit.facts.map((each) => visit.read.primary?.(each))).toEqual([false, false]);
    expect(visit.read.gateway).toBe("172.21.0.1");
    expect(visit.problems).toEqual([]);
  });

  it("gives a problem for no line done and for a line that is not valid, and no visit for a line fail", () => {
    const partial = visitOf([{ ev: "fact", role: "target", fact: { id: "f1" } } as { ev: string }], "no done or fail from the client in 120000 ms");
    expect(partial.status === "visited" && partial.problems.length).toBe(2);
    expect(partial.status === "visited" && partial.problems[1]).toBe("The agent did not end: no done or fail from the client in 120000 ms");
    expect(visitOf([{ ev: "fail", t: 1, why: "no root" } as AgentLine])).toEqual({ status: "no-visit", reason: "The agent failed: no root" });
  });
});

describe("the world as data", () => {
  it("answers the two names from the zone, and reads the zone argument back", () => {
    const zone = kernelZone(PEERS);
    expect(zone).toEqual({ [KERNEL_TARGET_NAME]: { rcode: 0, a: [PEERS.target] }, [KERNEL_REFERENCE_NAME]: { rcode: 0, a: [PEERS.reference] } });
    expect(parseZoneArg(zoneArg(zone))).toEqual(zone);
    expect(() => parseZoneArg(Buffer.from('{"x":{"rcode":"no"}}').toString("base64"))).toThrow(RangeError);
  });

  it("builds the image from files that exist, and the Dockerfile copies only them, on the pinned base", () => {
    for (const file of IMAGE_FILES) expect(existsSync(join(REPOSITORY_ROOT, file)), file).toBe(true);
    const dockerfile = readFileSync(join(REPOSITORY_ROOT, "packages/lab/kernel/Dockerfile"), "utf8");
    expect(dockerfile).toContain(`FROM ${NODE_IMAGE}\n`);
    const sources = [...dockerfile.matchAll(/^COPY (.+) \S+$/gm)].flatMap((match) => match[1]!.split(" "));
    for (const source of sources) expect(IMAGE_FILES, source).toContain(source);
  });

  it("starts the target script from its file on the stock image", () => {
    const target = kernelTarget("script", { key: "k", cert: "c" });
    expect(target.image).toBe(NODE_IMAGE);
    expect(target.files).toEqual({ "/srv/https.ts": "script" });
    expect(parseHttpsArgs(target.command!.slice(2))).toEqual({ port: 443, key: "k", cert: "c" });
  });
});

describe("the HTTPS host and the agent on loopback addresses", () => {
  let ca: Authority;
  let folder: string;
  beforeAll(async () => {
    ca = await authority("netdiag kernel test root");
    folder = mkdtempSync(join(tmpdir(), "netdiag-kernel-"));
  }, 60_000);
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("serves each request with the status 200", async () => {
    const pems = await ca.issue(["127.0.0.2"]);
    const host = await startHttps(parseHttpsArgs(httpsArgs({ port: 0, ...pems })), "127.0.0.2");
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        get({ host: "127.0.0.2", port: host.port, ca: ca.cert, agent: false }, (response) => {
          response.resume();
          resolve(response.statusCode);
        }).on("error", reject);
      });
      expect(status).toBe(200);
    } finally {
      await host.close();
    }
  });

  it("writes a line fail for arguments that are not valid", async () => {
    const lines: AgentLine[] = [];
    await startAgent(["--target"], { tools: fakeToolHost<ToolRunOptions>("linux", []), clock: realClock, write: (line) => lines.push(line) });
    expect(lines.map((line) => line.ev)).toEqual(["fail"]);
  });

  it("writes a line for each step of the visit, then the line done", async () => {
    const pems = await ca.issue([KERNEL_TARGET_NAME]);
    const host = await startHttps({ port: 0, ...pems }, "127.0.0.2");
    const dns = await startDnsServer({ zone: { [KERNEL_TARGET_NAME]: { rcode: 0, a: ["127.0.0.2"] } }, host: "127.0.0.1" });
    const root = join(folder, "root.pem");
    writeFileSync(root, ca.cert);
    try {
      const base = kernelPlan({ target: "127.0.0.2", reference: "127.0.0.3", resolver: "127.0.0.1", gateway: "127.0.0.4" });
      const plan: AgentPlan = { ...base, port: host.port, references: [], resolverPort: dns.port, pingCount: 0, root };
      const tools = fakeToolHost<ToolRunOptions>("linux", []);
      const lines: AgentLine[] = [];
      await startAgent(agentArgs(plan), { tools, clock: realClock, write: (line) => lines.push(line) });
      expect(lines.map((line) => (line.ev === "fact" ? `${line.role} ${line.fact.kind}` : line.ev))).toEqual([
        "local link.state",
        "target dns.answer",
        "target dns.answer",
        "target tcp.connect",
        "target tls.handshake",
        "target http.response",
        "done",
      ]);
      const response = lines.find((line) => line.ev === "fact" && line.fact.kind === "http.response");
      expect(response?.ev === "fact" && response.fact.value).toMatchObject({ status: 200 });
      expect(tools.calls).toEqual([]);
    } finally {
      await dns.close();
      await host.close();
    }
  });

  it("looks up the owner and the origin of each hop with owners, and each private hop gets the outcome special", async () => {
    const pems = await ca.issue(["127.0.0.2"]);
    const host = await startHttps({ port: 0, ...pems }, "127.0.0.2");
    const root = join(folder, "root-owners.pem");
    writeFileSync(root, ca.cert);
    try {
      const base = wherePlan({ target: "127.0.0.2", reference: "127.0.0.3", resolver: "127.0.0.1", gateway: "127.0.0.4" });
      const plan: AgentPlan = { ...base, port: host.port, mtrCycles: 2, root };
      const hubs = ["127.0.0.4", "127.0.0.2"].map((address, index) => ({ count: index + 1, host: address, "Loss%": 0, Snt: 2, Last: 0.5, Best: 0.4, Avg: 0.6, Wrst: 1.2, StDev: 0.1 }));
      const report = JSON.stringify({ report: { mtr: { src: "lab", dst: "127.0.0.2", tos: 0, tests: 2 }, hubs } });
      const rules: FakeRule[] = [
        [(args, command) => command === "mtr" && args[0] === "--version", { exitCode: 0, stdout: "mtr 0.95\n", stderr: "" }],
        [(args, command) => command === "mtr" && args[0] === "--json", { exitCode: 0, stdout: report, stderr: "" }],
      ];
      const tools = fakeToolHost<ToolRunOptions>("linux", rules);
      const lines: AgentLine[] = [];
      await startAgent(agentArgs(plan), { tools, clock: realClock, write: (line) => lines.push(line) });
      expect(lines.filter((line) => line.ev === "problem" || line.ev === "fail")).toEqual([]);
      const lookups = lines.flatMap((line) =>
        line.ev === "fact" && (line.fact.kind === "path.owner" || line.fact.kind === "path.origin") ? [`${line.role} ${line.fact.kind} ${JSON.stringify(line.fact.value)}`] : [],
      );
      expect(lookups).toEqual([
        'target path.owner {"address":"127.0.0.4","outcome":"special","class":"loopback"}',
        'target path.owner {"address":"127.0.0.2","outcome":"special","class":"loopback"}',
        'target path.origin {"address":"127.0.0.4","outcome":"special","class":"loopback"}',
        'target path.origin {"address":"127.0.0.2","outcome":"special","class":"loopback"}',
      ]);
      expect(tools.calls.map((call) => `${call.command} ${call.args[0] ?? ""}`)).toEqual(["mtr --version", "mtr --json"]);
    } finally {
      await host.close();
    }
  });

  it("refuses each lookup that leaves the lab", async () => {
    const request = { host: "rdap.arin.net", url: "https://rdap.arin.net/registry/ip/8.8.8.8", headers: {}, what: "the network of 8.8.8.8" };
    await expect(refuseRdap(request, new AbortController().signal)).rejects.toThrow("The kernel lab sends no request to rdap.arin.net.");
    const query = { name: "8.8.8.8.origin.asn.cymru.com", resolver: "172.20.0.4", port: 53, timeoutMs: 1000 };
    await expect(refuseTxt(query, new AbortController().signal)).resolves.toEqual({ outcome: "refused", records: [] });
  });
});
