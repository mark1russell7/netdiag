import { addressFamily, canonicalAddress } from "../address/index.ts";
import { observe, type Observation } from "../fact.ts";
import { CAPTURE_PROTOCOLS, PATH_CAPTURE, type CaptureProtocol, type CapturedPacket, type PathCapture } from "../kinds.ts";
import { defineProbe, type Availability, type Probe, type ProbeContext } from "../probe.ts";
import { target, type Target } from "../target.ts";
import { ENGLISH, firstLine, integerIn, LINES, toolAddress } from "./common.ts";
import { AVAILABILITY_TIMEOUT_MS, availabilityOf, runTool, TOOL_MARGIN_MS, type ToolCommand, type ToolHost, type ToolRaw } from "./host.ts";

// The adapter of the tool tshark. It captures the packets of one flow for a limited time or a limited number of packets,
// and it reads the fields of each packet from the output `-T fields`. The names of the fields come from the display
// filter reference of Wireshark. The capture filter comes from typed fields, so a host out of the scope cannot enter it.

/** The input of the capture probe: the packets of one flow on one network interface. */
export interface CaptureInput {
  /** The network interface, for example `eth0`. On Windows, a name or a number from the list of `tshark -D`. */
  readonly device: string;
  /** The IP address at one end of the flow. */
  readonly address: string;
  /** The port of the flow. A capture with no port takes each port. */
  readonly port?: number | undefined;
  /** The protocol of the flow. A capture with no protocol takes each protocol. */
  readonly protocol?: CaptureProtocol | undefined;
  /** The longest time of the capture, in seconds. The default is `DEFAULT_CAPTURE_SECONDS`. */
  readonly seconds?: number | undefined;
  /** The largest number of packets. The default is `DEFAULT_CAPTURE_PACKETS`. */
  readonly packets?: number | undefined;
}

/** The default time of a capture, in seconds. */
export const DEFAULT_CAPTURE_SECONDS = 10;

/** The longest capture of one input, in seconds. */
export const MAX_CAPTURE_SECONDS = 120;

/** The default largest number of packets of a capture. */
export const DEFAULT_CAPTURE_PACKETS = 1000;

/** The largest number of packets of one input. */
export const MAX_CAPTURE_PACKETS = 10_000;

/** The time that the adapter adds for the start of `tshark` and its capture program, in milliseconds. */
export const CAPTURE_SETUP_MS = 5000;

/** The fields of each line of the output, in the order of the columns. */
export const CAPTURE_FIELDS: readonly string[] = [
  "frame.time_epoch",
  "ip.src",
  "ip.dst",
  "ipv6.src",
  "ipv6.dst",
  "tcp.srcport",
  "tcp.dstport",
  "tcp.seq",
  "tcp.ack",
  "tcp.len",
  "tcp.flags",
  "tcp.analysis.retransmission",
  "tcp.analysis.ack_rtt",
  "udp.srcport",
  "udp.dstport",
  "frame.len",
];

/** The pattern of the name of a network interface: no space or `-` at the start, and no control character. */
const DEVICE = /^[^\s\p{Cc}-][^\p{Cc}]{0,254}$/u;

interface CheckedInput {
  readonly device: string;
  readonly address: string;
  readonly port?: number | undefined;
  readonly protocol?: CaptureProtocol | undefined;
  readonly filter: string;
  readonly seconds: number;
  readonly packets: number;
}

/**
 * This function gives the capture filter of a flow, in the syntax of libpcap. It throws for a host that is not an IP
 * address and for a port out of range. It also throws for an unknown protocol and for an ICMP flow with a port.
 *
 * - The filter `ip host` or `ip6 host` takes only IP packets of the address, not ARP.
 * - For ICMP, the filter takes `icmp` for IPv4 and `icmp6` for IPv6.
 */
export function captureFilter(flow: Pick<CaptureInput, "address" | "port" | "protocol">): string {
  const { address, family } = toolAddress(flow.address);
  const { protocol } = flow;
  if (protocol !== undefined && !(CAPTURE_PROTOCOLS as readonly string[]).includes(protocol)) {
    throw new RangeError(`"${String(protocol)}" is not a protocol of a capture. Use tcp, udp or icmp.`);
  }
  const port = flow.port === undefined ? undefined : integerIn(flow.port, 1, 65535, "a port");
  const host = `${family === "ipv6" ? "ip6" : "ip"} host ${address}`;
  if (protocol === "icmp") {
    if (port !== undefined) throw new RangeError("An ICMP flow has no port.");
    return `${host} and ${family === "ipv6" ? "icmp6" : "icmp"}`;
  }
  if (port === undefined) return protocol === undefined ? host : `${host} and ${protocol}`;
  return protocol === undefined ? `${host} and port ${port}` : `${host} and ${protocol} port ${port}`;
}

function checked(input: CaptureInput): CheckedInput {
  if (typeof input.device !== "string" || !DEVICE.test(input.device)) {
    throw new RangeError(`"${String(input.device)}" is not the name of a network interface.`);
  }
  const filter = captureFilter(input);
  return {
    device: input.device,
    address: toolAddress(input.address).address,
    port: input.port,
    protocol: input.protocol,
    filter,
    seconds: integerIn(input.seconds ?? DEFAULT_CAPTURE_SECONDS, 1, MAX_CAPTURE_SECONDS, "a time in seconds"),
    packets: integerIn(input.packets ?? DEFAULT_CAPTURE_PACKETS, 1, MAX_CAPTURE_PACKETS, "a number of packets"),
  };
}

/**
 * This function gives the command of `tshark` for an input. The command is the same on each operating system. It
 * throws for an input that is not valid.
 *
 * - `-n` stops the name lookups, so the capture sends no DNS query.
 * - `-p` keeps the interface out of promiscuous mode, so the capture takes only the packets of this computer.
 * - `-a duration` and `-c` stop the capture at the first of the two limits.
 * - The two `-o` options make the TCP fields independent of the preferences of the user.
 */
export function captureCommand(input: CaptureInput): ToolCommand {
  const { device, filter, seconds, packets } = checked(input);
  return {
    command: "tshark",
    args: [
      "-n",
      "-p",
      "-i",
      device,
      "-f",
      filter,
      "-a",
      `duration:${seconds}`,
      "-c",
      String(packets),
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
    timeoutMs: seconds * 1000 + CAPTURE_SETUP_MS + TOOL_MARGIN_MS,
    env: ENGLISH,
  };
}

/** This function tells if `tshark` is available on the host. It does not examine the privilege to capture. */
export async function captureAvailability(host: ToolHost, context: ProbeContext): Promise<Availability> {
  const output = await host.run("tshark", ["--version"], { timeoutMs: AVAILABILITY_TIMEOUT_MS, signal: context.signal, env: ENGLISH });
  return availabilityOf("tshark", output, /^TShark (?:\(Wireshark\) )?(\d[\d.]*)/m);
}

/** A time of `frame.time_epoch`: the seconds since 1970 and the nanoseconds after them. */
interface Epoch {
  readonly text: string;
  readonly seconds: number;
  readonly nanos: number;
}

/** This function reads a decimal number of seconds into whole seconds and nanoseconds, with no rounding. */
function secondsOf(text: string, wholeDigits: RegExp): { readonly seconds: number; readonly nanos: number } | undefined {
  const parts = wholeDigits.exec(text);
  if (parts === null) return undefined;
  return { seconds: Number(parts[1]), nanos: Number((parts[2] ?? "").padEnd(9, "0")) };
}

function epochOf(text: string): Epoch | undefined {
  const time = secondsOf(text, /^(\d{1,12})(?:\.(\d{1,9}))?$/);
  return time === undefined ? undefined : { text, ...time };
}

/** This function reads a time offset of `tshark` in seconds, for example `0.000123000`, into milliseconds. */
function millisecondsOf(text: string): number | undefined {
  const time = secondsOf(text, /^(\d{1,6})(?:\.(\d{1,9}))?$/);
  return time === undefined ? undefined : (time.seconds * 1e9 + time.nanos) / 1e6;
}

function unsignedOf(max: number): (text: string) => number | undefined {
  return (text) => (/^\d{1,10}$/.test(text) && Number(text) <= max ? Number(text) : undefined);
}

const portOf = unsignedOf(65535);
const uint32Of = unsignedOf(0xffff_ffff);

/** This function reads the TCP flags. `tshark` writes them as hexadecimal, for example `0x0012`. A decimal number also passes. */
function flagsOf(text: string): number | undefined {
  if (/^0x[\da-f]{1,8}$/i.test(text)) return Number.parseInt(text.slice(2), 16);
  return uint32Of(text);
}

function ipOf(text: string): string | undefined {
  return addressFamily(text) === undefined ? undefined : canonicalAddress(text);
}

/** One line of the output before the reader knows the time of the first packet. */
interface PacketLine {
  readonly epoch: Epoch;
  readonly packet: Omit<CapturedPacket, "atMs">;
}

const column = (field: string): number => CAPTURE_FIELDS.indexOf(field);

/** This function reads the columns of one line. It gives the name of the first field that it cannot read. */
function readLine(columns: readonly string[]): PacketLine | string {
  let unread: string | undefined;
  function read<T>(field: string, parse: (text: string) => T | undefined): T | undefined {
    const text = columns[column(field)] ?? "";
    if (text === "") return undefined;
    const value = parse(text);
    if (value === undefined) unread ??= field;
    return value;
  }
  const epoch = read("frame.time_epoch", epochOf);
  const bytes = read("frame.len", uint32Of);
  const v4 = [read("ip.src", ipOf), read("ip.dst", ipOf)] as const;
  const v6 = [read("ipv6.src", ipOf), read("ipv6.dst", ipOf)] as const;
  const [src, dst] = v4[0] !== undefined ? v4 : v6;
  const tcp = { srcPort: read("tcp.srcport", portOf), dstPort: read("tcp.dstport", portOf) };
  const udp = { srcPort: read("udp.srcport", portOf), dstPort: read("udp.dstport", portOf) };
  const seq = read("tcp.seq", uint32Of);
  const ack = read("tcp.ack", uint32Of);
  const payload = read("tcp.len", uint32Of);
  const flags = read("tcp.flags", flagsOf);
  const retransmission = read("tcp.analysis.retransmission", () => true) ?? false;
  const ackRttMs = read("tcp.analysis.ack_rtt", millisecondsOf);
  if (unread !== undefined) return unread;
  if (epoch === undefined) return "frame.time_epoch";
  if (bytes === undefined) return "frame.len";
  if (src === undefined || dst === undefined) return v4[0] === undefined ? "ipv6.src" : "ip.dst";
  if (tcp.srcPort !== undefined && tcp.dstPort !== undefined) {
    const packet: Omit<CapturedPacket, "atMs"> = {
      src,
      dst,
      protocol: "tcp",
      ...tcp,
      ...(seq === undefined ? {} : { seq }),
      ...(ack === undefined ? {} : { ack }),
      ...(payload === undefined ? {} : { payload }),
      ...(flags === undefined ? {} : { flags }),
      retransmission,
      ...(ackRttMs === undefined ? {} : { ackRttMs }),
      bytes,
    };
    return { epoch, packet };
  }
  if (udp.srcPort !== undefined && udp.dstPort !== undefined) return { epoch, packet: { src, dst, protocol: "udp", ...udp, bytes } };
  return { epoch, packet: { src, dst, protocol: "other", bytes } };
}

/** This function tells if the time `a` comes before the time `b`. */
function before(a: Epoch, b: Epoch): boolean {
  return a.seconds < b.seconds || (a.seconds === b.seconds && a.nanos < b.nanos);
}

/** The lines of `tshark` on stderr that tell no failure. */
const INFO = /^(?:Capturing on |Running as user |\d+ packets? (?:captured|dropped))/;

/** This function gives the text of the failure of `tshark` on stderr. */
function failureOf(stderr: string): string | undefined {
  const lines = stderr.split(LINES).map((line) => line.trim());
  const tool = lines.find((line) => line.startsWith("tshark: "));
  if (tool !== undefined) return tool.slice("tshark: ".length);
  return firstLine(lines.filter((line) => !INFO.test(line)).join("\n"));
}

/**
 * This function reads the raw output of the capture probe into the value of a fact `path.capture`.
 *
 * - Each line of the output is one packet. The time of each packet is relative to the first packet.
 * - A line that netdiag cannot read gives the outcome `error`. netdiag does not give a packet that it did not read.
 * - A failure of `tshark`, for example no privilege to capture, gives the outcome `error` with the text of `tshark`.
 */
export function readCapture(raw: ToolRaw, input: CaptureInput): PathCapture {
  const base = {
    address: input.address,
    ...(input.port === undefined ? {} : { port: input.port }),
    ...(input.protocol === undefined ? {} : { protocol: input.protocol }),
    device: input.device,
    filter: captureFilter(input),
  };
  const error = (detail: string): PathCapture => ({ ...base, outcome: "error", packets: [], detail });
  if (raw.error !== undefined) return error(raw.error);
  if (raw.timedOut === true) return error("The time limit stopped tshark before the end of the capture.");
  if (raw.exitCode !== 0) return error(failureOf(raw.stderr) ?? `tshark ended with the exit code ${raw.exitCode}.`);
  const lines: PacketLine[] = [];
  for (const line of raw.stdout.split(LINES)) {
    if (line.length === 0) continue;
    const columns = line.split("\t");
    if (columns.length !== CAPTURE_FIELDS.length) return error(`netdiag cannot read the packet ${lines.length + 1} of tshark. It has ${columns.length} fields, not ${CAPTURE_FIELDS.length}.`);
    const read = readLine(columns);
    if (typeof read === "string") return error(`netdiag cannot read the field ${read} of the packet ${lines.length + 1} of tshark.`);
    lines.push(read);
  }
  const dropped = /^(\d{1,15}) packets? dropped\b/m.exec(raw.stderr)?.[1];
  const counts = dropped === undefined ? {} : { dropped: Number(dropped) };
  const first = lines.reduce<Epoch | undefined>((earliest, { epoch }) => (earliest === undefined || before(epoch, earliest) ? epoch : earliest), undefined);
  if (first === undefined) return { ...base, outcome: "none", packets: [], ...counts };
  const packets = lines.map(({ epoch, packet }): CapturedPacket => ({ atMs: ((epoch.seconds - first.seconds) * 1e9 + (epoch.nanos - first.nanos)) / 1e6, ...packet }));
  return { ...base, outcome: "captured", epoch: first.text, packets, ...counts };
}

/**
 * This function makes the probe `path.capture`: a capture of the packets of one flow with the tool `tshark`. The host
 * starts the tool. The capture needs the privilege to capture on the interface.
 *
 * The capture sends no packet. Its mode is `active`, so that the runner examines the host of the filter against the scope.
 */
export function captureProbe(host: ToolHost): Probe<CaptureInput, ToolRaw> {
  return defineProbe<CaptureInput, ToolRaw>({
    id: "path.capture",
    version: "1",
    summary: "The packets of one flow to or from one IP address, from a capture of the tool tshark for a limited time.",
    layer: "path",
    mode: "active",
    kinds: [PATH_CAPTURE],
    tool: "tshark",
    peers: (input): readonly Target[] => {
      const { address, port } = checked(input);
      return [target(address, port)];
    },
    available: (context) => captureAvailability(host, context),
    run: (input, context) => runTool(host, captureCommand(input), context),
    parse: (raw, input): readonly Observation[] => [observe(PATH_CAPTURE, target(input.address, input.port), readCapture(raw, input), { start: raw.start, end: raw.end })],
  });
}
