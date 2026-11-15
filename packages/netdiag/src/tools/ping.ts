import { observe, type Observation } from "../fact.ts";
import { ICMP_ECHO, type IcmpEcho } from "../kinds.ts";
import { defineProbe, type Availability, type Probe, type ProbeContext } from "../probe.ts";
import { hostKind, target, type Target } from "../target.ts";
import { AVAILABILITY_TIMEOUT_MS, availabilityOf, runTool, type ToolCommand, type ToolHost, type ToolRaw } from "./host.ts";

// The adapter of the tool `ping`. It reads the English output of iputils on Linux, of the BSD ping on macOS and of
// ping.exe on Windows. On Linux and macOS, `LC_ALL=C` makes the output English. On Windows, the language of the
// system sets the language of the output, so netdiag cannot read the output of a system in another language.

/** The input of the ping probe: echo requests to one IP address. */
export interface PingInput {
  readonly address: string;
  /** The number of echo requests. The default is `DEFAULT_PING_COUNT`. */
  readonly count?: number | undefined;
  /** The time to wait for each reply, in milliseconds. The default is `DEFAULT_PING_WAIT_MS`. */
  readonly waitMs?: number | undefined;
}

/** The default number of echo requests. The feature `path.loss` needs `LOSS_MIN_SENT` requests or more. */
export const DEFAULT_PING_COUNT = 4;

/** The default time to wait for each reply, in milliseconds. */
export const DEFAULT_PING_WAIT_MS = 1000;

/** The largest number of echo requests in one input. */
export const MAX_PING_COUNT = 100;

/** The time between two echo requests on Linux and macOS, in milliseconds. A user without privileges can set it. */
export const PING_INTERVAL_MS = 200;

/** The time that the host adds to the time limit of a command, in milliseconds. In this time, ping writes its statistics. */
export const PING_MARGIN_MS = 3000;

/**
 * The time that the `ping6` of macOS waits after its last request when a reply is missing, in milliseconds. The tool
 * has no option for it.
 */
export const PING6_LAST_WAIT_MS = 10_000;

interface CheckedInput {
  readonly address: string;
  readonly family: 4 | 6;
  readonly count: number;
  readonly waitMs: number;
}

function checked(input: PingInput): CheckedInput {
  const kind = hostKind(input.address);
  if (kind === "name") throw new TypeError(`"${input.address}" is not an IP address. Get the addresses of a name with the DNS probe first.`);
  const count = input.count ?? DEFAULT_PING_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > MAX_PING_COUNT) throw new RangeError(`${count} is not a number of requests from 1 to ${MAX_PING_COUNT}.`);
  const waitMs = input.waitMs ?? DEFAULT_PING_WAIT_MS;
  if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 60_000) throw new RangeError(`${waitMs} is not a time from 1 to 60000 milliseconds.`);
  return { address: input.address, family: kind === "ipv6" ? 6 : 4, count, waitMs };
}

const ENGLISH: Readonly<Record<string, string>> = { LC_ALL: "C" };

/**
 * This function gives the command of ping for an operating system and an input. For an operating system that the adapter
 * does not know, it gives `undefined`. It throws for an input that is not valid.
 *
 * - Linux: iputils `ping`, with a deadline (`-w`) in seconds, so that ping writes its statistics.
 * - macOS: `ping` with a deadline (`-t`), and `ping6` for an IPv6 address.
 * - Windows: `ping.exe`. It sends one request each second.
 */
export function pingCommand(platform: string, input: PingInput): ToolCommand | undefined {
  const { address, family, count, waitMs } = checked(input);
  const interval = (count - 1) * PING_INTERVAL_MS;
  const deadlineS = Math.ceil((interval + waitMs) / 1000) + 1;
  const seconds = (ms: number): string => String(ms / 1000);
  switch (platform) {
    case "linux":
      return {
        command: "ping",
        args: ["-n", "-c", String(count), "-i", seconds(PING_INTERVAL_MS), "-W", String(Math.ceil(waitMs / 1000)), "-w", String(deadlineS), address],
        timeoutMs: deadlineS * 1000 + PING_MARGIN_MS,
        env: ENGLISH,
      };
    case "darwin":
      return family === 4
        ? {
            command: "ping",
            args: ["-n", "-c", String(count), "-i", seconds(PING_INTERVAL_MS), "-W", String(waitMs), "-t", String(deadlineS), address],
            timeoutMs: deadlineS * 1000 + PING_MARGIN_MS,
            env: ENGLISH,
          }
        : { command: "ping6", args: ["-n", "-c", String(count), address], timeoutMs: (count - 1) * 1000 + PING6_LAST_WAIT_MS + PING_MARGIN_MS, env: ENGLISH };
    case "win32":
      return { command: "ping", args: ["-n", String(count), "-w", String(waitMs), address], timeoutMs: count * Math.max(1000, waitMs) + waitMs + PING_MARGIN_MS };
    default:
      return undefined;
  }
}

/** The command that examines if ping is available on each operating system, and the pattern of its version. */
const AVAILABILITY: Readonly<Record<string, { readonly args: readonly string[]; readonly version?: RegExp }>> = {
  linux: { args: ["-V"], version: /iputils\D*(\d+)/i },
  darwin: { args: [] },
  win32: { args: ["/?"] },
};

/** This function tells if ping is available on the host. On Linux, netdiag reads only the ping of iputils. */
export async function pingAvailability(host: ToolHost, context: ProbeContext): Promise<Availability> {
  const check = AVAILABILITY[host.platform];
  if (check === undefined) return { available: false, reason: `netdiag reads the output of ping only on Linux, macOS and Windows, not on ${host.platform}.` };
  const output = await host.run("ping", check.args, { timeoutMs: AVAILABILITY_TIMEOUT_MS, signal: context.signal, env: ENGLISH });
  if (host.platform === "linux" && output.error === undefined && !/iputils/i.test(`${output.stdout}\n${output.stderr}`)) {
    return { available: false, reason: "netdiag reads only the ping of iputils on Linux. This ping does not tell an iputils version." };
  }
  return availabilityOf("ping", output, check.version);
}

/** The replies and the messages that netdiag reads in the output of ping. */
interface PingLines {
  /** The number of requests from the statistics. Without statistics, netdiag cannot read the output. */
  readonly sent?: number | undefined;
  readonly replies: readonly { readonly rttMs: number; readonly ttl?: number | undefined }[];
  readonly unreachable?: { readonly from?: string | undefined; readonly detail: string } | undefined;
  /** A failure of this computer to send a request, for example a firewall rule. */
  readonly failure?: string | undefined;
}

const LINES = /\r?\n/;

/** The messages of a local send that tell that the address is unreachable, on Linux and macOS. */
const LOCAL_UNREACHABLE = /\b(Network is unreachable|No route to host|Host is down|Network is down)\b/i;

/** The messages of a failed send of ping on Linux and macOS, for example `socket: Operation not permitted`. */
const SEND_FAILURE = /^(?:socket|bind|connect|sendmsg|sendto|send): \S/;

function readUnix(stdout: string, stderr: string): PingLines {
  const replies: { rttMs: number; ttl?: number }[] = [];
  let unreachable: PingLines["unreachable"];
  let failure: string | undefined;
  for (const line of stdout.split(LINES)) {
    const reply = /^\d+ bytes from ([^\s,]+?)[:,] .*\btime[=<]([\d.]+) ?ms/.exec(line);
    if (reply !== null && !line.includes("DUP!")) {
      const ttl = /\b(?:ttl|hlim)=(\d+)/.exec(line)?.[1];
      replies.push(ttl === undefined ? { rttMs: Number(reply[2]) } : { rttMs: Number(reply[2]), ttl: Number(ttl) });
      continue;
    }
    // iputils: "From 192.0.2.5 icmp_seq=1 Destination Host Unreachable". macOS: "92 bytes from 192.0.2.5: Destination Host Unreachable".
    const message = /^(?:From (\S+?):? icmp_seq=\d+|\d+ bytes from ([^\s,]+?)[:,]) (.*unreachable.*)$/i.exec(line);
    if (message !== null && unreachable === undefined) {
      const from = message[1] ?? message[2];
      unreachable = { ...(from === undefined ? {} : { from }), detail: (message[3] ?? "").trim() };
    }
  }
  // A warning on stderr is not a failure. Only a failed send is a failure.
  for (const line of stderr.split(LINES)) {
    const text = line.replace(/^ping6?:\s*/, "").trim();
    const local = LOCAL_UNREACHABLE.exec(text);
    if (local !== null) unreachable ??= { detail: local[1] ?? text };
    else if (SEND_FAILURE.test(text)) failure ??= text;
  }
  const sent = /^(\d+) packets transmitted, \d+ (?:packets )?received/m.exec(stdout)?.[1];
  return { sent: sent === undefined ? undefined : Number(sent), replies, unreachable, failure };
}

function readWindows(stdout: string): PingLines {
  const replies: { rttMs: number; ttl?: number }[] = [];
  let unreachable: PingLines["unreachable"];
  let failure: string | undefined;
  for (const line of stdout.split(LINES)) {
    // "Reply from 192.0.2.1: bytes=32 time=12ms TTL=118". IPv6 has no bytes and no TTL. "time<1ms" counts as 1 ms.
    const reply = /^Reply from (\S+?): (?:bytes=\d+ )?time([=<])(\d+)ms(?: TTL=(\d+))?/.exec(line);
    if (reply !== null) {
      const ttl = reply[4];
      replies.push(ttl === undefined ? { rttMs: Number(reply[3]) } : { rttMs: Number(reply[3]), ttl: Number(ttl) });
      continue;
    }
    const message = /^(?:Reply from (\S+?): )?(Destination [a-z ]*unreachable)\.?\s*$/i.exec(line);
    if (message !== null && unreachable === undefined) unreachable = { ...(message[1] === undefined ? {} : { from: message[1] }), detail: message[2] ?? "" };
    const transmit = /^PING: transmit failed\. (.+?)\s*$/.exec(line);
    if (transmit !== null) failure ??= `transmit failed. ${transmit[1] ?? ""}`.trim();
  }
  const sent = /Packets: Sent = (\d+), Received = \d+/.exec(stdout)?.[1];
  return { sent: sent === undefined ? undefined : Number(sent), replies, unreachable, failure };
}

/**
 * This function reads the raw output of the ping probe into the value of a fact `icmp.echo`.
 *
 * - The replies are the lines of echo replies. A message of an unreachable address and a duplicate are not replies.
 * - Output with no statistics gives the outcome `error`, also when it has replies. The time limit stopped such a ping.
 */
export function readPing(raw: ToolRaw, address: string): IcmpEcho {
  const error = (detail: string): IcmpEcho => ({ address, outcome: "error", sent: 0, received: 0, rttMs: [], detail });
  if (raw.error !== undefined) return error(raw.error);
  const lines = raw.platform === "win32" ? readWindows(raw.stdout) : readUnix(raw.stdout, raw.stderr);
  const { sent, replies, unreachable, failure } = lines;
  const from = unreachable?.from === undefined ? {} : { from: unreachable.from };
  if (sent === undefined) {
    if (unreachable !== undefined && raw.timedOut !== true) return { address, outcome: "unreachable", sent: 0, received: 0, rttMs: [], ...from, detail: unreachable.detail };
    if (raw.timedOut === true) return error("The time limit stopped ping before its statistics.");
    return error(failure ?? firstLine(raw.stderr) ?? "netdiag cannot read the output of ping. netdiag reads only English output.");
  }
  if (replies.length > sent) return error(`The output of ping has ${replies.length} replies to ${sent} requests.`);
  const first = replies[0];
  if (first !== undefined) {
    return { address, outcome: "reply", sent, received: replies.length, rttMs: replies.map((r) => r.rttMs), ...(first.ttl === undefined ? {} : { ttl: first.ttl }) };
  }
  if (unreachable !== undefined) return { address, outcome: "unreachable", sent, received: 0, rttMs: [], ...from, detail: unreachable.detail };
  if (failure !== undefined) return error(failure);
  return { address, outcome: "none", sent, received: 0, rttMs: [] };
}

function firstLine(text: string): string | undefined {
  return text.split(LINES).find((line) => line.trim().length > 0)?.trim();
}

/**
 * This function makes the probe `icmp.ping`: the echo requests of the tool ping to one IP address. The host starts
 * the tool. Give `runCommand` of `@procedures/shell`, or a fake host in a test.
 */
export function pingProbe(host: ToolHost): Probe<PingInput, ToolRaw> {
  return defineProbe<PingInput, ToolRaw>({
    id: "icmp.ping",
    version: "1",
    summary: "The ICMP echo requests of the tool ping to one IP address.",
    layer: "ip",
    mode: "active",
    kinds: [ICMP_ECHO],
    tool: "ping",
    peers: (input): readonly Target[] => [target(checked(input).address)],
    available: (context) => pingAvailability(host, context),
    async run(input, context) {
      const command = pingCommand(host.platform, input);
      if (command === undefined) throw new Error(`netdiag has no command of ping for ${host.platform}.`);
      return runTool(host, command, context);
    },
    parse: (raw, input): readonly Observation[] => [observe(ICMP_ECHO, target(input.address), readPing(raw, input.address), { start: raw.start, end: raw.end })],
  });
}
