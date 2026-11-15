import { fakeClock } from "@mark1russell7/algebra/clock";
import { describe, expect, it } from "vitest";
import {
  LAYERS,
  createRunner,
  decideScope,
  defineFactKind,
  defineProbe,
  factsOf,
  formatTarget,
  isLayer,
  layerRank,
  namedGrant,
  observe,
  parseTarget,
  resolvedGrant,
  scopeOf,
  target,
  type Grant,
  type Probe,
  type Scope,
} from "./index.ts";

function scope(grants: readonly Grant[], maxPortsPerHost?: number): Scope {
  const made = scopeOf(grants, maxPortsPerHost === undefined ? {} : { maxPortsPerHost });
  if (made.tag === "err") throw new Error(made.error.join(" "));
  return made.value;
}

function parsed(text: string): ReturnType<typeof target> {
  const result = parseTarget(text);
  if (result.tag === "err") throw new Error(result.error);
  return result.value;
}

describe("the layers", () => {
  it("go from the link to HTTP, each one time", () => {
    expect(LAYERS[0]).toBe("link");
    expect(LAYERS.at(-1)).toBe("http");
    expect(new Set(LAYERS).size).toBe(LAYERS.length);
    expect(layerRank("dns")).toBeLessThan(layerRank("tcp"));
    expect(layerRank("tcp")).toBeLessThan(layerRank("tls"));
    expect(isLayer("tls")).toBe(true);
    expect(isLayer("smtp")).toBe(false);
  });
});

describe("parseTarget", () => {
  it.each([
    ["example.com", { host: "example.com", kind: "name" }],
    ["Example.COM.", { host: "example.com", kind: "name" }],
    ["example.com:8443", { host: "example.com", kind: "name", port: 8443 }],
    ["https://example.com/a?b", { host: "example.com", kind: "name", port: 443 }],
    ["http://example.com:8080", { host: "example.com", kind: "name", port: 8080 }],
    ["192.0.2.10", { host: "192.0.2.10", kind: "ipv4" }],
    ["192.0.2.10:53", { host: "192.0.2.10", kind: "ipv4", port: 53 }],
    ["2001:db8::1", { host: "2001:db8::1", kind: "ipv6" }],
    ["[2001:db8::1]:443", { host: "2001:db8::1", kind: "ipv6", port: 443 }],
    ["https://[2001:db8::1]/", { host: "2001:db8::1", kind: "ipv6", port: 443 }],
    ["_dns._tcp.example.com", { host: "_dns._tcp.example.com", kind: "name" }],
  ])("reads %s", (text, expected) => {
    expect(parseTarget(text)).toEqual({ tag: "ok", value: expected });
  });

  it.each(["", "  ", "example.com:0", "example.com:70000", "example.com:http", "bad host", "-a.example.com", "[192.0.2.1]:80", "https://"])(
    "refuses %j",
    (text) => {
      expect(parseTarget(text).tag).toBe("err");
    },
  );

  it("writes a target back as text", () => {
    expect(formatTarget(parsed("[2001:db8::1]:443"))).toBe("[2001:db8::1]:443");
    expect(formatTarget(parsed("example.com:80"))).toBe("example.com:80");
    expect(formatTarget(parsed("2001:db8::1"))).toBe("2001:db8::1");
  });
});

describe("the scope", () => {
  const named = namedGrant(parsed("example.com"));
  const owned: Grant = { kind: "range", cidr: "192.168.1.0/24", basis: "owned", note: "the home network" };
  const owned6: Grant = { kind: "range", cidr: "2001:db8:aa::/48", basis: "owned" };
  const zone: Grant = { kind: "host", host: "lab.test", subdomains: true, basis: "owned" };
  const s = scope([named, owned, owned6, zone]);

  it("allows a named host, and not a different host", () => {
    expect(decideScope(s, target("example.com", 443))).toEqual({ allowed: true, grant: named });
    expect(decideScope(s, target("www.example.com", 443)).allowed).toBe(false);
    expect(decideScope(s, target("example.org", 443)).allowed).toBe(false);
  });

  it("allows the names under a host grant with subdomains", () => {
    expect(decideScope(s, target("a.b.lab.test")).allowed).toBe(true);
    expect(decideScope(s, target("lab.test")).allowed).toBe(true);
    expect(decideScope(s, target("notlab.test")).allowed).toBe(false);
  });

  it("allows the addresses of an owned range, in each family", () => {
    expect(decideScope(s, target("192.168.1.254", 80)).allowed).toBe(true);
    expect(decideScope(s, target("192.168.2.1", 80)).allowed).toBe(false);
    expect(decideScope(s, target("2001:db8:aa::5")).allowed).toBe(true);
    expect(decideScope(s, target("2001:db8:ab::5")).allowed).toBe(false);
  });

  it("does not match an address against a host grant, or a name against a range", () => {
    const byName = scope([{ kind: "host", host: "router.home", basis: "configured" }]);
    expect(decideScope(byName, target("192.168.1.1")).allowed).toBe(false);
    expect(decideScope(scope([owned]), target("router.home")).allowed).toBe(false);
  });

  it("gives a reason in plain words for a refusal", () => {
    const decision = decideScope(s, target("example.org", 443));
    expect(decision).toEqual({ allowed: false, reason: "example.org:443 is not in the scope. Name it, or add a grant for a network that you own." });
  });

  it("refuses a new port after the limit of ports of a host", () => {
    const small = scope([named], 2);
    const ledger = new Map([["example.com", new Set([80, 443])]]);
    expect(decideScope(small, target("example.com", 443), ledger).allowed).toBe(true);
    const decision = decideScope(small, target("example.com", 22), ledger);
    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? "" : decision.reason).toContain("no port scan");
  });

  it("puts one address of a resolved name in the scope", () => {
    expect(resolvedGrant("Example.com.", "192.0.2.10", "f3")).toEqual({
      kind: "range",
      cidr: "192.0.2.10/32",
      basis: "resolved",
      note: "example.com resolved to it (fact f3)",
    });
    expect(resolvedGrant("example.com", "2001:db8::1").cidr).toBe("2001:db8::1/128");
    expect(() => resolvedGrant("example.com", "example.net")).toThrow(RangeError);
  });

  it("gives a named address one address of range", () => {
    expect(namedGrant(parsed("192.0.2.7"))).toEqual({ kind: "range", cidr: "192.0.2.7/32", basis: "named", note: undefined });
  });

  it("refuses a grant with a problem, so a typing error cannot widen the scope", () => {
    expect(scopeOf([{ kind: "range", cidr: "192.168.1.0/33", basis: "owned" }]).tag).toBe("err");
    expect(scopeOf([{ kind: "range", cidr: "192.168.1/24", basis: "owned" }]).tag).toBe("err");
    expect(scopeOf([{ kind: "host", host: "192.0.2.1", basis: "owned" }]).tag).toBe("err");
    expect(scopeOf([{ kind: "host", host: " ", basis: "owned" }]).tag).toBe("err");
    expect(scopeOf([], { maxPortsPerHost: 0 }).tag).toBe("err");
  });
});

interface Connect {
  readonly outcome: "connected" | "refused" | "timeout";
}

const connectKind = defineFactKind<Connect>({
  kind: "test.connect",
  layer: "tcp",
  summary: "A test connect.",
  check: (value): value is Connect =>
    typeof value === "object" && value !== null && ["connected", "refused", "timeout"].includes((value as { outcome?: unknown }).outcome as string),
});

interface Input {
  readonly host: string;
  readonly port: number;
  readonly answer?: string;
}

function probe(overrides: Partial<Probe<Input, string>> = {}): Probe<Input, string> & { runs: number } {
  const counted = {
    runs: 0,
    ...defineProbe<Input, string>({
      id: "test.connect",
      version: "1",
      summary: "A connect that gives the answer of its input.",
      layer: "tcp",
      mode: "active",
      kinds: [connectKind],
      peers: (input) => [target(input.host, input.port)],
      available: () => Promise.resolve({ available: true }),
      run: (input) => {
        counted.runs += 1;
        return Promise.resolve(input.answer ?? "connected");
      },
      parse: (raw, input) => [observe(connectKind, target(input.host, input.port), { outcome: raw as Connect["outcome"] })],
      ...overrides,
    }),
  };
  return counted;
}

describe("the runner", () => {
  it("stamps each fact with an id, the layer of its kind, its source and the time of the run", async () => {
    const clock = fakeClock(1000);
    const runner = createRunner({ scope: scope([namedGrant(target("example.com"))]), clock, wall: "2026-11-15T12:00:00.000Z" });
    expect(runner.origin).toEqual({ wall: "2026-11-15T12:00:00.000Z", monotonic: 1000 });
    const p = probe({ run: async () => { await clock.advance(25); return "timeout"; } });
    const first = runner.run(p, { host: "example.com", port: 443 });
    const outcome = await first;
    expect(outcome.status).toBe("done");
    expect(runner.facts()).toEqual([
      {
        id: "f1",
        kind: "test.connect",
        layer: "tcp",
        subject: { host: "example.com", kind: "name", port: 443 },
        time: { start: 1000, end: 1025 },
        source: { probe: "test.connect", version: "1" },
        value: { outcome: "timeout" },
      },
    ]);
    await runner.run(probe(), { host: "example.com", port: 80 });
    expect(runner.facts().map((fact) => fact.id)).toEqual(["f1", "f2"]);
    expect(factsOf(connectKind, runner.facts())).toHaveLength(2);
  });

  it("refuses an active probe to a peer out of the scope, and does not start it", async () => {
    const runner = createRunner({ scope: scope([]), clock: fakeClock() });
    const p = probe();
    const outcome = await runner.run(p, { host: "example.com", port: 443 });
    expect(outcome).toEqual({
      status: "refused",
      peer: { host: "example.com", kind: "name", port: 443 },
      reason: "example.com:443 is not in the scope. Name it, or add a grant for a network that you own.",
    });
    expect(p.runs).toBe(0);
    expect(runner.facts()).toEqual([]);
  });

  it("starts a probe after a grant puts its peer in the scope", async () => {
    const runner = createRunner({ scope: scope([namedGrant(target("example.com"))]), clock: fakeClock() });
    expect((await runner.run(probe(), { host: "192.0.2.10", port: 443 })).status).toBe("refused");
    runner.grant([resolvedGrant("example.com", "192.0.2.10", "f1")]);
    expect((await runner.run(probe(), { host: "192.0.2.10", port: 443 })).status).toBe("done");
    expect(() => runner.grant([{ kind: "range", cidr: "nonsense", basis: "owned" }])).toThrow(RangeError);
  });

  it("holds the limit of ports across runs, also for runs at the same time", async () => {
    const runner = createRunner({ scope: scope([namedGrant(target("example.com"))], 2), clock: fakeClock() });
    const outcomes = await Promise.all([80, 443, 22, 80].map((port) => runner.run(probe(), { host: "example.com", port })));
    expect(outcomes.map((o) => o.status)).toEqual(["done", "done", "refused", "done"]);
  });

  it("starts a passive probe with no scope, and refuses a passive probe with peers", async () => {
    const runner = createRunner({ scope: scope([]), clock: fakeClock() });
    const passive = probe({ mode: "passive", peers: () => [] });
    expect((await runner.run(passive, { host: "example.com", port: 1 })).status).toBe("done");
    const wrong = probe({ mode: "passive" });
    const outcome = await runner.run(wrong, { host: "example.com", port: 1 });
    expect(outcome.status).toBe("failed");
    expect(wrong.runs).toBe(0);
  });

  it("refuses an active probe with no peer", async () => {
    const runner = createRunner({ scope: scope([]), clock: fakeClock() });
    const outcome = await runner.run(probe({ peers: () => [] }), { host: "example.com", port: 1 });
    expect(outcome).toMatchObject({ status: "failed", stage: "probe" });
  });

  it("does not start an unavailable probe", async () => {
    const runner = createRunner({ scope: scope([namedGrant(target("example.com"))]), clock: fakeClock() });
    const p = probe({ available: () => Promise.resolve({ available: false, reason: "mtr is not installed." }) });
    expect(await runner.run(p, { host: "example.com", port: 443 })).toEqual({ status: "unavailable", reason: "mtr is not installed." });
    expect(p.runs).toBe(0);
  });

  it("tells the stage of a fault, and keeps the raw output of a parse fault", async () => {
    const runner = createRunner({ scope: scope([namedGrant(target("example.com"))]), clock: fakeClock() });
    const input = { host: "example.com", port: 443 };
    expect(await runner.run(probe({ run: () => Promise.reject(new Error("socket bug")) }), input)).toEqual({
      status: "failed",
      stage: "run",
      error: "socket bug",
    });
    expect(
      await runner.run(
        probe({
          parse: () => {
            throw new Error("bad line");
          },
        }),
        input,
      ),
    ).toEqual({ status: "failed", stage: "parse", error: "bad line", raw: "connected" });
    expect(await runner.run(probe(), { ...input, answer: "maybe" })).toMatchObject({ status: "failed", stage: "parse", raw: "maybe" });
    expect(runner.facts()).toEqual([]);
  });

  it("refuses an observation of a kind that the probe does not declare", async () => {
    const other = defineFactKind<number>({ kind: "test.other", layer: "dns", summary: "", check: (v): v is number => typeof v === "number" });
    const runner = createRunner({ scope: scope([namedGrant(target("example.com"))]), clock: fakeClock() });
    const outcome = await runner.run(probe({ parse: (_raw, input) => [observe(other, target(input.host), 1)] }), { host: "example.com", port: 443 });
    expect(outcome).toMatchObject({ status: "failed", stage: "parse" });
  });

  it("stops at a signal that aborted before or during the run", async () => {
    const runner = createRunner({ scope: scope([namedGrant(target("example.com"))]), clock: fakeClock() });
    const before = new AbortController();
    before.abort(new Error("the user stopped it"));
    const p = probe();
    expect(await runner.run(p, { host: "example.com", port: 443 }, before.signal)).toEqual({ status: "aborted", reason: "the user stopped it" });
    expect(p.runs).toBe(0);
    const during = new AbortController();
    const stopped = probe({
      run: () => {
        during.abort();
        return Promise.reject(new Error("aborted"));
      },
    });
    expect((await runner.run(stopped, { host: "example.com", port: 443 }, during.signal)).status).toBe("aborted");
  });

  it("refuses a probe or a kind with a bad name", () => {
    expect(() => defineFactKind({ kind: "Bad Kind", layer: "tcp", summary: "", check: (_v): _v is unknown => true })).toThrow(RangeError);
    expect(() => probe({ id: "Bad" })).toThrow(RangeError);
    expect(() => probe({ kinds: [] })).toThrow(RangeError);
  });

  it("gives facts that a JSON record keeps with no change", async () => {
    const runner = createRunner({ scope: scope([namedGrant(target("example.com"))]), clock: fakeClock() });
    await runner.run(probe(), { host: "example.com", port: 443 });
    const facts = runner.facts();
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });
});
