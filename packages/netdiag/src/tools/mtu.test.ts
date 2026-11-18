import { fakeClock, type FakeClock } from "@mark1russell7/algebra/clock";
import { fakeToolHost, type FakeRule, type FakeToolHost } from "@netdiag/fixtures";
import { describe, expect, it } from "vitest";
import { PATH_MTU, createRunner, scopeOf, type Fact, type PathMtu, type Runner } from "../index.ts";
import { DEFAULT_MTU_COUNT, ECHO_HEADER_BYTES, mtuCommand, mtuProbe, readMtuTry, type ToolOutput, type ToolRaw, type ToolRunOptions } from "./index.ts";

// The samples of Windows follow ping.exe of Windows 11. The samples of Linux (iputils) and macOS follow the formats in
// the source of each ping.

const LINUX_REPLY = `PING 192.0.2.1 (192.0.2.1) 1172(1200) bytes of data.
1180 bytes from 192.0.2.1: icmp_seq=1 ttl=63 time=1.21 ms
1180 bytes from 192.0.2.1: icmp_seq=3 ttl=63 time=1.30 ms

--- 192.0.2.1 ping statistics ---
3 packets transmitted, 2 received, 33.3333% packet loss, time 402ms
`;

const LINUX_FRAG = `PING 192.0.2.1 (192.0.2.1) 1472(1500) bytes of data.
From 192.0.2.254 icmp_seq=1 Frag needed and DF set (mtu = 1400)

--- 192.0.2.1 ping statistics ---
3 packets transmitted, 0 received, +3 errors, 100% packet loss, time 405ms
`;

const LINUX_LOCAL = "ping: local error: message too long, mtu=1400\nping: local error: message too long, mtu=1400\n";

const LINUX_V6 = `PING 2001:db8::1(2001:db8::1) 1452 data bytes
From 2001:db8::fe icmp_seq=1 Packet too big: mtu=1280

--- 2001:db8::1 ping statistics ---
3 packets transmitted, 0 received, +1 errors, 100% packet loss, time 405ms
`;

const LINUX_SILENT = `PING 192.0.2.1 (192.0.2.1) 1472(1500) bytes of data.

--- 192.0.2.1 ping statistics ---
3 packets transmitted, 0 received, 100% packet loss, time 2040ms
`;

const LINUX_UNREACHABLE = `PING 192.0.2.1 (192.0.2.1) 1472(1500) bytes of data.
From 192.0.2.254 icmp_seq=1 Destination Host Unreachable

--- 192.0.2.1 ping statistics ---
3 packets transmitted, 0 received, +1 errors, 100% packet loss, time 2040ms
`;

const MAC_FRAG = `PING 192.0.2.1 (192.0.2.1): 1472 data bytes
36 bytes from 192.0.2.254: frag needed and DF set (MTU 1400)
Vr HL TOS  Len   ID Flg  off TTL Pro  cks      Src      Dst
 4  5  00 dc05 1234   0 0000  40  01 0000 192.0.2.10  192.0.2.1

--- 192.0.2.1 ping statistics ---
3 packets transmitted, 0 packets received, 100.0% packet loss
`;

const MAC_SILENT = `PING 192.0.2.1 (192.0.2.1): 1472 data bytes

--- 192.0.2.1 ping statistics ---
3 packets transmitted, 0 packets received, 100.0% packet loss
`;

const WINDOWS_LOCAL = [
  "",
  "Pinging 192.0.2.1 with 1472 bytes of data:",
  "Packet needs to be fragmented but DF set.",
  "Packet needs to be fragmented but DF set.",
  "Packet needs to be fragmented but DF set.",
  "",
  "Ping statistics for 192.0.2.1:",
  "    Packets: Sent = 3, Received = 0, Lost = 3 (100% loss),",
  "",
].join("\r\n");

// Windows counts a message from a router as a received packet. A message is not a reply.
const WINDOWS_ROUTER = [
  "",
  "Pinging 192.0.2.1 with 1472 bytes of data:",
  "Reply from 192.0.2.254: Packet needs to be fragmented but DF set.",
  "Reply from 192.0.2.254: Packet needs to be fragmented but DF set.",
  "Reply from 192.0.2.254: Packet needs to be fragmented but DF set.",
  "",
  "Ping statistics for 192.0.2.1:",
  "    Packets: Sent = 3, Received = 3, Lost = 0 (0% loss),",
  "",
].join("\r\n");

const WINDOWS_REPLY = [
  "",
  "Pinging 192.0.2.1 with 1372 bytes of data:",
  "Reply from 192.0.2.1: bytes=1372 time=12ms TTL=118",
  "Reply from 192.0.2.1: bytes=1372 time=11ms TTL=118",
  "Reply from 192.0.2.1: bytes=1372 time=12ms TTL=118",
  "",
  "Ping statistics for 192.0.2.1:",
  "    Packets: Sent = 3, Received = 3, Lost = 0 (0% loss),",
  "",
].join("\r\n");

const ok = (stdout: string, stderr = ""): ToolOutput => ({ exitCode: 0, stdout, stderr });
const failed = (stdout: string, stderr = ""): ToolOutput => ({ exitCode: 1, stdout, stderr });

function rawOf(platform: string, output: ToolOutput, address = "192.0.2.1"): ToolRaw {
  return { ...output, platform, command: "ping", args: [address], start: 0, end: 1 };
}

describe("the command of ping with do not fragment", () => {
  it("gives the payload of each size and the time limits on Linux", () => {
    expect(mtuCommand("linux", { address: "192.0.2.1" }, 1500)).toEqual({
      command: "ping",
      args: ["-n", "-M", "do", "-s", "1472", "-c", "3", "-i", "0.2", "-W", "1", "-w", "3", "192.0.2.1"],
      timeoutMs: 6000,
      env: { LC_ALL: "C" },
    });
    expect(mtuCommand("linux", { address: "2001:db8::1" }, 1400)?.args).toContain(String(1400 - ECHO_HEADER_BYTES.ipv6));
    const slow = mtuCommand("linux", { address: "192.0.2.1", count: 5, waitMs: 2000 }, 1000);
    expect(slow?.args).toEqual(["-n", "-M", "do", "-s", "972", "-c", "5", "-i", "0.2", "-W", "2", "-w", "4", "192.0.2.1"]);
    expect(slow?.timeoutMs).toBe(7000);
  });

  it("gives the command of macOS and Windows for IPv4 only", () => {
    expect(mtuCommand("darwin", { address: "192.0.2.1" }, 1500)).toEqual({
      command: "ping",
      args: ["-n", "-D", "-s", "1472", "-c", "3", "-i", "0.2", "-W", "1000", "-t", "3", "192.0.2.1"],
      timeoutMs: 6000,
      env: { LC_ALL: "C" },
    });
    expect(mtuCommand("win32", { address: "192.0.2.1" }, 1500)).toEqual({ command: "ping", args: ["-n", "3", "-w", "1000", "-f", "-l", "1472", "192.0.2.1"], timeoutMs: 7000 });
    expect(mtuCommand("darwin", { address: "2001:db8::1" }, 1500)).toBeUndefined();
    expect(mtuCommand("win32", { address: "2001:db8::1" }, 1500)).toBeUndefined();
    expect(mtuCommand("freebsd", { address: "192.0.2.1" }, 1500)).toBeUndefined();
  });

  it("refuses a size out of the bounds, a name and limits that are not valid", () => {
    expect(mtuCommand("linux", { address: "192.0.2.1", ceiling: 9000 }, 9000)?.args).toContain("8972");
    // A search over IPv6 tries a plain echo request of 104 bytes when 1280 bytes fail.
    expect(mtuCommand("linux", { address: "2001:db8::1" }, 104)?.args).toContain("56");
    for (const [input, size] of [
      [{ address: "192.0.2.1" }, 67],
      [{ address: "192.0.2.1" }, 1501],
      [{ address: "2001:db8::1" }, 103],
      [{ address: "example.com" }, 1500],
      [{ address: "192.0.2.1", count: 0 }, 1500],
      [{ address: "192.0.2.1", count: 11 }, 1500],
      [{ address: "192.0.2.1", ceiling: 9217 }, 1500],
      [{ address: "2001:db8::1", ceiling: 1000 }, 1000],
    ] as const) {
      expect(() => mtuCommand("linux", input, size), JSON.stringify(input)).toThrow();
    }
  });
});

describe("readMtuTry", () => {
  it("gives a reply for one echo reply", () => {
    expect(readMtuTry(rawOf("linux", ok(LINUX_REPLY)), 1200)).toEqual({ size: 1200, result: "reply" });
    expect(readMtuTry(rawOf("win32", ok(WINDOWS_REPLY)), 1400)).toEqual({ size: 1400, result: "reply" });
  });

  it("reads the message of a router with its MTU and its address", () => {
    expect(readMtuTry(rawOf("linux", failed(LINUX_FRAG, LINUX_LOCAL)), 1500)).toEqual({
      size: 1500,
      result: "too-big",
      mtu: 1400,
      from: "192.0.2.254",
      detail: "From 192.0.2.254 icmp_seq=1 Frag needed and DF set (mtu = 1400)",
    });
    expect(readMtuTry(rawOf("linux", failed(LINUX_V6), "2001:db8::1"), 1500)).toMatchObject({ result: "too-big", mtu: 1280, from: "2001:db8::fe" });
    expect(readMtuTry(rawOf("darwin", failed(MAC_FRAG)), 1500)).toMatchObject({ result: "too-big", mtu: 1400, from: "192.0.2.254" });
    expect(readMtuTry(rawOf("win32", ok(WINDOWS_ROUTER)), 1500)).toEqual({
      size: 1500,
      result: "too-big",
      from: "192.0.2.254",
      detail: "Reply from 192.0.2.254: Packet needs to be fragmented but DF set.",
    });
  });

  it("reads the local errors of a packet that is too large for the interface", () => {
    expect(readMtuTry(rawOf("linux", failed(LINUX_SILENT, LINUX_LOCAL)), 1500)).toEqual({
      size: 1500,
      result: "too-big",
      mtu: 1400,
      detail: "local error: message too long, mtu=1400",
    });
    expect(readMtuTry(rawOf("darwin", failed(MAC_SILENT, "ping: sendto: Message too long\n")), 1500)).toEqual({ size: 1500, result: "too-big", detail: "sendto: Message too long" });
    expect(readMtuTry(rawOf("win32", failed(WINDOWS_LOCAL)), 1500)).toEqual({ size: 1500, result: "too-big", detail: "Packet needs to be fragmented but DF set." });
  });

  it("gives none with no reply and no message, and keeps a message of an unreachable address", () => {
    expect(readMtuTry(rawOf("linux", failed(LINUX_SILENT)), 1500)).toEqual({ size: 1500, result: "none" });
    expect(readMtuTry(rawOf("darwin", failed(MAC_SILENT)), 1500)).toEqual({ size: 1500, result: "none" });
    expect(readMtuTry(rawOf("linux", failed(LINUX_UNREACHABLE)), 1500)).toEqual({ size: 1500, result: "none", detail: "Destination Host Unreachable" });
  });

  it("gives an error for a tool that does not start and for output that it cannot read", () => {
    expect(readMtuTry(rawOf("linux", { exitCode: 1, stdout: "", stderr: "", error: "spawn ping ENOENT" }), 1500)).toEqual({ size: 1500, result: "error", detail: "spawn ping ENOENT" });
    expect(readMtuTry(rawOf("linux", { exitCode: 2, stdout: "", stderr: "ping: unknown option\n" }), 1500)).toMatchObject({ size: 1500, result: "error" });
  });
});

function fakeHost(platform: string, clock: FakeClock, rules: readonly FakeRule[]): FakeToolHost<ToolRunOptions> {
  return fakeToolHost<ToolRunOptions>(platform, rules, async () => {
    await clock.advance(25);
  });
}

function runnerOf(clock: FakeClock): Runner {
  const scope = scopeOf([
    { kind: "range", cidr: "192.0.2.0/24", basis: "owned" },
    { kind: "range", cidr: "2001:db8::/32", basis: "owned" },
  ]);
  if (scope.tag === "err") throw new Error(scope.error.join(" "));
  return createRunner({ scope: scope.value, clock });
}

const VERSION: FakeRule = [(args) => args[0] === "-V", ok("ping from iputils 20240117\n")];
const WINDOWS_HELP: FakeRule = [(args) => args[0] === "/?", ok("Usage: ping [-t] [-a]")];

/** This function gives the size of the IP packet of a command of ping, from its payload. */
const sizeOf = (args: readonly string[], option: string): number => Number(args[args.indexOf(option) + 1]) + ECHO_HEADER_BYTES.ipv4;

const sizes = (host: FakeToolHost<ToolRunOptions>, option: string): number[] => host.calls.filter((call) => call.args.includes(option)).map((call) => sizeOf(call.args, option));

async function measured(host: FakeToolHost<ToolRunOptions>, clock: FakeClock, address = "192.0.2.1"): Promise<Fact<PathMtu>> {
  const outcome = await runnerOf(clock).run(mtuProbe(host), { address });
  if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
  const [fact] = outcome.facts as Fact<PathMtu>[];
  if (fact === undefined) throw new Error("The probe gave no fact.");
  expect(PATH_MTU.check(fact.value)).toBe(true);
  return fact;
}

describe("the probe path.mtu", () => {
  it("follows a true message on Linux, and gives one fact path.mtu with the tool in its source", async () => {
    const clock = fakeClock(1000);
    const host = fakeHost("linux", clock, [VERSION, [(args) => sizeOf(args, "-s") <= 1400, ok(LINUX_REPLY)], [() => true, failed(LINUX_FRAG)]]);
    const fact = await measured(host, clock);
    expect(fact).toMatchObject({ kind: "path.mtu", layer: "path", subject: { host: "192.0.2.1" }, source: { probe: "path.mtu", version: "2", tool: "ping" } });
    expect(fact.value).toMatchObject({ address: "192.0.2.1", outcome: "measured", mtu: 1400, stop: "message", ceiling: 1500 });
    expect(fact.value.tries.map((each) => [each.size, each.result])).toEqual([
      [1500, "too-big"],
      [68, "reply"],
      [1400, "reply"],
      [1401, "too-big"],
    ]);
    expect(sizes(host, "-s")).toEqual([1500, 68, 1400, 1401]);
    expect(fact.time).toEqual({ start: 1025, end: 1125 });
    expect(host.calls.every((call) => call.args[0] === "-V" || call.args.includes(String(DEFAULT_MTU_COUNT)))).toBe(true);
  });

  it("finds the MTU of a black hole by halves on Linux", async () => {
    const clock = fakeClock();
    const host = fakeHost("linux", clock, [VERSION, [(args) => sizeOf(args, "-s") <= 1200, ok(LINUX_REPLY)], [() => true, failed(LINUX_SILENT)]]);
    const fact = await measured(host, clock);
    expect(fact.value).toMatchObject({ outcome: "measured", mtu: 1200, stop: "silent" });
    expect(sizes(host, "-s").slice(0, 3)).toEqual([1500, 68, 784]);
    expect(fact.value.tries.length).toBeLessThanOrEqual(2 + Math.ceil(Math.log2(1500 - 68)));
  });

  it("finds the MTU by halves on Windows, which does not tell the MTU", async () => {
    const clock = fakeClock();
    const host = fakeHost("win32", clock, [WINDOWS_HELP, [(args) => sizeOf(args, "-l") <= 1400, ok(WINDOWS_REPLY)], [() => true, ok(WINDOWS_ROUTER)]]);
    const fact = await measured(host, clock);
    expect(fact.value).toMatchObject({ outcome: "measured", mtu: 1400, stop: "message" });
    expect(sizes(host, "-l").slice(0, 2)).toEqual([1500, 68]);
  });

  it("gives the outcome error when ping does not start for a size, and ends the search", async () => {
    const clock = fakeClock();
    const host = fakeHost("linux", clock, [VERSION, [() => true, { exitCode: 1, stdout: "", stderr: "", error: "spawn ping ENOENT" }]]);
    const fact = await measured(host, clock);
    expect(fact.value).toMatchObject({ outcome: "error", detail: "spawn ping ENOENT" });
    expect(sizes(host, "-s")).toEqual([1500]);
  });

  it("fails before a command on an operating system with no command for the family", async () => {
    const clock = fakeClock();
    const host = fakeHost("win32", clock, [WINDOWS_HELP]);
    const outcome = await runnerOf(clock).run(mtuProbe(host), { address: "2001:db8::1" });
    expect(outcome).toMatchObject({ status: "failed", stage: "run", error: expect.stringContaining("ipv6 on win32") });
    expect(host.calls.map((call) => call.args)).toEqual([["/?"]]);
  });

  it("gives the same value again from its raw output", async () => {
    const clock = fakeClock();
    const host = fakeHost("linux", clock, [VERSION, [(args) => sizeOf(args, "-s") <= 1300, ok(LINUX_REPLY)], [() => true, failed(LINUX_SILENT)]]);
    const probe = mtuProbe(host);
    const input = { address: "192.0.2.1" };
    const raw = await probe.run(input, { clock, signal: new AbortController().signal });
    const [observation] = probe.parse(raw, input);
    expect(observation?.value).toMatchObject({ outcome: "measured", mtu: 1300, stop: "silent" });
    expect(raw.steps.map((step) => step.size)).toEqual((observation?.value as PathMtu).tries.map((each) => each.size));
  });
});
