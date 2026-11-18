import type { AddressFamily } from "../address/index.ts";
import { observe, type Observation } from "../fact.ts";
import { PATH_MTU, type MtuTry } from "../kinds.ts";
import { ETHERNET_MTU, IPV4_MIN_MTU, IPV6_MIN_MTU, mtuOf, nextMtuSize, type MtuBounds } from "../metrics/mtu.ts";
import { defineProbe, type Probe } from "../probe.ts";
import { target, type Target } from "../target.ts";
import { ENGLISH, integerIn, LINES, toolAddress, withoutSeparator, type ToolAddress } from "./common.ts";
import { runTool, TOOL_MARGIN_MS, type ToolCommand, type ToolHost, type ToolRaw } from "./host.ts";
import { PING_INTERVAL_MS, pingAvailability, readPing } from "./ping.ts";

// The adapter of the search for the MTU of a path (ND-6, step 2). For each size of the search, it starts the tool ping
// with "do not fragment". The reader of ping reads the replies, and this module reads the messages of a packet that is
// too large.

/** The input of the probe `path.mtu`: a search for the MTU of the path to one IP address. */
export interface MtuInput {
  readonly address: string;
  /** The largest size of the search, in bytes. The default is `ETHERNET_MTU`. */
  readonly ceiling?: number | undefined;
  /** The number of echo requests of each size. One reply makes a size pass. The default is `DEFAULT_MTU_COUNT`. */
  readonly count?: number | undefined;
  /** The time to wait for each reply, in milliseconds. The default is `DEFAULT_MTU_WAIT_MS`. */
  readonly waitMs?: number | undefined;
}

/**
 * The default number of echo requests of each size. With a loss of 20 %, three requests make a false failure of a size
 * less than 1 % probable.
 */
export const DEFAULT_MTU_COUNT = 3;

/** The largest number of echo requests of each size. */
export const MAX_MTU_COUNT = 10;

/** The default time to wait for each reply, in milliseconds. */
export const DEFAULT_MTU_WAIT_MS = 1000;

/** The largest ceiling of a search, in bytes: the largest jumbo frame of usual switches. */
export const MAX_MTU_CEILING = 9216;

/** The size of the headers of an echo request, in bytes: the IP header and the ICMP header of each family. */
export const ECHO_HEADER_BYTES: Readonly<Record<AddressFamily, number>> = { ipv4: 28, ipv6: 48 };

/**
 * The size of the payload of a plain echo request of ping, in bytes. With the headers, it is the size `least` of a search
 * over IPv6. A path that passes it and drops 1280 bytes has a link with an MTU below the smallest MTU of IPv6.
 */
export const PLAIN_ECHO_PAYLOAD_BYTES = 56;

interface CheckedInput extends ToolAddress {
  readonly bounds: MtuBounds;
  readonly count: number;
  readonly waitMs: number;
}

function checked(input: MtuInput): CheckedInput {
  const address = toolAddress(input.address);
  const floor = address.family === "ipv4" ? IPV4_MIN_MTU : IPV6_MIN_MTU;
  const least = ECHO_HEADER_BYTES[address.family] + PLAIN_ECHO_PAYLOAD_BYTES;
  const ceiling = integerIn(input.ceiling ?? ETHERNET_MTU, floor, MAX_MTU_CEILING, "a ceiling in bytes");
  return {
    ...address,
    bounds: least < floor ? { floor, least, ceiling } : { floor, ceiling },
    count: integerIn(input.count ?? DEFAULT_MTU_COUNT, 1, MAX_MTU_COUNT, "a number of requests"),
    waitMs: integerIn(input.waitMs ?? DEFAULT_MTU_WAIT_MS, 1, 60_000, "a time in milliseconds"),
  };
}

/**
 * This function gives the command of ping with "do not fragment" for one size of a search. The size is the size of the
 * IP packet. For an operating system or a family that the adapter does not know, it gives `undefined`. It throws for
 * an input or a size that is not valid.
 *
 * - Linux: iputils `ping -M do`, for IPv4 and IPv6.
 * - macOS: `ping -D`, for IPv4. The `ping6` of macOS has no option that forbids fragments at the source.
 * - Windows: `ping.exe -f`, for IPv4. The option `-f` has no effect on IPv6.
 */
export function mtuCommand(platform: string, input: MtuInput, size: number): ToolCommand | undefined {
  const { address, family, bounds, count, waitMs } = checked(input);
  const payload = String(integerIn(size, bounds.least ?? bounds.floor, bounds.ceiling, "a size in bytes") - ECHO_HEADER_BYTES[family]);
  const deadlineS = Math.ceil(((count - 1) * PING_INTERVAL_MS + waitMs) / 1000) + 1;
  const timeoutMs = deadlineS * 1000 + TOOL_MARGIN_MS;
  const interval = String(PING_INTERVAL_MS / 1000);
  switch (platform) {
    case "linux":
      return {
        command: "ping",
        args: ["-n", "-M", "do", "-s", payload, "-c", String(count), "-i", interval, "-W", String(Math.ceil(waitMs / 1000)), "-w", String(deadlineS), address],
        timeoutMs,
        env: ENGLISH,
      };
    case "darwin":
      if (family !== "ipv4") return undefined;
      return {
        command: "ping",
        args: ["-n", "-D", "-s", payload, "-c", String(count), "-i", interval, "-W", String(waitMs), "-t", String(deadlineS), address],
        timeoutMs,
        env: ENGLISH,
      };
    case "win32":
      if (family !== "ipv4") return undefined;
      return { command: "ping", args: ["-n", String(count), "-w", String(waitMs), "-f", "-l", payload, address], timeoutMs: count * Math.max(1000, waitMs) + waitMs + TOOL_MARGIN_MS };
    default:
      return undefined;
  }
}

/**
 * The messages of a packet that is too large, with the MTU in the first group when the message tells it.
 *
 * - iputils: "Frag needed and DF set (mtu = 1200)", and "Packet too big: mtu=1280" for IPv6.
 * - macOS: "frag needed and DF set (MTU 1200)".
 * - The local error of Linux and macOS: "local error: message too long, mtu=1200" and "sendto: Message too long".
 * - Windows: "Packet needs to be fragmented but DF set." Windows does not tell the MTU.
 */
const TOO_BIG: readonly RegExp[] = [
  /\bfrag needed and DF set \(mtu ?=? ?(\d+)\)/i,
  /\bpacket too big: mtu ?= ?(\d+)/i,
  /\bmessage too long(?:, mtu ?[=:] ?(\d+))?/i,
  /\bpacket needs to be fragmented but DF set\b/i,
];

/** The start of a line of a message from a router: iputils, macOS and Windows. */
const MESSAGE_HEAD = /^(?:From (\S+) icmp_seq=\d+ |\d+ bytes from (\S+) |Reply from (\S+?): )/;

/** This function finds the first message of a packet that is too large in the output of ping. */
function tooBigOf(raw: ToolRaw): Pick<MtuTry, "mtu" | "from" | "detail"> | undefined {
  for (const line of `${raw.stdout}\n${raw.stderr}`.split(LINES)) {
    const match = TOO_BIG.map((pattern) => pattern.exec(line)).find((each) => each !== null);
    if (match === undefined || match === null) continue;
    const head = MESSAGE_HEAD.exec(line);
    const from = head === null ? undefined : withoutSeparator(head[1] ?? head[2] ?? head[3] ?? "");
    const mtu = match[1] === undefined ? undefined : Number(match[1]);
    return {
      detail: line.replace(/^ping6?:\s*/, "").trim(),
      ...(from === undefined || from === "" ? {} : { from }),
      ...(mtu === undefined || mtu < 1 || mtu > 65_535 ? {} : { mtu }),
    };
  }
  return undefined;
}

/**
 * This function reads the raw output of ping for one size of a search into a try.
 *
 * - One echo reply makes the result `reply`.
 * - With no reply, a message of a packet that is too large makes the result `too-big`. The message can tell the MTU.
 * - With no reply and no such message, the result is `none`. A message of an unreachable address is in its detail.
 * - A tool that does not start, and output that the reader of ping cannot read, give the result `error`.
 */
export function readMtuTry(raw: ToolRaw, size: number): MtuTry {
  if (raw.error !== undefined) return { size, result: "error", detail: raw.error };
  const echo = readPing(raw, raw.args.at(-1) ?? "");
  if (echo.outcome === "reply") return { size, result: "reply" };
  const tooBig = tooBigOf(raw);
  if (tooBig !== undefined) return { size, result: "too-big", ...tooBig };
  if (echo.outcome === "error") return { size, result: "error", detail: echo.detail ?? "netdiag cannot read the output of ping." };
  return echo.detail === undefined ? { size, result: "none" } : { size, result: "none", detail: echo.detail };
}

/** The raw output of the probe `path.mtu`: the bounds of the search, and the output of ping for each size in order. */
export interface MtuRaw {
  readonly platform: string;
  readonly bounds: MtuBounds;
  readonly steps: readonly { readonly size: number; readonly raw: ToolRaw }[];
  readonly start: number;
  readonly end: number;
}

/**
 * This function makes the probe `path.mtu`: a search for the MTU of the path to one IP address. The probe starts ping
 * with "do not fragment" for each size that `nextMtuSize` gives. Give the host as for `pingProbe`.
 */
export function mtuProbe(host: ToolHost): Probe<MtuInput, MtuRaw> {
  return defineProbe<MtuInput, MtuRaw>({
    id: "path.mtu",
    version: "2",
    summary: "The MTU of the path to one IP address, from the echo requests of the tool ping with do not fragment.",
    layer: "path",
    mode: "active",
    kinds: [PATH_MTU],
    tool: "ping",
    peers: (input): readonly Target[] => [target(checked(input).address)],
    available: (context) => pingAvailability(host, context),
    async run(input, context) {
      const { family, bounds } = checked(input);
      const start = context.clock.now();
      const steps: { size: number; raw: ToolRaw }[] = [];
      const tries: MtuTry[] = [];
      for (let size = nextMtuSize(tries, bounds); size !== undefined; size = nextMtuSize(tries, bounds)) {
        const command = mtuCommand(host.platform, input, size);
        if (command === undefined) throw new Error(`netdiag has no command of ping with "do not fragment" for ${family} on ${host.platform}.`);
        const raw = await runTool(host, command, context);
        steps.push({ size, raw });
        tries.push(readMtuTry(raw, size));
      }
      return { platform: host.platform, bounds, steps, start, end: context.clock.now() };
    },
    parse: (raw, input): readonly Observation[] => {
      const tries = raw.steps.map((step) => readMtuTry(step.raw, step.size));
      return [observe(PATH_MTU, target(input.address), mtuOf(checked(input).address, tries, raw.bounds), { start: raw.start, end: raw.end })];
    },
  });
}
