import { fakeClock } from "@mark1russell7/algebra/clock";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { fakeToolHost, type FakeRule } from "@netdiag/fixtures";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PATH_THROUGHPUT, createRunner, scopeOf, type Fact, type PathThroughput, type ThroughputInterval } from "../index.ts";
import { iperf3Command, iperf3Probe, readIperf3, type Iperf3Input, type ToolRaw, type ToolRunOptions } from "./index.ts";

// The reports in this file are hand-written. They follow the JSON report (`-J`) of iperf3 3.16 and of iperf3 3.9, with
// documentation addresses. No test starts iperf3. The fields come from `iperf_print_results` and
// `iperf_print_intermediate` in `src/iperf_api.c` of iperf3.

interface Sum {
  readonly start: number;
  readonly end: number;
  readonly bytes: number;
  readonly bits_per_second: number;
  readonly retransmits?: number;
  readonly packets?: number;
  readonly lost_packets?: number;
  readonly jitter_ms?: number;
}

function sum(fields: Sum, sender = true): Record<string, unknown> {
  return { ...fields, seconds: fields.end - fields.start, ...(fields.lost_packets !== undefined && fields.packets ? { lost_percent: (100 * fields.lost_packets) / fields.packets } : {}), sender };
}

function report(intervals: readonly Sum[], end: Record<string, unknown>, more: Record<string, unknown> = {}): string {
  const start = { version: "iperf 3.16", system_info: "Linux lab", connecting_to: { host: "192.0.2.1", port: 5201 }, test_start: { protocol: "TCP", num_streams: 1, duration: 2 } };
  return JSON.stringify({ start, intervals: intervals.map((s) => ({ streams: [], sum: { ...sum(s), omitted: false } })), end, ...more }, null, 2);
}

const TCP = report(
  [
    { start: 0, end: 1.000041, bytes: 117_964_800, bits_per_second: 943_679_000.5, retransmits: 2 },
    { start: 1.000041, end: 2.000035, bytes: 117_964_800, bits_per_second: 943_723_000, retransmits: 1 },
  ],
  {
    streams: [],
    sum_sent: sum({ start: 0, end: 2.000035, bytes: 235_929_600, bits_per_second: 943_701_000, retransmits: 3 }),
    sum_received: sum({ start: 0, end: 2.0405, bytes: 234_881_024, bits_per_second: 920_881_000 }),
    cpu_utilization_percent: { host_total: 5.1, remote_total: 12.4 },
  },
);

/** A UDP report of iperf3 3.9: the end has only `sum`. */
const UDP_OLD = report([{ start: 0, end: 1.000102, bytes: 131_072, bits_per_second: 1_048_469, packets: 90 }], {
  sum: sum({ start: 0, end: 1.000102, bytes: 131_072, bits_per_second: 1_048_469, jitter_ms: 0.0214, lost_packets: 2, packets: 90 }),
});

/** A UDP report of iperf3 3.16: the end also has `sum_sent` and `sum_received`. */
const UDP_NEW = report([{ start: 0, end: 1.000102, bytes: 131_072, bits_per_second: 1_048_469, packets: 90 }], {
  sum_sent: sum({ start: 0, end: 1.000102, bytes: 131_072, bits_per_second: 1_048_469, jitter_ms: 0, lost_packets: 0, packets: 90 }),
  sum_received: sum({ start: 0, end: 1.0405, bytes: 128_160, bits_per_second: 985_368, jitter_ms: 0.0214, lost_packets: 2, packets: 88 }),
  sum: sum({ start: 0, end: 1.000102, bytes: 131_072, bits_per_second: 1_048_469, jitter_ms: 0.0214, lost_packets: 2, packets: 90 }),
});

const REFUSED = JSON.stringify({
  start: {},
  intervals: [],
  end: {},
  error: "error - unable to connect to server - server may have stopped running or use a different port, firewall issue, etc.: Connection refused",
});

const BUSY = JSON.stringify({ start: {}, intervals: [], end: {}, error: "error - the server is busy running a test. try again later" });

function raw(stdout: string, more: Partial<ToolRaw> = {}): ToolRaw {
  return { platform: "linux", command: "iperf3", args: [], start: 0, end: 1, exitCode: 0, stdout, stderr: "", ...more };
}

function read(stdout: string, more: Partial<ToolRaw> = {}, input: Iperf3Input = { address: "192.0.2.1" }): PathThroughput {
  const value = readIperf3(raw(stdout, more), input);
  expect(PATH_THROUGHPUT.check(value), JSON.stringify(value)).toBe(true);
  return value;
}

const TCP_SETTINGS = { address: "192.0.2.1", port: 5201, protocol: "tcp", reverse: false, streams: 1, seconds: 10 } as const;
const UDP_INPUT: Iperf3Input = { address: "192.0.2.1", protocol: "udp", seconds: 1 };

describe("iperf3Command", () => {
  it("gives the argument list of a TCP test, with no shell, and a time limit from the time of the test", () => {
    expect(iperf3Command({ address: "192.0.2.1" })).toEqual({
      command: "iperf3",
      args: ["-c", "192.0.2.1", "-p", "5201", "-t", "10", "-P", "1", "-J"],
      timeoutMs: 18_000,
      env: { LC_ALL: "C" },
    });
  });

  it("adds the options of UDP, of a rate, of parallel streams and of the reverse direction", () => {
    expect(iperf3Command({ address: "2001:DB8::1", port: 5300, seconds: 3, protocol: "udp", streams: 4, reverse: true }).args).toEqual([
      "-c",
      "2001:db8::1",
      "-p",
      "5300",
      "-t",
      "3",
      "-P",
      "4",
      "-J",
      "-u",
      "-b",
      "1000000",
      "-R",
    ]);
    expect(iperf3Command({ address: "192.0.2.1", bitsPerSecond: 50_000_000 }).args.slice(-2)).toEqual(["-b", "50000000"]);
    expect(iperf3Command({ address: "192.0.2.1", seconds: 60 }).timeoutMs).toBe(68_000);
  });

  it("refuses a name, a value out of range and a protocol that iperf3 does not know", () => {
    expect(() => iperf3Command({ address: "example.com" })).toThrow(TypeError);
    for (const input of [
      { port: 0 },
      { seconds: 0 },
      { seconds: 61 },
      { seconds: 1.5 },
      { streams: 17 },
      { bitsPerSecond: 0 },
      { bitsPerSecond: 10_000_000_001 },
      { protocol: "sctp" as "tcp" },
    ]) {
      expect(() => iperf3Command({ address: "192.0.2.1", ...input }), JSON.stringify(input)).toThrow(RangeError);
    }
  });
});

describe("readIperf3", () => {
  it("reads the rates, the bytes, the retransmits and the intervals of a TCP report", () => {
    expect(read(TCP)).toEqual({
      ...TCP_SETTINGS,
      outcome: "measured",
      sentBitsPerSecond: 943_701_000,
      receivedBitsPerSecond: 920_881_000,
      sentBytes: 235_929_600,
      receivedBytes: 234_881_024,
      retransmits: 3,
      intervals: [
        { startMs: 0, endMs: 1000.041, bytes: 117_964_800, bitsPerSecond: 943_679_000.5, retransmits: 2 },
        { startMs: 1000.041, endMs: 2000.035, bytes: 117_964_800, bitsPerSecond: 943_723_000, retransmits: 1 },
      ],
    });
  });

  it("gives no retransmits when the sender does not read them, for example on macOS", () => {
    const value = JSON.parse(TCP) as { end: { sum_sent: Record<string, unknown> }; intervals: { sum: Record<string, unknown> }[] };
    delete value.end.sum_sent["retransmits"];
    for (const interval of value.intervals) delete interval.sum["retransmits"];
    const result = read(JSON.stringify(value));
    expect(result.retransmits).toBeUndefined();
    expect(result.intervals.every((interval) => interval.retransmits === undefined)).toBe(true);
  });

  it("reads the jitter and the loss of a UDP report of iperf3 3.9, with no rate of the receiver", () => {
    expect(read(UDP_OLD, {}, UDP_INPUT)).toEqual({
      address: "192.0.2.1",
      port: 5201,
      protocol: "udp",
      reverse: false,
      streams: 1,
      seconds: 1,
      outcome: "measured",
      sentBitsPerSecond: 1_048_469,
      sentBytes: 131_072,
      jitterMs: 0.0214,
      lostDatagrams: 2,
      datagrams: 90,
      intervals: [{ startMs: 0, endMs: 1000.102, bytes: 131_072, bitsPerSecond: 1_048_469, datagrams: 90 }],
    });
  });

  it("reads the rate of the receiver from end.sum_received of a UDP report of iperf3 3.16", () => {
    expect(read(UDP_NEW, {}, UDP_INPUT)).toMatchObject({
      outcome: "measured",
      sentBitsPerSecond: 1_048_469,
      receivedBitsPerSecond: 985_368,
      sentBytes: 131_072,
      receivedBytes: 128_160,
      jitterMs: 0.0214,
      lostDatagrams: 2,
      datagrams: 90,
    });
  });

  it("gives refused, busy or error for a report with the field error, without the prefix of iperf3", () => {
    expect(read(REFUSED)).toEqual({
      ...TCP_SETTINGS,
      outcome: "refused",
      intervals: [],
      detail: "unable to connect to server - server may have stopped running or use a different port, firewall issue, etc.: Connection refused",
    });
    expect(read(BUSY)).toMatchObject({ outcome: "busy", detail: "the server is busy running a test. try again later" });
    expect(read(JSON.stringify({ error: "error - unable to receive control message: Connection reset by peer" }))).toMatchObject({ outcome: "error" });
    expect(read(JSON.stringify({ error: "error - " }))).toMatchObject({ outcome: "error", detail: "iperf3 gave an error with no text." });
  });

  it("gives an error for a tool that does not start, a time limit, and output that it cannot read", () => {
    expect(read("", { exitCode: 1, error: "spawn iperf3 ENOENT" })).toEqual({ ...TCP_SETTINGS, outcome: "error", intervals: [], detail: "spawn iperf3 ENOENT" });
    expect(read(TCP.slice(0, 50), { timedOut: true })).toMatchObject({ outcome: "error", detail: expect.stringContaining("time limit") });
    expect(read("", { exitCode: 1, stderr: "iperf3: parameter error - must either be a client (-c) or server (-s)\n" })).toMatchObject({
      outcome: "error",
      detail: "iperf3: parameter error - must either be a client (-c) or server (-s)",
    });
    expect(read("[1, 2]")).toMatchObject({ outcome: "error", detail: "netdiag cannot read the JSON report of iperf3." });
    expect(read(JSON.stringify({ start: {}, intervals: [] }))).toMatchObject({ outcome: "error", detail: expect.stringContaining("3.1 or later") });
  });

  it("gives an error for a sum that it cannot read, and does not give a part of the report", () => {
    const bad = JSON.parse(TCP) as { end: Record<string, unknown>; intervals: { sum: Record<string, unknown> }[] };
    const interval = structuredClone(bad);
    if (interval.intervals[1] !== undefined) interval.intervals[1].sum["bits_per_second"] = -1;
    expect(read(JSON.stringify(interval))).toMatchObject({ outcome: "error", intervals: [], detail: "netdiag cannot read the interval 2 of the report of iperf3." });
    const received = structuredClone(bad);
    delete received.end["sum_received"];
    expect(read(JSON.stringify(received))).toMatchObject({ outcome: "error", detail: expect.stringContaining("sum_received") });
    const udp = JSON.parse(UDP_OLD) as { end: Record<string, unknown> };
    delete udp.end["sum"];
    expect(read(JSON.stringify(udp), {}, UDP_INPUT)).toMatchObject({ outcome: "error", detail: expect.stringContaining("end.sum") });
  });

  it("gives no loss when iperf3 writes a negative loss or more losses than datagrams", () => {
    const negative = JSON.parse(UDP_OLD) as { end: { sum: Record<string, unknown> } };
    negative.end.sum["lost_packets"] = -1;
    const value = read(JSON.stringify(negative), {}, UDP_INPUT);
    expect(value).toMatchObject({ outcome: "measured", datagrams: 90 });
    expect(value.lostDatagrams).toBeUndefined();
    negative.end.sum["lost_packets"] = 91;
    expect(read(JSON.stringify(negative), {}, UDP_INPUT).lostDatagrams).toBeUndefined();
  });
});

/** A sum of the property: the times in microseconds, as iperf3 measures them. */
interface SumModel {
  readonly startUs: number;
  readonly lengthUs: number;
  readonly bytes: number;
  readonly bitsPerSecond: number;
  readonly retransmits?: number | undefined;
  readonly datagrams?: number | undefined;
  readonly lostDatagrams?: number | undefined;
  readonly jitterMs?: number | undefined;
}

const rate = uniformDouble({ min: 0, max: 1e11 });
const baseSum = fc.record({ startUs: fc.nat(60_000_000), lengthUs: fc.nat(2_000_000), bytes: fc.nat(), bitsPerSecond: rate });
const tcpSum: fc.Arbitrary<SumModel> = fc.record({ base: baseSum, retransmits: fc.option(fc.nat(10_000), { nil: undefined }) }).map(({ base, retransmits }) => ({ ...base, retransmits }));
const udpSum: fc.Arbitrary<SumModel> = fc
  .record({ base: baseSum, datagrams: fc.nat(1_000_000), lost: fc.nat(1_000_000), jitterMs: uniformDouble({ min: 0, max: 1000 }) })
  .map(({ base, datagrams, lost, jitterMs }) => ({ ...base, datagrams, lostDatagrams: Math.min(lost, datagrams), jitterMs }));

function sumJson(model: SumModel): Sum {
  const json: Sum = { start: model.startUs / 1e6, end: (model.startUs + model.lengthUs) / 1e6, bytes: model.bytes, bits_per_second: model.bitsPerSecond };
  return {
    ...json,
    ...(model.retransmits === undefined ? {} : { retransmits: model.retransmits }),
    ...(model.datagrams === undefined ? {} : { packets: model.datagrams }),
    ...(model.lostDatagrams === undefined ? {} : { lost_packets: model.lostDatagrams }),
    ...(model.jitterMs === undefined ? {} : { jitter_ms: model.jitterMs }),
  };
}

function intervalOf(model: SumModel): ThroughputInterval {
  const { startUs, lengthUs, retransmits, datagrams, lostDatagrams, jitterMs, ...rest } = model;
  return {
    startMs: startUs / 1e3,
    endMs: (startUs + lengthUs) / 1e3,
    ...rest,
    ...(retransmits === undefined ? {} : { retransmits }),
    ...(datagrams === undefined ? {} : { datagrams }),
    ...(lostDatagrams === undefined ? {} : { lostDatagrams }),
    ...(jitterMs === undefined ? {} : { jitterMs }),
  };
}

const settings = fc.record({
  address: fc.constantFrom("192.0.2.1", "2001:db8::1"),
  port: fc.integer({ min: 1, max: 65535 }),
  reverse: fc.boolean(),
  streams: fc.integer({ min: 1, max: 16 }),
  seconds: fc.integer({ min: 1, max: 60 }),
});

describe("the round trip of a report", () => {
  it("gives back the rates, the bytes and the intervals of each TCP report", () => {
    fc.assert(
      fc.property(settings, tcpSum, tcpSum, fc.array(tcpSum, { maxLength: 8 }), (input, sent, received, intervals) => {
        const stdout = report(intervals.map(sumJson), { sum_sent: sum(sumJson(sent)), sum_received: sum(sumJson({ ...received, retransmits: undefined })) });
        expect(read(stdout, {}, { ...input, protocol: "tcp" })).toEqual({
          ...input,
          protocol: "tcp",
          outcome: "measured",
          sentBitsPerSecond: sent.bitsPerSecond,
          receivedBitsPerSecond: received.bitsPerSecond,
          sentBytes: sent.bytes,
          receivedBytes: received.bytes,
          ...(sent.retransmits === undefined ? {} : { retransmits: sent.retransmits }),
          intervals: intervals.map(intervalOf),
        });
      }),
    );
  });

  it("gives back the rates, the jitter and the loss of each UDP report, with and without end.sum_received", () => {
    fc.assert(
      fc.property(settings, udpSum, fc.option(udpSum, { nil: undefined }), fc.array(udpSum, { maxLength: 8 }), (input, total, received, intervals) => {
        const end = { sum: sum(sumJson(total)), ...(received === undefined ? {} : { sum_sent: sum(sumJson(total)), sum_received: sum(sumJson(received)) }) };
        expect(read(report(intervals.map(sumJson), end), {}, { ...input, protocol: "udp" })).toEqual({
          ...input,
          protocol: "udp",
          outcome: "measured",
          sentBitsPerSecond: total.bitsPerSecond,
          sentBytes: total.bytes,
          ...(received === undefined ? {} : { receivedBitsPerSecond: received.bitsPerSecond, receivedBytes: received.bytes }),
          jitterMs: total.jitterMs,
          lostDatagrams: total.lostDatagrams,
          datagrams: total.datagrams,
          intervals: intervals.map(intervalOf),
        });
      }),
    );
  });

  it("gives a valid value and does not throw for each text", () => {
    const text = fc.oneof(fc.string(), fc.json(), fc.jsonValue().map((value) => JSON.stringify({ end: value, intervals: [{ sum: value }] })));
    fc.assert(
      fc.property(text, fc.constantFrom<Iperf3Input>({ address: "192.0.2.1" }, UDP_INPUT), (stdout, input) => {
        read(stdout, {}, input);
      }),
    );
  });
});

describe("the probe path.iperf3", () => {
  const scope = scopeOf([{ kind: "range", cidr: "192.0.2.0/24", basis: "owned" }]);
  if (scope.tag === "err") throw new Error(scope.error.join(" "));
  const version: FakeRule = [(args) => args[0] === "--version", { exitCode: 0, stdout: "iperf 3.16 (cJSON 1.7.15)\nLinux lab 6.8.0 x86_64\n", stderr: "" }];

  it("gives one fact path.throughput of the server, with the tool in its source", async () => {
    const clock = fakeClock(1000);
    const host = fakeToolHost<ToolRunOptions>("linux", [version, [(args) => args.includes("-J"), { exitCode: 0, stdout: TCP, stderr: "" }]], async () => {
      await clock.advance(25);
    });
    const outcome = await createRunner({ scope: scope.value, clock }).run(iperf3Probe(host), { address: "192.0.2.1", port: 5202 });
    if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
    const [fact] = outcome.facts as Fact<PathThroughput>[];
    expect(fact).toMatchObject({
      kind: "path.throughput",
      layer: "path",
      subject: { host: "192.0.2.1", port: 5202 },
      source: { probe: "path.iperf3", tool: "iperf3" },
      value: { outcome: "measured", port: 5202 },
    });
    expect(host.calls[1]?.args).toContain("5202");
  });

  it("starts no command for a server out of the scope", async () => {
    const clock = fakeClock();
    const host = fakeToolHost<ToolRunOptions>("linux", [version]);
    expect(await createRunner({ scope: scope.value, clock }).run(iperf3Probe(host), { address: "198.51.100.1" })).toMatchObject({ status: "refused" });
    expect(host.calls).toEqual([]);
  });

  it("tells the version of iperf3, and refuses a version before 3.1", async () => {
    const context = { clock: fakeClock(), signal: new AbortController().signal };
    expect(await iperf3Probe(fakeToolHost("linux", [version])).available(context)).toEqual({ available: true, version: "3.16" });
    const old: FakeRule = [() => true, { exitCode: 0, stdout: "iperf 3.0.11\nLinux lab\n", stderr: "" }];
    expect(await iperf3Probe(fakeToolHost("linux", [old])).available(context)).toMatchObject({ available: false, reason: expect.stringContaining("3.0.11") });
    const missing: FakeRule = [() => true, { exitCode: 1, stdout: "", stderr: "", error: "spawn iperf3 ENOENT" }];
    expect(await iperf3Probe(fakeToolHost("win32", [missing])).available(context)).toMatchObject({ available: false });
  });
});
