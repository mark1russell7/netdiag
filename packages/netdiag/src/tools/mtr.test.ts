import { fakeClock } from "@mark1russell7/algebra/clock";
import { fakeToolHost, type FakeRule } from "@netdiag/fixtures";
import { describe, expect, it } from "vitest";
import { PATH_REPORT, createRunner, scopeOf, type Fact, type PathReport } from "../index.ts";
import { mtrCommand, mtrProbe, readMtr, type ToolRaw, type ToolRunOptions } from "./index.ts";

// The samples follow the JSON report of mtr 0.95 (the count is a number) and of mtr 0.92 (the count is a text), with
// documentation addresses.

interface Hub {
  readonly count: number | string;
  readonly host: string;
  readonly "Loss%": number;
  readonly Snt: number;
  readonly Best?: number;
  readonly Avg?: number;
  readonly Wrst?: number;
}

function json(dst: string, hubs: readonly Hub[]): string {
  return JSON.stringify({ report: { mtr: { src: "lab", dst, tos: 0, tests: 20, psize: "64", bitpattern: "0x00" }, hubs } }, null, 2);
}

const times = { Last: 0.5, Best: 0.4, Avg: 0.6, Wrst: 1.2, StDev: 0.1 };
const silent = { Last: 0, Best: 0, Avg: 0, Wrst: 0, StDev: 0 };

const REACHED = json("192.0.2.1", [
  { count: 1, host: "192.0.2.254", "Loss%": 0, Snt: 20, ...times },
  { count: 2, host: "???", "Loss%": 100, Snt: 20, ...silent },
  { count: 3, host: "192.0.2.1", "Loss%": 5, Snt: 20, ...times },
]);

const STOPPED = json("192.0.2.9", [
  { count: "1", host: "192.0.2.254", "Loss%": 0, Snt: 20, ...times },
  { count: "2", host: "???", "Loss%": 100, Snt: 20, ...silent },
]);

function raw(stdout: string, more: Partial<ToolRaw> = {}): ToolRaw {
  return { platform: "linux", command: "mtr", args: [], start: 0, end: 1, exitCode: 0, stdout, stderr: "", ...more };
}

function read(stdout: string, more: Partial<ToolRaw> = {}, address = "192.0.2.1"): PathReport {
  const value = readMtr(raw(stdout, more), { address });
  expect(PATH_REPORT.check(value), JSON.stringify(value)).toBe(true);
  return value;
}

describe("mtrCommand", () => {
  it("gives the argument list on Linux and macOS, with no shell, and no command on Windows", () => {
    expect(mtrCommand("linux", { address: "192.0.2.1" })).toEqual({
      command: "mtr",
      args: ["--json", "--no-dns", "-4", "-c", "20", "-m", "30", "192.0.2.1"],
      timeoutMs: 28_000,
      env: { LC_ALL: "C" },
    });
    expect(mtrCommand("darwin", { address: "2001:DB8::1", cycles: 5, maxHops: 8 })?.args).toEqual(["--json", "--no-dns", "-6", "-c", "5", "-m", "8", "2001:db8::1"]);
    expect(mtrCommand("win32", { address: "192.0.2.1" })).toBeUndefined();
  });

  it("refuses a name and a number of cycles out of range", () => {
    expect(() => mtrCommand("linux", { address: "example.com" })).toThrow(TypeError);
    expect(() => mtrCommand("linux", { address: "192.0.2.1", cycles: 101 })).toThrow(RangeError);
    expect(() => mtrCommand("linux", { address: "192.0.2.1", cycles: 1.5 })).toThrow(RangeError);
  });
});

describe("readMtr", () => {
  it("reads the hubs of a report that reached the address, with the answers from the loss", () => {
    expect(read(REACHED)).toEqual({
      address: "192.0.2.1",
      outcome: "reached",
      cycles: 20,
      hops: [
        { ttl: 1, address: "192.0.2.254", sent: 20, received: 20, bestMs: 0.4, meanMs: 0.6, worstMs: 1.2 },
        { ttl: 2, sent: 20, received: 0 },
        { ttl: 3, address: "192.0.2.1", sent: 20, received: 19, bestMs: 0.4, meanMs: 0.6, worstMs: 1.2 },
      ],
    });
  });

  it("reads the count as a text (mtr 0.92), and gives stopped when the last hub is not the address", () => {
    expect(read(STOPPED, {}, "192.0.2.9")).toMatchObject({ outcome: "stopped", hops: [{ ttl: 1 }, { ttl: 2, received: 0 }] });
  });

  it("gives an error for a tool that does not start, a time limit, and a report that it cannot read", () => {
    expect(read("", { exitCode: 1, error: "spawn mtr ENOENT" })).toEqual({ address: "192.0.2.1", outcome: "error", cycles: 20, hops: [], detail: "spawn mtr ENOENT" });
    expect(read(REACHED.slice(0, 40), { timedOut: true })).toMatchObject({ outcome: "error", detail: expect.stringContaining("time limit") });
    expect(read("", { exitCode: 1, stderr: "mtr: Failure to open IPv4 sockets: Permission denied\n" })).toMatchObject({ outcome: "error", detail: "mtr: Failure to open IPv4 sockets: Permission denied" });
    expect(read(json("192.0.2.1", []))).toMatchObject({ outcome: "error", detail: "The report of mtr has no hub." });
    const hidden = json("192.0.2.1", [{ count: 1, host: "???", "Loss%": 50, Snt: 20 }]);
    expect(read(hidden)).toMatchObject({ outcome: "error", detail: "netdiag cannot read the hub 1 of the report of mtr." });
    const order = json("192.0.2.1", [
      { count: 2, host: "192.0.2.254", "Loss%": 0, Snt: 20, ...times },
      { count: 1, host: "192.0.2.1", "Loss%": 0, Snt: 20, ...times },
    ]);
    expect(read(order)).toMatchObject({ outcome: "error", detail: expect.stringContaining("order") });
  });
});

describe("the probe path.mtr", () => {
  it("gives one fact path.report with the tool in its source", async () => {
    const clock = fakeClock(1000);
    const version: FakeRule = [(args) => args[0] === "--version", { exitCode: 0, stdout: "mtr 0.95\n", stderr: "" }];
    const host = fakeToolHost<ToolRunOptions>("linux", [version, [(args) => args.includes("192.0.2.1"), { exitCode: 0, stdout: REACHED, stderr: "" }]], async () => {
      await clock.advance(25);
    });
    const scope = scopeOf([{ kind: "range", cidr: "192.0.2.0/24", basis: "owned" }]);
    if (scope.tag === "err") throw new Error(scope.error.join(" "));
    const outcome = await createRunner({ scope: scope.value, clock }).run(mtrProbe(host), { address: "192.0.2.1" });
    if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
    const [fact] = outcome.facts as Fact<PathReport>[];
    expect(fact).toMatchObject({ kind: "path.report", layer: "path", source: { probe: "path.mtr", tool: "mtr" }, value: { outcome: "reached" } });
    expect(host.calls[1]?.options.timeoutMs).toBe(28_000);
  });

  it("tells the version of mtr, and that mtr is not available on Windows", async () => {
    const clock = fakeClock();
    const context = { clock, signal: new AbortController().signal };
    const version: FakeRule = [() => true, { exitCode: 0, stdout: "mtr 0.95\n", stderr: "" }];
    expect(await mtrProbe(fakeToolHost("darwin", [version])).available(context)).toEqual({ available: true, version: "0.95" });
    const windows = fakeToolHost("win32", [version]);
    expect(await mtrProbe(windows).available(context)).toMatchObject({ available: false, reason: expect.stringContaining("win32") });
    expect(windows.calls).toEqual([]);
  });
});
