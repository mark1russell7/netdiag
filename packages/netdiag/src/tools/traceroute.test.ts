import { fakeClock } from "@mark1russell7/algebra/clock";
import { fakeToolHost, type FakeRule } from "@netdiag/fixtures";
import { describe, expect, it } from "vitest";
import { PATH_TRACE, createRunner, scopeOf, type Fact, type PathTrace } from "../index.ts";
import { readTraceroute, tracerouteCommand, tracerouteProbe, type ToolRaw, type ToolRunOptions } from "./index.ts";

// The samples of Windows come from tracert.exe of Windows 11. The samples of Linux (the Modern traceroute) and macOS
// follow the formats of these tools, with documentation addresses.

const WINDOWS_LOOPBACK = "\r\nTracing route to 127.0.0.1 over a maximum of 3 hops\r\n\r\n  1    <1 ms    <1 ms    <1 ms  127.0.0.1 \r\n\r\nTrace complete.\r\n";
const WINDOWS_V6 = "\r\nTracing route to ::1 over a maximum of 3 hops\r\n\r\n  1    <1 ms    <1 ms    <1 ms  ::1 \r\n\r\nTrace complete.\r\n";
const WINDOWS_GATEWAY = "\r\nTracing route to 192.168.1.1 over a maximum of 3 hops\r\n\r\n  1     2 ms     1 ms     1 ms  192.168.1.1 \r\n\r\nTrace complete.\r\n";
const WINDOWS_UNREACHABLE =
  "\r\nTracing route to 192.168.1.250 over a maximum of 2 hops\r\n\r\n  1     *        *        *     Request timed out.\r\n  2     *        *     192.168.1.191  reports: Destination host unreachable.\r\n\r\nTrace complete.\r\n";
const WINDOWS_FAILURE = "\r\nTracing route to 192.0.2.9 over a maximum of 30 hops\r\n\r\n  1  General failure. \r\n\r\nTrace complete.\r\n";
const WINDOWS_GERMAN = "\r\nRoutenverfolgung zu 192.0.2.1 über maximal 30 Hops\r\n\r\n  1    <1 ms    <1 ms    <1 ms  192.0.2.1 \r\n\r\nAblaufverfolgung beendet.\r\n";

const LINUX_REACHED = `traceroute to 192.0.2.1 (192.0.2.1), 30 hops max, 60 byte packets
 1  192.0.2.254  0.512 ms  0.480 ms  0.470 ms
 2  * * *
 3  198.51.100.1  5.123 ms 198.51.100.2  5.300 ms  5.200 ms
 4  192.0.2.1  10.100 ms  10.050 ms *
`;

const LINUX_UNREACHABLE = `traceroute to 192.0.2.9 (192.0.2.9), 30 hops max, 60 byte packets
 1  192.0.2.254  0.512 ms  0.480 ms  0.470 ms
 2  192.0.2.254  3001.123 ms !H  3001.100 ms !H  *
`;

const LINUX_STOPPED = `traceroute to 192.0.2.9 (192.0.2.9), 3 hops max, 60 byte packets
 1  192.0.2.254  0.512 ms  0.480 ms  0.470 ms
 2  * * *
 3  * * *
`;

const LINUX_V6 = `traceroute to 2001:db8::1 (2001:db8::1), 30 hops max, 80 byte packets
 1  2001:db8::fe  0.300 ms  0.250 ms  0.240 ms
 2  2001:db8::1  1.100 ms  1.000 ms  0.900 ms !<10>
`;

const DARWIN_HEADER = "traceroute to 192.0.2.1 (192.0.2.1), 64 hops max, 52 byte packets\n";
const DARWIN_REACHED = ` 1  192.0.2.254  1.234 ms  1.100 ms  1.050 ms
 2  198.51.100.1  5.123 ms
    198.51.100.2  5.300 ms  5.200 ms
 3  192.0.2.1  10.100 ms  10.050 ms  10.000 ms
`;

function raw(platform: string, stdout: string, more: Partial<ToolRaw> = {}): ToolRaw {
  return { platform, command: "traceroute", args: [], start: 0, end: 1, exitCode: 0, stdout, stderr: "", ...more };
}

function read(platform: string, stdout: string, more: Partial<ToolRaw> = {}, address = "192.0.2.1", maxHops?: number): PathTrace {
  const value = readTraceroute(raw(platform, stdout, more), { address, maxHops });
  expect(PATH_TRACE.check(value), JSON.stringify(value)).toBe(true);
  return value;
}

describe("tracerouteCommand", () => {
  it("gives the argument list of each operating system, with no shell", () => {
    expect(tracerouteCommand("linux", { address: "192.0.2.1" })).toEqual({
      command: "traceroute",
      args: ["-4", "-n", "-q", "3", "-w", "1", "-m", "30", "192.0.2.1"],
      timeoutMs: 93_000,
      env: { LC_ALL: "C" },
    });
    expect(tracerouteCommand("linux", { address: "2001:DB8::1", maxHops: 5, waitMs: 1500 })?.args).toEqual(["-6", "-n", "-q", "3", "-w", "2", "-m", "5", "2001:db8::1"]);
    expect(tracerouteCommand("darwin", { address: "192.0.2.1", maxHops: 4 })).toMatchObject({ command: "traceroute", args: ["-n", "-q", "3", "-w", "1", "-m", "4", "192.0.2.1"] });
    expect(tracerouteCommand("darwin", { address: "2001:db8::1" })?.command).toBe("traceroute6");
    expect(tracerouteCommand("win32", { address: "192.0.2.1", maxHops: 2, waitMs: 500 })).toEqual({ command: "tracert", args: ["-d", "-h", "2", "-w", "500", "192.0.2.1"], timeoutMs: 6000 });
  });

  it("gives no command for an operating system that it does not know, and refuses a name and a TTL out of range", () => {
    expect(tracerouteCommand("freebsd", { address: "192.0.2.1" })).toBeUndefined();
    expect(() => tracerouteCommand("linux", { address: "example.com" })).toThrow(TypeError);
    expect(() => tracerouteCommand("linux", { address: "192.0.2.1", maxHops: 65 })).toThrow(RangeError);
    expect(() => tracerouteCommand("linux", { address: "192.0.2.1", waitMs: 0 })).toThrow(RangeError);
  });
});

describe("readTraceroute", () => {
  it("reads tracert, with the address after the times, and counts <1 ms as 1 ms", () => {
    expect(read("win32", WINDOWS_LOOPBACK, {}, "127.0.0.1")).toEqual({
      address: "127.0.0.1",
      outcome: "reached",
      maxHops: 30,
      hops: [{ ttl: 1, addresses: ["127.0.0.1"], sent: 3, received: 3, rttMs: [1, 1, 1] }],
    });
    expect(read("win32", WINDOWS_V6, {}, "::1")).toMatchObject({ outcome: "reached", hops: [{ addresses: ["::1"], received: 3 }] });
    expect(read("win32", WINDOWS_GATEWAY, {}, "192.168.1.1")).toMatchObject({ outcome: "reached", hops: [{ rttMs: [2, 1, 1] }] });
  });

  it("reads the report of an unreachable address of tracert as one answer", () => {
    expect(read("win32", WINDOWS_UNREACHABLE, {}, "192.168.1.250", 2)).toEqual({
      address: "192.168.1.250",
      outcome: "unreachable",
      maxHops: 2,
      hops: [
        { ttl: 1, addresses: [], sent: 3, received: 0, rttMs: [] },
        { ttl: 2, addresses: ["192.168.1.191"], sent: 3, received: 1, rttMs: [], unreachable: "Destination host unreachable" },
      ],
      detail: "Destination host unreachable",
    });
  });

  it("gives an error for a failure to send of tracert, and for output in another language", () => {
    expect(read("win32", WINDOWS_FAILURE, {}, "192.0.2.9")).toMatchObject({ outcome: "error", detail: "General failure" });
    expect(read("win32", WINDOWS_GERMAN)).toMatchObject({ outcome: "error", hops: [], detail: expect.stringContaining("English") });
    expect(read("win32", WINDOWS_LOOPBACK.replace("Trace complete.", ""), { timedOut: true }, "127.0.0.1")).toMatchObject({ outcome: "error", hops: [{ ttl: 1 }] });
  });

  it("reads the Modern traceroute, with two routers of one TTL and a lost probe", () => {
    const trace = read("linux", LINUX_REACHED);
    expect(trace.outcome).toBe("reached");
    expect(trace.hops).toEqual([
      { ttl: 1, addresses: ["192.0.2.254"], sent: 3, received: 3, rttMs: [0.512, 0.48, 0.47] },
      { ttl: 2, addresses: [], sent: 3, received: 0, rttMs: [] },
      { ttl: 3, addresses: ["198.51.100.1", "198.51.100.2"], sent: 3, received: 3, rttMs: [5.123, 5.3, 5.2] },
      { ttl: 4, addresses: ["192.0.2.1"], sent: 3, received: 2, rttMs: [10.1, 10.05] },
    ]);
    expect(read("linux", LINUX_V6, {}, "2001:db8::1")).toMatchObject({ outcome: "reached", hops: [{ ttl: 1 }, { ttl: 2, unreachable: "unreachable, ICMP code 10 (!<10>)" }] });
  });

  it("reads the flags of an unreachable address, a path that stops, and a local route failure", () => {
    expect(read("linux", LINUX_UNREACHABLE, {}, "192.0.2.9")).toMatchObject({ outcome: "unreachable", detail: "host unreachable (!H)", hops: [{ ttl: 1 }, { ttl: 2, sent: 3, received: 2 }] });
    expect(read("linux", LINUX_STOPPED, {}, "192.0.2.9", 3)).toMatchObject({ outcome: "stopped", hops: [{ ttl: 1 }, { ttl: 2 }, { ttl: 3 }] });
    const local = read("linux", "traceroute to 192.0.2.9 (192.0.2.9), 30 hops max, 60 byte packets\n", { exitCode: 1, stderr: "connect: Network is unreachable\n" }, "192.0.2.9");
    expect(local).toEqual({ address: "192.0.2.9", outcome: "unreachable", maxHops: 30, hops: [], detail: "Network is unreachable" });
    const failure = read("linux", "", { exitCode: 1, stderr: "traceroute to 192.0.2.9 (192.0.2.9), 30 hops max\nsendto: Operation not permitted\n" }, "192.0.2.9");
    expect(failure).toMatchObject({ outcome: "error", detail: "sendto: Operation not permitted" });
  });

  it("reads macOS, with the header on stderr and another router of a TTL on a line with no number", () => {
    const trace = read("darwin", DARWIN_REACHED, { stderr: DARWIN_HEADER });
    expect(trace.outcome).toBe("reached");
    expect(trace.hops[1]).toEqual({ ttl: 2, addresses: ["198.51.100.1", "198.51.100.2"], sent: 3, received: 3, rttMs: [5.123, 5.3, 5.2] });
  });

  it("gives an error for a tool that does not start, a time limit, and a time with no address", () => {
    expect(read("linux", "", { exitCode: 1, error: "spawn traceroute ENOENT" })).toMatchObject({ outcome: "error", hops: [], detail: "spawn traceroute ENOENT" });
    const cut = LINUX_REACHED.split("\n").slice(0, 3).join("\n");
    expect(read("linux", cut, { exitCode: 1, timedOut: true })).toMatchObject({ outcome: "error", hops: [{ ttl: 1 }, { ttl: 2 }], detail: expect.stringContaining("time limit") });
    const unread = `traceroute to 192.0.2.1 (192.0.2.1), 30 hops max\n 1  192.0.2.254  0.5 ms\n 2  0.512 ms  * *\n`;
    expect(read("linux", unread)).toMatchObject({ outcome: "error", hops: [{ ttl: 1 }], detail: "netdiag cannot read the hop 2 of traceroute." });
  });

  // A pattern that can backtrack takes minutes on these lines, so the time limit of the test stops it (CodeQL, ReDoS).
  it("reads long hostile lines", () => {
    const spaces = " ".repeat(50_000);
    expect(read("linux", `traceroute to 192.0.2.1 (192.0.2.1), 30 hops max\n 1${spaces}\rx`).outcome).toBe("stopped");
    expect(read("win32", `Tracing route to 192.0.2.1\r\n 1  *${spaces}reports:${spaces}x${spaces} `).outcome).toBe("error");
    expect(read("win32", `Tracing route to 192.0.2.1\r\n 1  *${spaces}x\r\nTrace complete.`).outcome).toBe("stopped");
  });
});

describe("the probe path.traceroute", () => {
  it("gives one fact path.trace with the tool in its source", async () => {
    const clock = fakeClock(1000);
    const version: FakeRule = [(args) => args[0] === "--version", { exitCode: 0, stdout: "Modern traceroute for Linux, version 2.1.5\nCopyright (c) 2016  Dmitry Butskoy\n", stderr: "" }];
    const host = fakeToolHost<ToolRunOptions>("linux", [version, [(args) => args.includes("192.0.2.1"), { exitCode: 0, stdout: LINUX_REACHED, stderr: "" }]], async () => {
      await clock.advance(25);
    });
    const scope = scopeOf([{ kind: "range", cidr: "192.0.2.0/24", basis: "owned" }]);
    if (scope.tag === "err") throw new Error(scope.error.join(" "));
    const outcome = await createRunner({ scope: scope.value, clock }).run(tracerouteProbe(host), { address: "192.0.2.1" });
    if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
    const [fact] = outcome.facts as Fact<PathTrace>[];
    expect(fact).toMatchObject({ kind: "path.trace", layer: "path", source: { probe: "path.traceroute", tool: "traceroute" }, value: { outcome: "reached" } });
    expect(host.calls.map((call) => call.command)).toEqual(["traceroute", "traceroute"]);
  });

  it("tells the version of the Modern traceroute, and refuses another traceroute on Linux", async () => {
    const clock = fakeClock();
    const context = { clock, signal: new AbortController().signal };
    const modern: FakeRule = [() => true, { exitCode: 0, stdout: "Modern traceroute for Linux, version 2.1.5\n", stderr: "" }];
    expect(await tracerouteProbe(fakeToolHost("linux", [modern])).available(context)).toEqual({ available: true, version: "2.1.5" });
    const inetutils: FakeRule = [() => true, { exitCode: 0, stdout: "traceroute (GNU inetutils) 2.5\n", stderr: "" }];
    expect(await tracerouteProbe(fakeToolHost("linux", [inetutils])).available(context)).toMatchObject({ available: false, reason: expect.stringContaining("Modern traceroute") });
    const usage: FakeRule = [() => true, { exitCode: 64, stdout: "", stderr: "usage: traceroute [-adDeFInrSvx] host\n" }];
    expect(await tracerouteProbe(fakeToolHost("darwin", [usage])).available(context)).toEqual({ available: true });
    expect(await tracerouteProbe(fakeToolHost("freebsd", [])).available(context)).toMatchObject({ available: false });
  });
});
