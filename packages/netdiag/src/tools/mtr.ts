import { observe, type Observation } from "../fact.ts";
import { PATH_REPORT, type PathReport, type ReportHop } from "../kinds.ts";
import { defineProbe, type Availability, type Probe, type ProbeContext } from "../probe.ts";
import { target, type Target } from "../target.ts";
import { ENGLISH, firstLine, integerIn, sameAddress, toolAddress, type ToolAddress } from "./common.ts";
import { AVAILABILITY_TIMEOUT_MS, availabilityOf, runTool, TOOL_MARGIN_MS, type ToolCommand, type ToolHost, type ToolRaw } from "./host.ts";
import { DEFAULT_TRACE_HOPS, MAX_TRACE_HOPS } from "./traceroute.ts";

// The adapter of the tool mtr. It reads the JSON report of `mtr --json` (mtr 0.92 or later) on Linux and macOS. mtr
// sends one cycle of probes each second. A user without privileges cannot set a shorter interval.

/** The input of the mtr probe: many cycles of probes on the path to one IP address. */
export interface MtrInput {
  readonly address: string;
  /** The number of cycles. The default is `DEFAULT_MTR_CYCLES`. */
  readonly cycles?: number | undefined;
  /** The largest TTL. The default is `DEFAULT_TRACE_HOPS`. */
  readonly maxHops?: number | undefined;
}

/** The default number of cycles. It is `LOSS_MIN_SENT` of the readers, so a report gives the feature `path.loss`. */
export const DEFAULT_MTR_CYCLES = 20;

/** The largest number of cycles of one input. */
export const MAX_MTR_CYCLES = 100;

/** The time that mtr waits for the last answers after the last cycle, in milliseconds (its option `--gracetime`). */
export const MTR_GRACE_MS = 5000;

interface CheckedInput extends ToolAddress {
  readonly cycles: number;
  readonly maxHops: number;
}

function checked(input: MtrInput): CheckedInput {
  return {
    ...toolAddress(input.address),
    cycles: integerIn(input.cycles ?? DEFAULT_MTR_CYCLES, 1, MAX_MTR_CYCLES, "a number of cycles"),
    maxHops: integerIn(input.maxHops ?? DEFAULT_TRACE_HOPS, 1, MAX_TRACE_HOPS, "a number of hops"),
  };
}

/**
 * This function gives the command of mtr for an operating system and an input. On Windows and on an operating system
 * that the adapter does not know, it gives `undefined`. It throws for an input that is not valid.
 */
export function mtrCommand(platform: string, input: MtrInput): ToolCommand | undefined {
  const { address, family, cycles, maxHops } = checked(input);
  if (platform !== "linux" && platform !== "darwin") return undefined;
  return {
    command: "mtr",
    args: ["--json", "--no-dns", family === "ipv6" ? "-6" : "-4", "-c", String(cycles), "-m", String(maxHops), address],
    timeoutMs: cycles * 1000 + MTR_GRACE_MS + TOOL_MARGIN_MS,
    env: ENGLISH,
  };
}

/** This function tells if mtr is available on the host. The adapter knows Linux and macOS. */
export async function mtrAvailability(host: ToolHost, context: ProbeContext): Promise<Availability> {
  if (host.platform !== "linux" && host.platform !== "darwin") return { available: false, reason: `netdiag starts mtr only on Linux and macOS, not on ${host.platform}.` };
  const output = await host.run("mtr", ["--version"], { timeoutMs: AVAILABILITY_TIMEOUT_MS, signal: context.signal, env: ENGLISH });
  return availabilityOf("mtr", output, /mtr (\d[\d.]*)/);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** This function reads one hub of the JSON report, or gives `undefined` when netdiag cannot read it. */
function readHub(hub: unknown): ReportHop | undefined {
  if (typeof hub !== "object" || hub === null) return undefined;
  const record = hub as Readonly<Record<string, unknown>>;
  // mtr 0.92 writes the count as a text, and mtr 0.93 and later as a number.
  const ttl = Number(record["count"]);
  const sent = record["Snt"];
  const loss = finite(record["Loss%"]);
  const host = record["host"];
  if (!Number.isInteger(ttl) || ttl < 1 || typeof sent !== "number" || !Number.isInteger(sent) || sent < 0 || loss === undefined || loss > 100) return undefined;
  if (typeof host !== "string") return undefined;
  const received = sent - Math.round((sent * loss) / 100);
  // mtr writes "???" for a hop with no answer.
  if (host === "???") return received === 0 ? { ttl, sent, received } : undefined;
  if (received === 0) return { ttl, address: host, sent, received };
  const times = { bestMs: finite(record["Best"]), meanMs: finite(record["Avg"]), worstMs: finite(record["Wrst"]) };
  return {
    ttl,
    address: host,
    sent,
    received,
    ...(times.bestMs === undefined ? {} : { bestMs: times.bestMs }),
    ...(times.meanMs === undefined ? {} : { meanMs: times.meanMs }),
    ...(times.worstMs === undefined ? {} : { worstMs: times.worstMs }),
  };
}

/** This function gives the hubs of the JSON report of mtr, or `undefined` when the text is not such a report. */
function hubsOf(text: string): readonly unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const report = (parsed as { readonly report?: unknown }).report;
    if (typeof report !== "object" || report === null) return undefined;
    const hubs = (report as { readonly hubs?: unknown }).hubs;
    return Array.isArray(hubs) ? hubs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * This function reads the raw output of the mtr probe into the value of a fact `path.report`.
 *
 * - The number of answers of a hop comes from its loss and its number of probes.
 * - Output that netdiag cannot read gives the outcome `error`.
 */
export function readMtr(raw: ToolRaw, input: { readonly address: string; readonly cycles?: number | undefined }): PathReport {
  const { address } = input;
  const cycles = input.cycles ?? DEFAULT_MTR_CYCLES;
  const error = (detail: string): PathReport => ({ address, outcome: "error", cycles, hops: [], detail });
  if (raw.error !== undefined) return error(raw.error);
  if (raw.timedOut === true) return error("The time limit stopped mtr before its report.");
  const hubs = hubsOf(raw.stdout);
  if (hubs === undefined) return error(firstLine(raw.stderr) ?? "netdiag cannot read the JSON report of mtr.");
  const hops: ReportHop[] = [];
  for (const hub of hubs) {
    const hop = readHub(hub);
    if (hop === undefined) return error(`netdiag cannot read the hub ${hops.length + 1} of the report of mtr.`);
    if (hop.ttl <= (hops.at(-1)?.ttl ?? 0)) return error(`The hubs of the report of mtr are not in the order of their TTL.`);
    hops.push(hop);
  }
  const last = hops.at(-1);
  if (last === undefined) return error(firstLine(raw.stderr) ?? "The report of mtr has no hub.");
  const reached = last.address !== undefined && last.received > 0 && sameAddress(last.address, address);
  return { address, outcome: reached ? "reached" : "stopped", cycles, hops };
}

/** This function makes the probe `path.mtr`: many cycles of probes on the path to one IP address with the tool mtr. */
export function mtrProbe(host: ToolHost): Probe<MtrInput, ToolRaw> {
  return defineProbe<MtrInput, ToolRaw>({
    id: "path.mtr",
    version: "1",
    summary: "The loss and the round-trip times of each hop of the path to one IP address, from the tool mtr.",
    layer: "path",
    mode: "active",
    kinds: [PATH_REPORT],
    tool: "mtr",
    peers: (input): readonly Target[] => [target(checked(input).address)],
    available: (context) => mtrAvailability(host, context),
    async run(input, context) {
      const command = mtrCommand(host.platform, input);
      if (command === undefined) throw new Error(`netdiag has no command of mtr for ${host.platform}.`);
      return runTool(host, command, context);
    },
    parse: (raw, input): readonly Observation[] => [observe(PATH_REPORT, target(input.address), readMtr(raw, input), { start: raw.start, end: raw.end })],
  });
}
