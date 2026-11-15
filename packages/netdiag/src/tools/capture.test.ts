import { fakeClock } from "@mark1russell7/algebra/clock";
import { fakeToolHost, type FakeRule } from "@netdiag/fixtures";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PATH_CAPTURE, createRunner, scopeOf, type CapturedPacket, type Fact, type PathCapture } from "../index.ts";
import { CAPTURE_FIELDS, captureCommand, captureFilter, captureProbe, readCapture, type CaptureInput, type ToolRaw, type ToolRunOptions } from "./index.ts";

// The lines in this file are hand-written. They follow the output `-T fields` of tshark 4.2 with the fields of
// `CAPTURE_FIELDS`, with documentation addresses. No test starts tshark or a capture.

type Columns = Readonly<Record<string, string | undefined>>;

/** This function writes one line of the output: the columns in the order of `CAPTURE_FIELDS`, with a tab between them. */
function line(columns: Columns): string {
  return CAPTURE_FIELDS.map((field) => columns[field] ?? "").join("\t");
}

const OUT = { "ip.src": "192.0.2.10", "ip.dst": "192.0.2.1", "tcp.srcport": "51000", "tcp.dstport": "443" };
const BACK = { "ip.src": "192.0.2.1", "ip.dst": "192.0.2.10", "tcp.srcport": "443", "tcp.dstport": "51000" };

const HANDSHAKE = [
  line({ "frame.time_epoch": "1700000000.000000000", ...OUT, "tcp.seq": "0", "tcp.len": "0", "tcp.flags": "0x0002", "frame.len": "74" }),
  line({ "frame.time_epoch": "1700000000.012345678", ...BACK, "tcp.seq": "0", "tcp.ack": "1", "tcp.len": "0", "tcp.flags": "0x0012", "tcp.analysis.ack_rtt": "0.012345678", "frame.len": "74" }),
  line({ "frame.time_epoch": "1700000000.012400000", ...OUT, "tcp.seq": "1", "tcp.ack": "1", "tcp.len": "0", "tcp.flags": "0x0010", "frame.len": "66" }),
  line({ "frame.time_epoch": "1700000000.012500000", ...OUT, "tcp.seq": "1", "tcp.ack": "1", "tcp.len": "517", "tcp.flags": "0x0018", "frame.len": "583" }),
  line({ "frame.time_epoch": "1700000000.250500000", ...OUT, "tcp.seq": "1", "tcp.ack": "1", "tcp.len": "517", "tcp.flags": "0x0018", "tcp.analysis.retransmission": "1", "frame.len": "583" }),
  line({ "frame.time_epoch": "1700000000.262000000", ...BACK, "tcp.seq": "1", "tcp.ack": "518", "tcp.len": "0", "tcp.flags": "0x0010", "tcp.analysis.ack_rtt": "0.011500000", "frame.len": "66" }),
].join("\n");

const TCP_INPUT: CaptureInput = { device: "eth0", address: "192.0.2.1", port: 443, protocol: "tcp" };

function raw(stdout: string, more: Partial<ToolRaw> = {}): ToolRaw {
  return { platform: "linux", command: "tshark", args: [], start: 0, end: 1, exitCode: 0, stdout, stderr: "Capturing on 'eth0'\n", ...more };
}

function read(stdout: string, more: Partial<ToolRaw> = {}, input: CaptureInput = TCP_INPUT): PathCapture {
  const value = readCapture(raw(stdout, more), input);
  expect(PATH_CAPTURE.check(value), JSON.stringify(value)).toBe(true);
  return value;
}

describe("captureFilter", () => {
  it("builds the capture filter of a flow from typed fields", () => {
    expect(captureFilter({ address: "192.0.2.1" })).toBe("ip host 192.0.2.1");
    expect(captureFilter({ address: "192.0.2.1", port: 443 })).toBe("ip host 192.0.2.1 and port 443");
    expect(captureFilter({ address: "192.0.2.1", protocol: "udp" })).toBe("ip host 192.0.2.1 and udp");
    expect(captureFilter({ address: "192.0.2.1", port: 53, protocol: "udp" })).toBe("ip host 192.0.2.1 and udp port 53");
    expect(captureFilter({ address: "2001:DB8::1", port: 443, protocol: "tcp" })).toBe("ip6 host 2001:db8::1 and tcp port 443");
    expect(captureFilter({ address: "192.0.2.1", protocol: "icmp" })).toBe("ip host 192.0.2.1 and icmp");
    expect(captureFilter({ address: "2001:db8::1", protocol: "icmp" })).toBe("ip6 host 2001:db8::1 and icmp6");
  });

  it("refuses a name, free text, a port out of range, an unknown protocol and an ICMP flow with a port", () => {
    expect(() => captureFilter({ address: "example.com" })).toThrow(TypeError);
    expect(() => captureFilter({ address: "192.0.2.1 or host 198.51.100.1" })).toThrow(TypeError);
    expect(() => captureFilter({ address: "192.0.2.1", port: 0 })).toThrow(RangeError);
    expect(() => captureFilter({ address: "192.0.2.1", port: 65536 })).toThrow(RangeError);
    expect(() => captureFilter({ address: "192.0.2.1", protocol: "arp" as "tcp" })).toThrow(RangeError);
    expect(() => captureFilter({ address: "192.0.2.1", port: 7, protocol: "icmp" })).toThrow(RangeError);
  });
});

describe("captureCommand", () => {
  it("gives the argument list, with no shell, no name lookup and no promiscuous mode", () => {
    expect(captureCommand({ ...TCP_INPUT, seconds: 5, packets: 200 })).toEqual({
      command: "tshark",
      args: [
        "-n",
        "-p",
        "-i",
        "eth0",
        "-f",
        "ip host 192.0.2.1 and tcp port 443",
        "-a",
        "duration:5",
        "-c",
        "200",
        "-o",
        "tcp.analyze_sequence_numbers:TRUE",
        "-o",
        "tcp.relative_sequence_numbers:TRUE",
        "-T",
        "fields",
        "-E",
        "separator=/t",
        "-E",
        "header=n",
        "-E",
        "occurrence=f",
        ...CAPTURE_FIELDS.flatMap((field) => ["-e", field]),
      ],
      timeoutMs: 13_000,
      env: { LC_ALL: "C" },
    });
    expect(captureCommand({ device: "Wi-Fi 2", address: "192.0.2.1" }).args.slice(2, 10)).toEqual(["-i", "Wi-Fi 2", "-f", "ip host 192.0.2.1", "-a", "duration:10", "-c", "1000"]);
  });

  it("refuses a device that is an option or has a control character, and limits out of range", () => {
    for (const device of ["", "-w", " eth0", "eth0\n", "x".repeat(256)]) {
      expect(() => captureCommand({ device, address: "192.0.2.1" }), JSON.stringify(device)).toThrow(RangeError);
    }
    expect(() => captureCommand({ ...TCP_INPUT, seconds: 121 })).toThrow(RangeError);
    expect(() => captureCommand({ ...TCP_INPUT, packets: 0 })).toThrow(RangeError);
    expect(() => captureCommand({ ...TCP_INPUT, packets: 10_001 })).toThrow(RangeError);
  });
});

describe("readCapture", () => {
  it("reads each packet of a TCP flow, with the times from the first packet", () => {
    expect(read(`${HANDSHAKE}\n`, { stderr: "Capturing on 'eth0'\n6 packets captured\n" })).toEqual({
      address: "192.0.2.1",
      port: 443,
      protocol: "tcp",
      device: "eth0",
      filter: "ip host 192.0.2.1 and tcp port 443",
      outcome: "captured",
      epoch: "1700000000.000000000",
      packets: [
        { atMs: 0, src: "192.0.2.10", dst: "192.0.2.1", protocol: "tcp", srcPort: 51000, dstPort: 443, seq: 0, payload: 0, flags: 2, retransmission: false, bytes: 74 },
        { atMs: 12.345678, src: "192.0.2.1", dst: "192.0.2.10", protocol: "tcp", srcPort: 443, dstPort: 51000, seq: 0, ack: 1, payload: 0, flags: 18, retransmission: false, ackRttMs: 12.345678, bytes: 74 },
        { atMs: 12.4, src: "192.0.2.10", dst: "192.0.2.1", protocol: "tcp", srcPort: 51000, dstPort: 443, seq: 1, ack: 1, payload: 0, flags: 16, retransmission: false, bytes: 66 },
        { atMs: 12.5, src: "192.0.2.10", dst: "192.0.2.1", protocol: "tcp", srcPort: 51000, dstPort: 443, seq: 1, ack: 1, payload: 517, flags: 24, retransmission: false, bytes: 583 },
        { atMs: 250.5, src: "192.0.2.10", dst: "192.0.2.1", protocol: "tcp", srcPort: 51000, dstPort: 443, seq: 1, ack: 1, payload: 517, flags: 24, retransmission: true, bytes: 583 },
        { atMs: 262, src: "192.0.2.1", dst: "192.0.2.10", protocol: "tcp", srcPort: 443, dstPort: 51000, seq: 1, ack: 518, payload: 0, flags: 16, retransmission: false, ackRttMs: 11.5, bytes: 66 },
      ],
    });
  });

  it("reads UDP, ICMP and IPv6 packets, the flags as a decimal number, and the dropped packets", () => {
    const stdout = [
      line({ "frame.time_epoch": "1700000001.5", "ip.src": "192.0.2.10", "ip.dst": "192.0.2.1", "udp.srcport": "53000", "udp.dstport": "53", "frame.len": "80" }),
      line({ "frame.time_epoch": "1700000001", "ip.src": "192.0.2.1", "ip.dst": "192.0.2.10", "frame.len": "98" }),
      line({ "frame.time_epoch": "1700000002.25", "ipv6.src": "2001:DB8::10", "ipv6.dst": "2001:db8::1", "tcp.srcport": "51000", "tcp.dstport": "443", "tcp.flags": "18", "frame.len": "94" }),
    ].join("\r\n");
    expect(read(stdout, { stderr: "Capturing on 'eth0'\n3 packets captured\n1 packet dropped from eth0\n" }, { device: "eth0", address: "192.0.2.1" })).toEqual({
      address: "192.0.2.1",
      device: "eth0",
      filter: "ip host 192.0.2.1",
      outcome: "captured",
      epoch: "1700000001",
      dropped: 1,
      packets: [
        { atMs: 500, src: "192.0.2.10", dst: "192.0.2.1", protocol: "udp", srcPort: 53000, dstPort: 53, bytes: 80 },
        { atMs: 0, src: "192.0.2.1", dst: "192.0.2.10", protocol: "other", bytes: 98 },
        { atMs: 1250, src: "2001:db8::10", dst: "2001:db8::1", protocol: "tcp", srcPort: 51000, dstPort: 443, flags: 18, retransmission: false, bytes: 94 },
      ],
    });
  });

  it("gives none for a capture with no packet", () => {
    expect(read("", { stderr: "Capturing on 'eth0'\n0 packets captured\n" })).toEqual({
      address: "192.0.2.1",
      port: 443,
      protocol: "tcp",
      device: "eth0",
      filter: "ip host 192.0.2.1 and tcp port 443",
      outcome: "none",
      packets: [],
    });
  });

  it("gives an error with the text of tshark for a capture without the privilege, a time limit and a tool that does not start", () => {
    const stderr = "Capturing on 'eth0'\ntshark: You don't have permission to capture on that device (socket: Operation not permitted)\n";
    expect(read("", { exitCode: 2, stderr })).toMatchObject({ outcome: "error", packets: [], detail: "You don't have permission to capture on that device (socket: Operation not permitted)" });
    expect(read("", { exitCode: 1, stderr: "Capturing on 'eth9'\nThe capture session could not be initiated.\n" })).toMatchObject({ detail: "The capture session could not be initiated." });
    expect(read("", { exitCode: 1, stderr: "" })).toMatchObject({ detail: "tshark ended with the exit code 1." });
    expect(read(HANDSHAKE, { timedOut: true })).toMatchObject({ outcome: "error", packets: [], detail: expect.stringContaining("time limit") });
    expect(read("", { exitCode: 1, error: "spawn tshark ENOENT" })).toMatchObject({ outcome: "error", detail: "spawn tshark ENOENT" });
  });

  it("gives an error for a line that it cannot read, and does not give a part of the capture", () => {
    expect(read(`${HANDSHAKE}\n1700000000.3\t192.0.2.1`)).toMatchObject({ outcome: "error", packets: [], detail: `netdiag cannot read the packet 7 of tshark. It has 2 fields, not ${CAPTURE_FIELDS.length}.` });
    const field = (columns: Columns): string | undefined => read(line({ "frame.time_epoch": "1700000000.1", ...OUT, "frame.len": "60", ...columns })).detail;
    expect(field({ "tcp.flags": "SYN" })).toBe("netdiag cannot read the field tcp.flags of the packet 1 of tshark.");
    expect(field({ "frame.time_epoch": "Nov 14, 2023 22:13:20.000000000 UTC" })).toContain("frame.time_epoch");
    expect(field({ "frame.time_epoch": "" })).toContain("frame.time_epoch");
    expect(field({ "tcp.srcport": "65536" })).toContain("tcp.srcport");
    expect(field({ "ip.dst": "" })).toContain("ip.dst");
    expect(field({ "ip.src": "router.example" })).toContain("ip.src");
    expect(field({ "tcp.analysis.ack_rtt": "-0.001" })).toContain("tcp.analysis.ack_rtt");
    expect(field({ "frame.len": "" })).toContain("frame.len");
  });
});

/** A packet of the property: its time in nanoseconds after a base time, and the text of its TCP flags. */
interface PacketModel {
  readonly offsetNs: bigint;
  readonly packet: Omit<CapturedPacket, "atMs">;
  readonly flagsText?: string | undefined;
  readonly ackRttNs?: number | undefined;
}

const BASE_NS = 1_700_000_000_000_000_000n;

function seconds(ns: bigint): string {
  return `${ns / 1_000_000_000n}.${String(ns % 1_000_000_000n).padStart(9, "0")}`;
}

const ends = fc.constantFrom(["192.0.2.10", "192.0.2.1"] as const, ["192.0.2.1", "192.0.2.10"] as const, ["2001:db8::10", "2001:db8::1"] as const);
const port = fc.integer({ min: 0, max: 65535 });
const uint32 = fc.option(fc.nat(), { nil: undefined });

const tcpPacket = fc
  .record({ ends, srcPort: port, dstPort: port, seq: uint32, ack: uint32, payload: uint32, flags: uint32, hex: fc.boolean(), retransmission: fc.boolean(), ackRttNs: uint32 })
  .map(({ ends: [src, dst], hex, flags, ackRttNs, seq, ack, payload, ...tcp }) => ({
    packet: {
      src,
      dst,
      protocol: "tcp" as const,
      ...tcp,
      ...(seq === undefined ? {} : { seq }),
      ...(ack === undefined ? {} : { ack }),
      ...(payload === undefined ? {} : { payload }),
      ...(flags === undefined ? {} : { flags }),
      ...(ackRttNs === undefined ? {} : { ackRttMs: ackRttNs / 1e6 }),
    },
    flagsText: flags === undefined ? undefined : hex ? `0x${flags.toString(16).padStart(4, "0")}` : String(flags),
    ackRttNs,
  }));
const udpPacket = fc.record({ ends, srcPort: port, dstPort: port }).map(({ ends: [src, dst], ...udp }) => ({ packet: { src, dst, protocol: "udp" as const, ...udp } }));
const otherPacket = ends.map(([src, dst]) => ({ packet: { src, dst, protocol: "other" as const } }));

const packetModel: fc.Arbitrary<PacketModel> = fc
  .record({ offsetNs: fc.bigInt({ min: 0n, max: 120_000_000_000n }), bytes: fc.nat(65_535), kind: fc.oneof(tcpPacket, udpPacket, otherPacket) })
  .map(({ offsetNs, bytes, kind }) => ({ ...kind, offsetNs, packet: { ...kind.packet, bytes } }));

function lineOf({ offsetNs, packet, flagsText, ackRttNs }: PacketModel): string {
  const v6 = packet.src.includes(":");
  const ports = packet.protocol === "other" ? {} : { [`${packet.protocol}.srcport`]: String(packet.srcPort), [`${packet.protocol}.dstport`]: String(packet.dstPort) };
  const text = (value: number | undefined): string | undefined => (value === undefined ? undefined : String(value));
  return line({
    "frame.time_epoch": seconds(BASE_NS + offsetNs),
    [v6 ? "ipv6.src" : "ip.src"]: packet.src,
    [v6 ? "ipv6.dst" : "ip.dst"]: packet.dst,
    ...ports,
    "tcp.seq": text(packet.seq),
    "tcp.ack": text(packet.ack),
    "tcp.len": text(packet.payload),
    "tcp.flags": flagsText,
    "tcp.analysis.retransmission": packet.retransmission === true ? "1" : undefined,
    "tcp.analysis.ack_rtt": ackRttNs === undefined ? undefined : seconds(BigInt(ackRttNs)),
    "frame.len": String(packet.bytes),
  });
}

describe("the round trip of a capture", () => {
  it("gives back each packet, with its time from the earliest packet", () => {
    fc.assert(
      fc.property(fc.array(packetModel, { minLength: 1, maxLength: 20 }), (models) => {
        const first = models.reduce((min, model) => (model.offsetNs < min ? model.offsetNs : min), models[0]?.offsetNs ?? 0n);
        const value = read(models.map(lineOf).join("\n"), {}, { device: "eth0", address: "192.0.2.1" });
        expect(value).toEqual({
          address: "192.0.2.1",
          device: "eth0",
          filter: "ip host 192.0.2.1",
          outcome: "captured",
          epoch: seconds(BASE_NS + first),
          packets: models.map(({ offsetNs, packet }) => ({ atMs: Number(offsetNs - first) / 1e6, ...packet })),
        });
      }),
    );
  });

  it("gives a valid value and does not throw for each output", () => {
    const columns = fc.array(fc.oneof(fc.string(), fc.constantFrom("", "1", "0x0012", "192.0.2.1", "1700000000.5")), { minLength: CAPTURE_FIELDS.length, maxLength: CAPTURE_FIELDS.length });
    const stdout = fc.oneof(fc.string(), fc.array(columns.map((list) => list.join("\t")), { maxLength: 5 }).map((lines) => lines.join("\n")));
    fc.assert(
      fc.property(stdout, fc.string(), fc.constantFrom(0, 1, 2), (text, stderr, exitCode) => {
        read(text, { stderr, exitCode });
      }),
    );
  });
});

describe("the probe path.capture", () => {
  const scope = scopeOf([{ kind: "range", cidr: "192.0.2.0/24", basis: "owned" }]);
  if (scope.tag === "err") throw new Error(scope.error.join(" "));
  const version: FakeRule = [(args) => args[0] === "--version", { exitCode: 0, stdout: "TShark (Wireshark) 4.2.2 (Git v4.2.2 packaged as 4.2.2-1.1build3).\n\nCopyright 1998-2024 Gerald Combs\n", stderr: "" }];

  it("gives one fact path.capture of the flow, with the tool in its source", async () => {
    const clock = fakeClock(1000);
    const capture: FakeRule = [(args) => args.includes("fields"), { exitCode: 0, stdout: HANDSHAKE, stderr: "Capturing on 'eth0'\n6 packets captured\n" }];
    const host = fakeToolHost<ToolRunOptions>("linux", [version, capture], async () => {
      await clock.advance(25);
    });
    const outcome = await createRunner({ scope: scope.value, clock }).run(captureProbe(host), { ...TCP_INPUT, seconds: 5 });
    if (outcome.status !== "done") throw new Error(JSON.stringify(outcome));
    const [fact] = outcome.facts as Fact<PathCapture>[];
    expect(fact).toMatchObject({
      kind: "path.capture",
      layer: "path",
      subject: { host: "192.0.2.1", port: 443 },
      source: { probe: "path.capture", tool: "tshark" },
      value: { outcome: "captured", filter: "ip host 192.0.2.1 and tcp port 443" },
    });
    expect(fact?.value.packets).toHaveLength(6);
    expect(host.calls[1]?.options.timeoutMs).toBe(13_000);
  });

  it("starts no command for a flow out of the scope", async () => {
    const host = fakeToolHost<ToolRunOptions>("linux", [version]);
    expect(await createRunner({ scope: scope.value, clock: fakeClock() }).run(captureProbe(host), { device: "eth0", address: "198.51.100.1" })).toMatchObject({ status: "refused" });
    expect(host.calls).toEqual([]);
  });

  it("tells the version of tshark, also in the text of old versions", async () => {
    const context = { clock: fakeClock(), signal: new AbortController().signal };
    expect(await captureProbe(fakeToolHost("linux", [version])).available(context)).toEqual({ available: true, version: "4.2.2" });
    const old: FakeRule = [() => true, { exitCode: 0, stdout: "TShark 1.10.6 (v1.10.6 from master-1.10)\n", stderr: "" }];
    expect(await captureProbe(fakeToolHost("linux", [old])).available(context)).toEqual({ available: true, version: "1.10.6" });
  });
});
