import { fakeClock, type FakeClock } from "@mark1russell7/algebra/clock";
import { fakeToolHost, type FakeRule, type FakeToolHost } from "@netdiag/fixtures";
import { describe, expect, it } from "vitest";
import { ICMP_ECHO, createRunner, scopeOf, type Fact, type IcmpEcho, type Runner } from "../index.ts";
import { TOOL_LICENSES, captureProbe, iperf3Probe, mtrProbe, mtuProbe, pingCommand, pingProbe, readPing, toolLicense, tracerouteProbe, type ToolOutput, type ToolRaw, type ToolRunOptions } from "./index.ts";

// The samples of Windows come from ping.exe of Windows 11. The samples of Linux (iputils) and macOS follow the formats
// of these tools, with documentation addresses.

const WINDOWS_REPLY = [
  "",
  "Pinging 127.0.0.1 with 32 bytes of data:",
  "Reply from 127.0.0.1: bytes=32 time<1ms TTL=128",
  "Reply from 127.0.0.1: bytes=32 time=3ms TTL=128",
  "",
  "Ping statistics for 127.0.0.1:",
  "    Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),",
  "Approximate round trip times in milli-seconds:",
  "    Minimum = 0ms, Maximum = 3ms, Average = 1ms",
].join("\r\n");

const WINDOWS_NONE = [
  "",
  "Pinging 192.0.2.1 with 32 bytes of data:",
  "Request timed out.",
  "Request timed out.",
  "",
  "Ping statistics for 192.0.2.1:",
  "    Packets: Sent = 2, Received = 0, Lost = 2 (100% loss),",
].join("\r\n");

const WINDOWS_V6 = ["", "Pinging ::1 with 32 bytes of data:", "Reply from ::1: time<1ms ", "", "Ping statistics for ::1:", "    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),"].join("\r\n");

const WINDOWS_UNREACHABLE = [
  "",
  "Pinging 192.0.2.9 with 32 bytes of data:",
  "Reply from 192.0.2.5: Destination host unreachable.",
  "Reply from 192.0.2.5: Destination host unreachable.",
  "",
  "Ping statistics for 192.0.2.9:",
  "    Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),",
].join("\r\n");

const WINDOWS_FAILURE = [
  "",
  "Pinging 192.0.2.9 with 32 bytes of data:",
  "PING: transmit failed. General failure. ",
  "PING: transmit failed. General failure. ",
  "",
  "Ping statistics for 192.0.2.9:",
  "    Packets: Sent = 2, Received = 0, Lost = 2 (100% loss),",
].join("\r\n");

const WINDOWS_GERMAN = ["", "Ping wird ausgeführt für 192.0.2.1 mit 32 Bytes Daten:", "Antwort von 192.0.2.1: Bytes=32 Zeit=3ms TTL=64", "", "Ping-Statistik für 192.0.2.1:", "    Pakete: Gesendet = 1, Empfangen = 1, Verloren = 0"].join("\r\n");

const LINUX_REPLY = `PING 192.0.2.1 (192.0.2.1) 56(84) bytes of data.
64 bytes from 192.0.2.1: icmp_seq=1 ttl=64 time=0.045 ms
64 bytes from 192.0.2.1: icmp_seq=2 ttl=64 time=0.051 ms
64 bytes from 192.0.2.1: icmp_seq=2 ttl=64 time=0.090 ms (DUP!)
64 bytes from 192.0.2.1: icmp_seq=3 ttl=64 time=0.062 ms

--- 192.0.2.1 ping statistics ---
4 packets transmitted, 3 received, +1 duplicates, 25% packet loss, time 601ms
rtt min/avg/max/mdev = 0.045/0.062/0.090/0.017 ms
`;

const LINUX_V6 = `PING 2001:db8::1 (2001:db8::1) 56 data bytes
64 bytes from 2001:db8::1: icmp_seq=1 ttl=64 time=0.040 ms

--- 2001:db8::1 ping statistics ---
1 packets transmitted, 1 received, 0% packet loss, time 0ms
`;

const LINUX_NONE = `PING 192.0.2.1 (192.0.2.1) 56(84) bytes of data.

--- 192.0.2.1 ping statistics ---
3 packets transmitted, 0 received, 100% packet loss, time 2047ms
`;

const LINUX_UNREACHABLE = `PING 192.0.2.9 (192.0.2.9) 56(84) bytes of data.
From 192.0.2.5 icmp_seq=1 Destination Host Unreachable
From 192.0.2.5 icmp_seq=2 Destination Host Unreachable

--- 192.0.2.9 ping statistics ---
2 packets transmitted, 0 received, +2 errors, 100% packet loss, time 1030ms
`;

const LINUX_V6_UNREACHABLE = `PING 2001:db8::9 (2001:db8::9) 56 data bytes
From 2001:db8::5 icmp_seq=1 Destination unreachable: Address unreachable

--- 2001:db8::9 ping statistics ---
1 packets transmitted, 0 received, +1 errors, 100% packet loss, time 0ms
`;

const DARWIN_REPLY = `PING 192.0.2.1 (192.0.2.1): 56 data bytes
64 bytes from 192.0.2.1: icmp_seq=0 ttl=64 time=0.052 ms
Request timeout for icmp_seq 1
64 bytes from 192.0.2.1: icmp_seq=2 ttl=64 time=0.068 ms

--- 192.0.2.1 ping statistics ---
3 packets transmitted, 2 packets received, 33.3% packet loss
round-trip min/avg/max/stddev = 0.052/0.060/0.068/0.008 ms
`;

const DARWIN_V6 = `PING6(56=40+8+8 bytes) 2001:db8::2 --> 2001:db8::1
16 bytes from 2001:db8::1, icmp_seq=0 hlim=64 time=0.123 ms

--- 2001:db8::1 ping6 statistics ---
1 packets transmitted, 1 packets received, 0.0% packet loss
round-trip min/avg/max/std-dev = 0.123/0.123/0.123/0.000 ms
`;

const DARWIN_UNREACHABLE = `PING 192.0.2.9 (192.0.2.9): 56 data bytes
92 bytes from 192.0.2.5: Destination Host Unreachable
Vr HL TOS  Len   ID Flg  off TTL Pro  cks      Src      Dst
 4  5  00 5400 1c2b   0 0000  40  01 d6c3 192.0.2.2  192.0.2.9

--- 192.0.2.9 ping statistics ---
1 packets transmitted, 0 packets received, 100.0% packet loss
`;

function raw(platform: string, stdout: string, more: Partial<ToolRaw> = {}): ToolRaw {
  return { platform, command: "ping", args: [], start: 0, end: 1, exitCode: 0, stdout, stderr: "", ...more };
}

function read(platform: string, stdout: string, more: Partial<ToolRaw> = {}, address = "192.0.2.1"): IcmpEcho {
  const value = readPing(raw(platform, stdout, more), address);
  expect(ICMP_ECHO.check(value), JSON.stringify(value)).toBe(true);
  return value;
}

describe("pingCommand", () => {
  it("gives the argument list of each operating system, with no shell", () => {
    expect(pingCommand("linux", { address: "192.0.2.1" })).toEqual({
      command: "ping",
      args: ["-n", "-c", "4", "-i", "0.2", "-W", "1", "-w", "3", "192.0.2.1"],
      timeoutMs: 6000,
      env: { LC_ALL: "C" },
    });
    expect(pingCommand("darwin", { address: "192.0.2.1", count: 20, waitMs: 500 })).toEqual({
      command: "ping",
      args: ["-n", "-c", "20", "-i", "0.2", "-W", "500", "-t", "6", "192.0.2.1"],
      timeoutMs: 9000,
      env: { LC_ALL: "C" },
    });
    expect(pingCommand("darwin", { address: "2001:db8::1", count: 2 })).toEqual({ command: "ping6", args: ["-n", "-c", "2", "2001:db8::1"], timeoutMs: 14_000, env: { LC_ALL: "C" } });
    expect(pingCommand("win32", { address: "::1", count: 2, waitMs: 500 })).toEqual({ command: "ping", args: ["-n", "2", "-w", "500", "::1"], timeoutMs: 5500 });
  });

  it("gives no command for an operating system that it does not know", () => {
    expect(pingCommand("freebsd", { address: "192.0.2.1" })).toBeUndefined();
  });

  it("refuses a name, a count and a wait out of range", () => {
    expect(() => pingCommand("linux", { address: "example.com" })).toThrow(/not an IP address/);
    expect(() => pingCommand("linux", { address: "192.0.2.1", count: 0 })).toThrow(RangeError);
    expect(() => pingCommand("linux", { address: "192.0.2.1", count: 101 })).toThrow(RangeError);
    expect(() => pingCommand("linux", { address: "192.0.2.1", count: 1.5 })).toThrow(RangeError);
    expect(() => pingCommand("linux", { address: "192.0.2.1", waitMs: 0 })).toThrow(RangeError);
  });
});

describe("readPing", () => {
  it("reads the replies of Windows, and counts time<1ms as 1 ms", () => {
    expect(read("win32", WINDOWS_REPLY, {}, "127.0.0.1")).toEqual({ address: "127.0.0.1", outcome: "reply", sent: 2, received: 2, rttMs: [1, 3], ttl: 128 });
    expect(read("win32", WINDOWS_V6, {}, "::1")).toEqual({ address: "::1", outcome: "reply", sent: 1, received: 1, rttMs: [1] });
    expect(read("win32", WINDOWS_NONE)).toEqual({ address: "192.0.2.1", outcome: "none", sent: 2, received: 0, rttMs: [] });
  });

  it("does not count a message of an unreachable address as a reply on Windows", () => {
    expect(read("win32", WINDOWS_UNREACHABLE, {}, "192.0.2.9")).toEqual({
      address: "192.0.2.9",
      outcome: "unreachable",
      sent: 2,
      received: 0,
      rttMs: [],
      from: "192.0.2.5",
      detail: "Destination host unreachable",
    });
  });

  it("gives an error for a failure to send, and for output in another language", () => {
    expect(read("win32", WINDOWS_FAILURE)).toMatchObject({ outcome: "error", detail: "transmit failed. General failure." });
    expect(read("win32", WINDOWS_GERMAN)).toMatchObject({ outcome: "error", detail: expect.stringContaining("English") });
  });

  it("reads iputils, with no duplicate in the replies", () => {
    expect(read("linux", LINUX_REPLY)).toEqual({ address: "192.0.2.1", outcome: "reply", sent: 4, received: 3, rttMs: [0.045, 0.051, 0.062], ttl: 64 });
    expect(read("linux", LINUX_V6, {}, "2001:db8::1")).toMatchObject({ outcome: "reply", sent: 1, received: 1, rttMs: [0.04], ttl: 64 });
    expect(read("linux", LINUX_NONE, { exitCode: 1 })).toEqual({ address: "192.0.2.1", outcome: "none", sent: 3, received: 0, rttMs: [] });
  });

  it("reads the messages of an unreachable address of iputils, IPv4 and IPv6", () => {
    expect(read("linux", LINUX_UNREACHABLE, { exitCode: 1 }, "192.0.2.9")).toMatchObject({ outcome: "unreachable", sent: 2, received: 0, from: "192.0.2.5", detail: "Destination Host Unreachable" });
    expect(read("linux", LINUX_V6_UNREACHABLE, { exitCode: 1 }, "2001:db8::9")).toMatchObject({ outcome: "unreachable", from: "2001:db8::5", detail: "Destination unreachable: Address unreachable" });
  });

  it("reads a local route failure, a failure to send and a warning on stderr", () => {
    expect(read("linux", "", { exitCode: 2, stderr: "ping: connect: Network is unreachable\n" })).toEqual({
      address: "192.0.2.1",
      outcome: "unreachable",
      sent: 0,
      received: 0,
      rttMs: [],
      detail: "Network is unreachable",
    });
    expect(read("linux", "", { exitCode: 2, stderr: "ping: socket: Operation not permitted\n" })).toMatchObject({ outcome: "error", detail: "socket: Operation not permitted" });
    expect(read("linux", LINUX_NONE, { exitCode: 1, stderr: "ping: sendmsg: Operation not permitted\n" })).toMatchObject({ outcome: "error", detail: "sendmsg: Operation not permitted" });
    expect(read("linux", LINUX_NONE, { exitCode: 1, stderr: "ping: Warning: source address might be selected on device other than: eth0\n" })).toMatchObject({ outcome: "none" });
  });

  it("reads the ping and the ping6 of macOS", () => {
    expect(read("darwin", DARWIN_REPLY)).toEqual({ address: "192.0.2.1", outcome: "reply", sent: 3, received: 2, rttMs: [0.052, 0.068], ttl: 64 });
    expect(read("darwin", DARWIN_V6, {}, "2001:db8::1")).toMatchObject({ outcome: "reply", sent: 1, received: 1, rttMs: [0.123], ttl: 64 });
    expect(read("darwin", DARWIN_UNREACHABLE, { exitCode: 2 }, "192.0.2.9")).toMatchObject({ outcome: "unreachable", sent: 1, from: "192.0.2.5", detail: "Destination Host Unreachable" });
    expect(read("darwin", "", { exitCode: 2, stderr: "ping: sendto: No route to host\n" })).toMatchObject({ outcome: "unreachable", sent: 0, detail: "No route to host" });
  });

  it("gives an error for a tool that does not start, a time limit and output that does not agree", () => {
    expect(read("linux", "", { exitCode: 1, error: "spawn ping ENOENT" })).toMatchObject({ outcome: "error", detail: "spawn ping ENOENT" });
    const cut = LINUX_REPLY.split("\n").slice(0, 3).join("\n");
    expect(read("linux", cut, { exitCode: 1, timedOut: true })).toMatchObject({ outcome: "error", received: 0, detail: expect.stringContaining("time limit") });
    expect(read("linux", LINUX_REPLY.replace("4 packets transmitted", "2 packets transmitted"))).toMatchObject({ outcome: "error", detail: expect.stringContaining("3 replies to 2 requests") });
  });
});

/** A fake host that moves the clock by 25 ms for each command. */
function fakeHost(platform: string, clock: FakeClock, rules: readonly FakeRule[]): FakeToolHost<ToolRunOptions> {
  return fakeToolHost<ToolRunOptions>(platform, rules, async () => {
    await clock.advance(25);
  });
}

function runnerOf(clock: FakeClock): Runner {
  const scope = scopeOf([{ kind: "range", cidr: "192.0.2.0/24", basis: "owned" }]);
  if (scope.tag === "err") throw new Error(scope.error.join(" "));
  return createRunner({ scope: scope.value, clock });
}

const VERSION: FakeRule =[(args) => args[0] === "-V", { exitCode: 0, stdout: "ping from iputils 20240117\n", stderr: "" }];

describe("the probe icmp.ping", () => {
  it("gives one fact icmp.echo with the times of the clock and the tool in its source", async () => {
    const clock = fakeClock(1000);
    const host = fakeHost("linux", clock, [VERSION, [(args) => args.includes("192.0.2.1"), { exitCode: 0, stdout: LINUX_REPLY, stderr: "" }]]);
    const outcome = await runnerOf(clock).run(pingProbe(host), { address: "192.0.2.1" });
    if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
    const [fact] = outcome.facts as Fact<IcmpEcho>[];
    expect(fact).toMatchObject({ kind: "icmp.echo", layer: "ip", subject: { host: "192.0.2.1", kind: "ipv4" }, source: { probe: "icmp.ping", version: "1", tool: "ping" } });
    expect(fact?.value).toMatchObject({ outcome: "reply", sent: 4, received: 3 });
    expect(fact?.time).toEqual({ start: 1025, end: 1050 });
    expect(host.calls.map((call) => [call.command, call.args, call.options.env])).toEqual([
      ["ping", ["-V"], { LC_ALL: "C" }],
      ["ping", ["-n", "-c", "4", "-i", "0.2", "-W", "1", "-w", "3", "192.0.2.1"], { LC_ALL: "C" }],
    ]);
    expect(host.calls[1]?.options.timeoutMs).toBe(6000);
  });

  it("tells the version of iputils, and refuses another ping on Linux", async () => {
    const clock = fakeClock();
    const context = { clock, signal: new AbortController().signal };
    expect(await pingProbe(fakeHost("linux", clock, [VERSION])).available(context)).toEqual({ available: true, version: "20240117" });
    const old: ToolOutput = { exitCode: 0, stdout: "ping utility, iputils-s20161105\n", stderr: "" };
    expect(await pingProbe(fakeHost("linux", clock, [[() => true, old]])).available(context)).toEqual({ available: true, version: "20161105" });
    const busybox: ToolOutput = { exitCode: 1, stdout: "", stderr: "ping: unrecognized option '-V'\nBusyBox v1.36.1 multi-call binary.\n" };
    expect(await pingProbe(fakeHost("linux", clock, [[() => true, busybox]])).available(context)).toMatchObject({ available: false, reason: expect.stringContaining("iputils") });
  });

  it("tells that ping is not available when it does not start, or on an operating system that it does not know", async () => {
    const clock = fakeClock();
    const context = { clock, signal: new AbortController().signal };
    const missing = fakeHost("win32", clock, [[() => true, { exitCode: 1, stdout: "", stderr: "", error: "spawn ping ENOENT" }]]);
    expect(await pingProbe(missing).available(context)).toEqual({ available: false, reason: "The tool ping does not start: spawn ping ENOENT" });
    expect(await pingProbe(fakeHost("win32", clock, [[(args) => args[0] === "/?", { exitCode: 0, stdout: "Usage: ping [-t] [-a]", stderr: "" }]])).available(context)).toEqual({ available: true });
    const other = fakeHost("freebsd", clock, []);
    expect(await pingProbe(other).available(context)).toMatchObject({ available: false });
    expect(other.calls).toEqual([]);
  });

  it("starts no command for an address out of the scope, or for a name", async () => {
    const clock = fakeClock();
    const host = fakeHost("linux", clock, [VERSION]);
    const runner = runnerOf(clock);
    expect(await runner.run(pingProbe(host), { address: "198.51.100.1" })).toMatchObject({ status: "refused" });
    expect(await runner.run(pingProbe(host), { address: "example.com" })).toMatchObject({ status: "failed", stage: "probe" });
    expect(host.calls).toEqual([]);
  });
});

describe("the licenses of the tools", () => {
  it("have one row for each tool, and each probe of an adapter in the row of its tool", () => {
    const tools = TOOL_LICENSES.map((row) => row.tool);
    expect(new Set(tools).size).toBe(tools.length);
    const host = fakeHost("linux", fakeClock(), []);
    const probes = [pingProbe(host), mtuProbe(host), tracerouteProbe(host), mtrProbe(host), iperf3Probe(host), captureProbe(host)];
    for (const probe of probes) {
      const row = toolLicense(probe.tool ?? "");
      expect(row?.use).toBe("adapter");
      expect(row?.probes).toContain(probe.id);
    }
    for (const row of TOOL_LICENSES) if (row.use === "not-bundled") expect(row.probes).toEqual([]);
    // Each row of an adapter names one or more probes of this list, and no other probe. No adapter is only a plan.
    const ids = probes.map((probe) => probe.id);
    for (const row of TOOL_LICENSES) {
      if (row.use !== "adapter") continue;
      expect(row.probes.length).toBeGreaterThan(0);
      for (const id of row.probes) expect(ids).toContain(id);
    }
  });
});
