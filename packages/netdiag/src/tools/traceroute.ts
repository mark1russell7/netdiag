import { isIP } from "node:net";
import { observe, type Observation } from "../fact.ts";
import { PATH_TRACE, type PathTrace, type TraceHop } from "../kinds.ts";
import { defineProbe, type Availability, type Probe, type ProbeContext } from "../probe.ts";
import { target, type Target } from "../target.ts";
import { ENGLISH, firstLine, integerIn, LINES, LOCAL_UNREACHABLE, sameAddress, toolAddress, type ToolAddress } from "./common.ts";
import { AVAILABILITY_TIMEOUT_MS, availabilityOf, runTool, TOOL_MARGIN_MS, type ToolCommand, type ToolHost, type ToolRaw } from "./host.ts";

// The adapter of the tool traceroute. It reads the English output of the Modern traceroute for Linux, of the BSD
// traceroute and traceroute6 on macOS, and of tracert.exe on Windows. Each tool sends `TRACE_QUERIES` probes for each TTL.

/** The input of the traceroute probe: the path to one IP address. */
export interface TraceInput {
  readonly address: string;
  /** The largest TTL. The default is `DEFAULT_TRACE_HOPS`. */
  readonly maxHops?: number | undefined;
  /** The time to wait for each answer, in milliseconds. On Linux and macOS, the tool rounds it up to full seconds. */
  readonly waitMs?: number | undefined;
}

/** The default largest TTL. */
export const DEFAULT_TRACE_HOPS = 30;

/** The largest TTL of one input. */
export const MAX_TRACE_HOPS = 64;

/** The default time to wait for each answer, in milliseconds. */
export const DEFAULT_TRACE_WAIT_MS = 1000;

/** The number of probes for each TTL. `tracert` on Windows always sends 3 probes. */
export const TRACE_QUERIES = 3;

interface CheckedInput extends ToolAddress {
  readonly maxHops: number;
  readonly waitMs: number;
}

function checked(input: TraceInput): CheckedInput {
  return {
    ...toolAddress(input.address),
    maxHops: integerIn(input.maxHops ?? DEFAULT_TRACE_HOPS, 1, MAX_TRACE_HOPS, "a number of hops"),
    waitMs: integerIn(input.waitMs ?? DEFAULT_TRACE_WAIT_MS, 1, 10_000, "a time in milliseconds"),
  };
}

/**
 * This function gives the command of traceroute for an operating system and an input. For an operating system that the
 * adapter does not know, it gives `undefined`. It throws for an input that is not valid.
 *
 * - Linux: `traceroute`, with UDP probes. A user without privileges can send them.
 * - macOS: `traceroute`, and `traceroute6` for an IPv6 address.
 * - Windows: `tracert.exe`, with ICMP echo requests.
 *
 * The time limit is the time of a trace that waits for each probe of each hop.
 */
export function tracerouteCommand(platform: string, input: TraceInput): ToolCommand | undefined {
  const { address, family, maxHops, waitMs } = checked(input);
  const waitS = Math.ceil(waitMs / 1000);
  const unix = ["-n", "-q", String(TRACE_QUERIES), "-w", String(waitS), "-m", String(maxHops)];
  const unixTimeoutMs = maxHops * TRACE_QUERIES * waitS * 1000 + TOOL_MARGIN_MS;
  switch (platform) {
    case "linux":
      return { command: "traceroute", args: [family === "ipv6" ? "-6" : "-4", ...unix, address], timeoutMs: unixTimeoutMs, env: ENGLISH };
    case "darwin":
      return { command: family === "ipv6" ? "traceroute6" : "traceroute", args: [...unix, address], timeoutMs: unixTimeoutMs, env: ENGLISH };
    case "win32":
      return { command: "tracert", args: ["-d", "-h", String(maxHops), "-w", String(waitMs), address], timeoutMs: maxHops * TRACE_QUERIES * waitMs + TOOL_MARGIN_MS };
    default:
      return undefined;
  }
}

/** The command that examines if traceroute is available on each operating system, and the pattern of its version. */
const AVAILABILITY: Readonly<Record<string, { readonly command: string; readonly args: readonly string[]; readonly version?: RegExp }>> = {
  linux: { command: "traceroute", args: ["--version"], version: /version (\d[\d.]*)/ },
  darwin: { command: "traceroute", args: [] },
  win32: { command: "tracert", args: ["/?"] },
};

/** This function tells if traceroute is available on the host. On Linux, netdiag reads only the Modern traceroute for Linux. */
export async function tracerouteAvailability(host: ToolHost, context: ProbeContext): Promise<Availability> {
  const check = AVAILABILITY[host.platform];
  if (check === undefined) return { available: false, reason: `netdiag reads the output of traceroute only on Linux, macOS and Windows, not on ${host.platform}.` };
  const output = await host.run(check.command, check.args, { timeoutMs: AVAILABILITY_TIMEOUT_MS, signal: context.signal, env: ENGLISH });
  if (host.platform === "linux" && output.error === undefined && !/Modern traceroute/i.test(`${output.stdout}\n${output.stderr}`)) {
    return { available: false, reason: "netdiag reads only the Modern traceroute for Linux (the package traceroute). This traceroute does not tell that name." };
  }
  return availabilityOf(check.command, output, check.version);
}

/** The flags of the Linux and BSD traceroute after the time of an answer, and their meaning. */
const FLAGS: Readonly<Record<string, string>> = {
  "!H": "host unreachable",
  "!N": "network unreachable",
  "!P": "protocol unreachable",
  "!S": "source route failed",
  "!F": "fragmentation needed",
  "!X": "communication administratively prohibited",
  "!A": "communication with the network administratively prohibited",
  "!Z": "communication with the host administratively prohibited",
  "!U": "destination network unknown",
  "!W": "destination host unknown",
  "!V": "host precedence violation",
  "!C": "precedence cutoff",
};

/** This function gives the meaning of a flag, or `undefined` for the flag `!` alone. That flag tells only that the TTL of the answer is 1 or less. */
function flagText(flag: string): string | undefined {
  if (flag === "!") return undefined;
  const code = /^!<?(\d+)>?$/.exec(flag)?.[1];
  if (code !== undefined) return `unreachable, ICMP code ${code} (${flag})`;
  const known = FLAGS[flag.replace(/^(!F)-?\d+$/, "$1")];
  return `${known ?? "unreachable"} (${flag})`;
}

/** The hops that netdiag reads in the output of a trace, and the facts about the output. */
interface TraceLines {
  readonly hops: readonly TraceHop[];
  /** This field is true when the output has the header of the tool. Output in another language has no such header. */
  readonly header: boolean;
  /** This field is true when the output has the last line of a trace (`tracert` only). */
  readonly complete: boolean;
  /** The first hop that netdiag cannot read. */
  readonly unread?: number | undefined;
  /** A failure of this computer to send a probe. */
  readonly failure?: string | undefined;
  /** A message of this computer that tells that the address is unreachable. */
  readonly local?: string | undefined;
}

/** One hop while the reader reads it. */
class HopBuilder {
  readonly addresses: string[] = [];
  readonly rttMs: number[] = [];
  sent = 0;
  received = 0;
  unreachable: string | undefined;
  /** This field is true when a time comes before an address. */
  unread = false;
  readonly ttl: number;
  private current: string | undefined;

  constructor(ttl: number) {
    this.ttl = ttl;
  }

  address(text: string): void {
    this.current = text;
    if (!this.addresses.some((known) => sameAddress(known, text))) this.addresses.push(text);
  }

  lost(): void {
    this.sent += 1;
  }

  answer(rttMs: number | undefined): void {
    this.sent += 1;
    if (this.current === undefined) {
      this.unread = true;
      return;
    }
    this.received += 1;
    if (rttMs !== undefined) this.rttMs.push(rttMs);
  }

  hop(): TraceHop {
    const hop = { ttl: this.ttl, addresses: [...this.addresses], sent: this.sent, received: this.received, rttMs: [...this.rttMs] };
    return this.unreachable === undefined ? hop : { ...hop, unreachable: this.unreachable };
  }
}

/** This function gives the address of a token, for example `192.0.2.1` or `(192.0.2.1)`, or `undefined`. */
function addressOf(token: string): string | undefined {
  const text = token.replace(/^\((.*)\)$/, "$1");
  return isIP(text) === 0 ? undefined : text;
}

/** The failed system calls of traceroute on Linux and macOS, for example `socket: Operation not permitted`. */
const SEND_FAILURE = /^(?:socket|bind|connect|sendmsg|sendto|send): \S/;

function readUnix(stdout: string, stderr: string): TraceLines {
  const builders: HopBuilder[] = [];
  for (const line of stdout.split(LINES)) {
    const numbered = /^\s*(\d+)\s(.*)$/.exec(line);
    // macOS writes another address of the same TTL on a line with no number.
    const continued = numbered === null && /^\s+\S/.test(line) ? builders.at(-1) : undefined;
    if (numbered === null && continued === undefined) continue;
    const builder = continued ?? new HopBuilder(Number(numbered?.[1]));
    if (continued === undefined) builders.push(builder);
    const tokens = (numbered?.[2] ?? line).trim().split(/\s+/);
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i] ?? "";
      const address = addressOf(token);
      const time = /^(\d+(?:\.\d+)?)(ms)?$/.exec(token);
      if (token === "*") builder.lost();
      else if (address !== undefined) builder.address(address);
      else if (time !== null && (time[2] === "ms" || tokens[i + 1] === "ms")) {
        builder.answer(Number(time[1]));
        if (time[2] === undefined) i += 1;
      } else if (token.startsWith("!")) builder.unreachable ??= flagText(token);
    }
  }
  let failure: string | undefined;
  let local: string | undefined;
  for (const line of stderr.split(LINES)) {
    const text = line.replace(/^traceroute6?:\s*/, "").trim();
    const unreachable = LOCAL_UNREACHABLE.exec(text);
    if (unreachable !== null) local ??= unreachable[1] ?? text;
    else if (SEND_FAILURE.test(text)) failure ??= text;
  }
  const header = /^traceroute6? to /m.test(`${stdout}\n${stderr}`);
  return { hops: builders.map((b) => b.hop()), header, complete: true, unread: builders.find((b) => b.unread)?.ttl, failure, local };
}

/** The text between the address of a router and its message in the output of `tracert`. */
const REPORTS = " reports: ";

function readWindows(stdout: string): TraceLines {
  const builders: HopBuilder[] = [];
  let failure: string | undefined;
  for (const line of stdout.split(LINES)) {
    const numbered = /^\s*(\d+)\s(.*)$/.exec(line);
    if (numbered === null) continue;
    const builder = new HopBuilder(Number(numbered[1]));
    builders.push(builder);
    // "  2     *        *     192.168.1.191  reports: Destination host unreachable."
    const rest = (numbered[2] ?? "").trim();
    const at = rest.indexOf(REPORTS);
    const tokens = (at < 0 ? rest : rest.slice(0, at)).split(/\s+/).filter((token) => token.length > 0);
    // tracert writes the address after the times of the hop.
    const address = tokens.map(addressOf).find((found) => found !== undefined);
    if (address !== undefined) builder.address(address);
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i] ?? "";
      // "<1 ms" counts as 1 ms, as in the output of ping.
      const time = /^<?(\d+)$/.exec(token);
      if (token === "*") builder.lost();
      else if (time !== null && tokens[i + 1] === "ms") {
        builder.answer(Math.max(1, Number(time[1])));
        i += 1;
      } else if (/^(General failure|Transmit error)/i.test(tokens.slice(i).join(" "))) {
        failure ??= tokens.slice(i).join(" ").replace(/\.$/, "");
        break;
      }
    }
    if (at >= 0) {
      builder.answer(undefined);
      builder.unreachable = rest
        .slice(at + REPORTS.length)
        .trim()
        .replace(/\.$/, "");
    }
  }
  return {
    hops: builders.map((b) => b.hop()),
    header: /^Tracing route to /m.test(stdout),
    complete: /^Trace complete\./m.test(stdout),
    unread: builders.find((b) => b.unread)?.ttl,
    failure,
  };
}

/**
 * This function reads the raw output of the traceroute probe into the value of a fact `path.trace`.
 *
 * - The outcome is `reached` when the address answered at the last hop.
 * - Output that netdiag cannot read gives the outcome `error`. An `error` keeps the hops that netdiag read.
 */
export function readTraceroute(raw: ToolRaw, input: { readonly address: string; readonly maxHops?: number | undefined }): PathTrace {
  const { address } = input;
  const maxHops = input.maxHops ?? DEFAULT_TRACE_HOPS;
  const result = (outcome: PathTrace["outcome"], hops: readonly TraceHop[], detail?: string): PathTrace =>
    detail === undefined ? { address, outcome, maxHops, hops } : { address, outcome, maxHops, hops, detail };
  if (raw.error !== undefined) return result("error", [], raw.error);
  const lines = raw.platform === "win32" ? readWindows(raw.stdout) : readUnix(raw.stdout, raw.stderr);
  const { hops, header, complete, unread, failure, local } = lines;
  if (unread !== undefined) return result("error", hops.filter((hop) => hop.ttl < unread), `netdiag cannot read the hop ${unread} of traceroute.`);
  // Output in another language has numbered lines too, but no English header.
  if (!header && local === undefined) {
    return result("error", [], failure ?? firstLine(raw.stderr) ?? "netdiag cannot read the output of traceroute. netdiag reads only English output.");
  }
  if (raw.timedOut === true || !complete) return result("error", hops, "The time limit stopped traceroute before its end.");
  const last = hops.at(-1);
  if (last?.addresses.some((known) => sameAddress(known, address)) === true) return result("reached", hops);
  if (last?.unreachable !== undefined) return result("unreachable", hops, last.unreachable);
  if (local !== undefined) return result("unreachable", hops, local);
  if (failure !== undefined) return result("error", hops, failure);
  return result("stopped", hops);
}

/**
 * This function makes the probe `path.traceroute`: the trace of the path to one IP address with the tool traceroute,
 * or `tracert` on Windows. The host starts the tool.
 */
export function tracerouteProbe(host: ToolHost): Probe<TraceInput, ToolRaw> {
  return defineProbe<TraceInput, ToolRaw>({
    id: "path.traceroute",
    version: "1",
    summary: "The hops of the path to one IP address, from the tool traceroute or tracert.",
    layer: "path",
    mode: "active",
    kinds: [PATH_TRACE],
    tool: "traceroute",
    peers: (input): readonly Target[] => [target(checked(input).address)],
    available: (context) => tracerouteAvailability(host, context),
    async run(input, context) {
      const command = tracerouteCommand(host.platform, input);
      if (command === undefined) throw new Error(`netdiag has no command of traceroute for ${host.platform}.`);
      return runTool(host, command, context);
    },
    parse: (raw, input): readonly Observation[] => [observe(PATH_TRACE, target(input.address), readTraceroute(raw, input), { start: raw.start, end: raw.end })],
  });
}
