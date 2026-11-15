import { observe, type Observation } from "../fact.ts";
import { PATH_THROUGHPUT, THROUGHPUT_PROTOCOLS, type PathThroughput, type ThroughputInterval, type ThroughputOutcome, type ThroughputProtocol } from "../kinds.ts";
import { defineProbe, type Availability, type Probe, type ProbeContext } from "../probe.ts";
import { target, type Target } from "../target.ts";
import { ENGLISH, firstLine, integerIn, toolAddress, type ToolAddress } from "./common.ts";
import { AVAILABILITY_TIMEOUT_MS, availabilityOf, runTool, TOOL_MARGIN_MS, type ToolCommand, type ToolHost, type ToolRaw } from "./host.ts";

// The adapter of the tool iperf3. It starts the client of iperf3 against a server that the user operates, and it reads
// the JSON report of the option `-J` (iperf3 3.1 or later). The server is the peer of the scope. The fields of the report
// come from `iperf_print_results` and `iperf_print_intermediate` in `src/iperf_api.c` of iperf3.

/** The input of the iperf3 probe: one throughput test against the iperf3 server at an IP address. */
export interface Iperf3Input {
  readonly address: string;
  /** The port of the server. The default is `DEFAULT_IPERF3_PORT`. */
  readonly port?: number | undefined;
  /** The time of the test, in seconds. The default is `DEFAULT_IPERF3_SECONDS`. */
  readonly seconds?: number | undefined;
  /** The protocol of the test. The default is `tcp`. */
  readonly protocol?: ThroughputProtocol | undefined;
  /** With `true`, the server sends and this computer receives (the option `-R`). The default is `false`. */
  readonly reverse?: boolean | undefined;
  /** The number of parallel streams (the option `-P`). The default is 1. */
  readonly streams?: number | undefined;
  /**
   * The target rate of the sender, in bits per second (the option `-b`). For UDP, the default is
   * `DEFAULT_UDP_BITS_PER_SECOND`. For TCP, the default has no limit.
   */
  readonly bitsPerSecond?: number | undefined;
}

/** The default port of an iperf3 server. */
export const DEFAULT_IPERF3_PORT = 5201;

/** The default time of a test, in seconds. It is the default of iperf3. */
export const DEFAULT_IPERF3_SECONDS = 10;

/** The longest test of one input, in seconds. */
export const MAX_IPERF3_SECONDS = 60;

/** The largest number of parallel streams of one input. */
export const MAX_IPERF3_STREAMS = 16;

/** The default target rate of a UDP test, in bits per second. It is the default of iperf3. */
export const DEFAULT_UDP_BITS_PER_SECOND = 1_000_000;

/** The largest target rate of one input, in bits per second. netdiag does not start a UDP test with no limit. */
export const MAX_IPERF3_BITS_PER_SECOND = 10_000_000_000;

/** The time that the adapter adds for the connection and the exchange of the results, in milliseconds. */
export const IPERF3_SETUP_MS = 5000;

/** The oldest version of iperf3 that the adapter reads, as `[major, minor]`. */
export const IPERF3_MIN_VERSION: readonly [number, number] = [3, 1];

interface CheckedInput extends ToolAddress {
  readonly port: number;
  readonly seconds: number;
  readonly protocol: ThroughputProtocol;
  readonly reverse: boolean;
  readonly streams: number;
  readonly bitsPerSecond?: number | undefined;
}

function checked(input: Iperf3Input): CheckedInput {
  const protocol = input.protocol ?? "tcp";
  if (!(THROUGHPUT_PROTOCOLS as readonly string[]).includes(protocol)) throw new RangeError(`"${String(protocol)}" is not a protocol of iperf3. Use tcp or udp.`);
  const rate = input.bitsPerSecond ?? (protocol === "udp" ? DEFAULT_UDP_BITS_PER_SECOND : undefined);
  return {
    ...toolAddress(input.address),
    port: integerIn(input.port ?? DEFAULT_IPERF3_PORT, 1, 65535, "a port"),
    seconds: integerIn(input.seconds ?? DEFAULT_IPERF3_SECONDS, 1, MAX_IPERF3_SECONDS, "a time in seconds"),
    protocol,
    reverse: input.reverse === true,
    streams: integerIn(input.streams ?? 1, 1, MAX_IPERF3_STREAMS, "a number of streams"),
    bitsPerSecond: rate === undefined ? undefined : integerIn(rate, 1, MAX_IPERF3_BITS_PER_SECOND, "a rate in bits per second"),
  };
}

/**
 * This function gives the command of the iperf3 client for an input. The command is the same on each operating system.
 * It throws for an input that is not valid.
 *
 * The time limit is the time of the test, plus `IPERF3_SETUP_MS` and `TOOL_MARGIN_MS`.
 */
export function iperf3Command(input: Iperf3Input): ToolCommand {
  const { address, port, seconds, protocol, reverse, streams, bitsPerSecond } = checked(input);
  const args = ["-c", address, "-p", String(port), "-t", String(seconds), "-P", String(streams), "-J"];
  if (protocol === "udp") args.push("-u");
  if (bitsPerSecond !== undefined) args.push("-b", String(bitsPerSecond));
  if (reverse) args.push("-R");
  return { command: "iperf3", args, timeoutMs: seconds * 1000 + IPERF3_SETUP_MS + TOOL_MARGIN_MS, env: ENGLISH };
}

/** This function tells if iperf3 is available on the host. It refuses a version before `IPERF3_MIN_VERSION`. */
export async function iperf3Availability(host: ToolHost, context: ProbeContext): Promise<Availability> {
  const output = await host.run("iperf3", ["--version"], { timeoutMs: AVAILABILITY_TIMEOUT_MS, signal: context.signal, env: ENGLISH });
  const availability = availabilityOf("iperf3", output, /^iperf (\d[\d.]*)/m);
  if (!availability.available || availability.version === undefined) return availability;
  const [major = 0, minor = 0] = availability.version.split(".").map(Number);
  const [minMajor, minMinor] = IPERF3_MIN_VERSION;
  if (major < minMajor || (major === minMajor && minor < minMinor)) {
    return { available: false, reason: `netdiag reads the JSON report of iperf3 ${minMajor}.${minMinor} or later. This iperf3 is ${availability.version}.` };
  }
  return availability;
}

type Json = Readonly<Record<string, unknown>>;

function objectOf(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

/** This function gives a finite number of zero or more, or `undefined`. */
function amount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** This function gives an integer of zero or more, or `undefined`. iperf3 writes -1 for a count that it does not know. */
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * This function gives a time of the report in milliseconds, or `undefined`. iperf3 measures times in microseconds, so
 * the rounding keeps each digit.
 */
function milliseconds(value: unknown): number | undefined {
  const seconds = amount(value);
  if (seconds === undefined) return undefined;
  const ms = Math.round(seconds * 1e6) / 1e3;
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * This function reads one sum of the report: the sum of an interval, or a sum of the end. It gives `undefined` when a
 * field that each sum has is absent. An optional field with a value out of range is absent, for example a negative loss.
 */
function readSum(value: unknown): ThroughputInterval | undefined {
  const sum = objectOf(value);
  if (sum === undefined) return undefined;
  const startMs = milliseconds(sum["start"]);
  const endMs = milliseconds(sum["end"]);
  const bytes = count(sum["bytes"]);
  const bitsPerSecond = amount(sum["bits_per_second"]);
  if (startMs === undefined || endMs === undefined || startMs > endMs || bytes === undefined || bitsPerSecond === undefined) return undefined;
  const retransmits = count(sum["retransmits"]);
  const datagrams = count(sum["packets"]);
  const lostDatagrams = count(sum["lost_packets"]);
  const jitterMs = amount(sum["jitter_ms"]);
  return {
    startMs,
    endMs,
    bytes,
    bitsPerSecond,
    ...(retransmits === undefined ? {} : { retransmits }),
    ...(datagrams === undefined ? {} : { datagrams }),
    ...(lostDatagrams === undefined || (datagrams !== undefined && lostDatagrams > datagrams) ? {} : { lostDatagrams }),
    ...(jitterMs === undefined ? {} : { jitterMs }),
  };
}

/** This function gives the JSON object of the report, or `undefined` when the text is not such an object. */
function reportOf(text: string): Json | undefined {
  try {
    return objectOf(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** This function gives the outcome of the text of the field `error` of a report. */
function failureOf(text: string): ThroughputOutcome {
  if (/\bConnection refused\b/i.test(text)) return "refused";
  if (/\bserver is busy\b/i.test(text)) return "busy";
  return "error";
}

/** The fields of the result for an input, before the reader reads the report. */
type Settings = Pick<PathThroughput, "address" | "port" | "protocol" | "reverse" | "streams" | "seconds">;

function settingsOf(input: Iperf3Input): Settings {
  return {
    address: input.address,
    port: input.port ?? DEFAULT_IPERF3_PORT,
    protocol: input.protocol ?? "tcp",
    reverse: input.reverse === true,
    streams: input.streams ?? 1,
    seconds: input.seconds ?? DEFAULT_IPERF3_SECONDS,
  };
}

/** This function reads the intervals of a report, or gives the number of the first interval that it cannot read. */
function readIntervals(value: unknown): readonly ThroughputInterval[] | number {
  if (!Array.isArray(value)) return 1;
  const intervals: ThroughputInterval[] = [];
  for (const entry of value) {
    const sum = readSum(objectOf(entry)?.["sum"]);
    if (sum === undefined) return intervals.length + 1;
    intervals.push(sum);
  }
  return intervals;
}

/**
 * This function reads the raw output of the iperf3 probe into the value of a fact `path.throughput`.
 *
 * - A report with the field `error` gives the outcome `refused`, `busy` or `error`, with the text of the field.
 * - For TCP, the rates come from `end.sum_sent` and `end.sum_received`. For UDP, they come from `end.sum`, and from
 *   `end.sum_sent` and `end.sum_received` when the report has them.
 * - Output that netdiag cannot read gives the outcome `error` with the reason.
 */
export function readIperf3(raw: ToolRaw, input: Iperf3Input): PathThroughput {
  const settings = settingsOf(input);
  const failed = (outcome: ThroughputOutcome, detail: string): PathThroughput => ({ ...settings, outcome, intervals: [], detail });
  if (raw.error !== undefined) return failed("error", raw.error);
  if (raw.timedOut === true) return failed("error", "The time limit stopped iperf3 before its report.");
  const report = reportOf(raw.stdout);
  if (report === undefined) return failed("error", firstLine(raw.stderr) ?? "netdiag cannot read the JSON report of iperf3.");
  const error = report["error"];
  if (typeof error === "string") return failed(failureOf(error), error.replace(/^error - /, "").trim() || "iperf3 gave an error with no text.");
  const end = objectOf(report["end"]);
  if (end === undefined) return failed("error", "The report of iperf3 has no end. netdiag reads iperf3 3.1 or later.");
  const intervals = readIntervals(report["intervals"]);
  if (typeof intervals === "number") return failed("error", `netdiag cannot read the interval ${intervals} of the report of iperf3.`);
  if (settings.protocol === "tcp") {
    const sent = readSum(end["sum_sent"]);
    const received = readSum(end["sum_received"]);
    if (sent === undefined || received === undefined) return failed("error", "The report of iperf3 has no end.sum_sent or no end.sum_received.");
    return {
      ...settings,
      outcome: "measured",
      sentBitsPerSecond: sent.bitsPerSecond,
      receivedBitsPerSecond: received.bitsPerSecond,
      sentBytes: sent.bytes,
      receivedBytes: received.bytes,
      ...(sent.retransmits === undefined ? {} : { retransmits: sent.retransmits }),
      intervals,
    };
  }
  const sum = readSum(end["sum"]);
  if (sum === undefined) return failed("error", "The report of iperf3 has no end.sum for UDP.");
  // iperf3 3.10 and later also write end.sum_sent and end.sum_received for UDP. The rate of end.sum is the rate of the sender.
  const sent = readSum(end["sum_sent"]) ?? sum;
  const received = readSum(end["sum_received"]);
  return {
    ...settings,
    outcome: "measured",
    sentBitsPerSecond: sent.bitsPerSecond,
    sentBytes: sent.bytes,
    ...(received === undefined ? {} : { receivedBitsPerSecond: received.bitsPerSecond, receivedBytes: received.bytes }),
    ...(sum.jitterMs === undefined ? {} : { jitterMs: sum.jitterMs }),
    ...(sum.lostDatagrams === undefined ? {} : { lostDatagrams: sum.lostDatagrams }),
    ...(sum.datagrams === undefined ? {} : { datagrams: sum.datagrams }),
    intervals,
  };
}

/**
 * This function makes the probe `path.iperf3`: one throughput test of the tool iperf3 against a server that the user
 * operates. The host starts the tool.
 */
export function iperf3Probe(host: ToolHost): Probe<Iperf3Input, ToolRaw> {
  return defineProbe<Iperf3Input, ToolRaw>({
    id: "path.iperf3",
    version: "1",
    summary: "The rates of a TCP or UDP throughput test of the tool iperf3 against the iperf3 server at one IP address.",
    layer: "path",
    mode: "active",
    kinds: [PATH_THROUGHPUT],
    tool: "iperf3",
    peers: (input): readonly Target[] => {
      const { address, port } = checked(input);
      return [target(address, port)];
    },
    available: (context) => iperf3Availability(host, context),
    run: (input, context) => runTool(host, iperf3Command(input), context),
    parse: (raw, input): readonly Observation[] => [observe(PATH_THROUGHPUT, target(input.address, settingsOf(input).port), readIperf3(raw, input), { start: raw.start, end: raw.end })],
  });
}
