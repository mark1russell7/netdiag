import { observe, type Observation } from "../fact.ts";
import { WIFI_FLOOR_DBM, WIFI_LINK, WIFI_WIDTHS, type WifiBand, type WifiLink, type WifiState } from "../kinds.ts";
import { LINK_SUBJECT } from "../probes/link.ts";
import { defineProbe, type Availability, type Probe, type ProbeContext } from "../probe.ts";
import { target } from "../target.ts";
import { ENGLISH, firstLine, LINES } from "./common.ts";
import { AVAILABILITY_TIMEOUT_MS, availabilityOf, runTool, TOOL_MARGIN_MS, type ToolCommand, type ToolHost, type ToolRaw } from "./host.ts";

// The adapter of the Wi-Fi tool of each operating system. Each tool reads the state of the radio. No tool sends a packet.
//
// - Linux: `iw dev` lists the Wi-Fi interfaces. `iw dev <name> link` gives the link of each interface of the type
//   managed, and `iw dev <name> survey dump` gives the noise of the channel in use. The formats come from `link.c`,
//   `interface.c` and `survey.c` of iw. Old versions of iw write `freq: 5180`, and new versions write `freq: 5180.0`.
// - macOS: `system_profiler -json SPAirPortDataType` gives a JSON report. The tool `airport` is not on macOS 14.4 and later.
// - Windows: `netsh wlan show interfaces`. Windows 11 gives `Rssi` in dBm. Older versions give only `Signal` as a quality.
//   The language of the system sets the language of the output, so netdiag reads only English output.

/** The input of the Wi-Fi probe. */
export interface WifiInput {
  /** The name of one interface. The default reads each Wi-Fi interface. */
  readonly interface?: string | undefined;
}

/** The raw output of the Wi-Fi probe: the output of each command, in the order of the commands. */
export interface WifiRaw {
  readonly platform: string;
  readonly runs: readonly ToolRaw[];
}

/** The Wi-Fi tool of each operating system, by the values of `process.platform`. */
export const WIFI_TOOLS: Readonly<Record<string, string>> = { linux: "iw", darwin: "system_profiler", win32: "netsh" };

/** The time limit of one command of `iw`, in milliseconds. */
export const IW_TIMEOUT_MS = 5000;

/** The time limit of `netsh wlan show interfaces`, in milliseconds. */
export const NETSH_TIMEOUT_MS = 10_000;

/** The time limit of `system_profiler`, in milliseconds. The report of the Wi-Fi data type takes some seconds. */
export const SYSTEM_PROFILER_TIMEOUT_MS = 30_000;

function iwCommand(args: readonly string[]): ToolCommand {
  return { command: "iw", args, timeoutMs: IW_TIMEOUT_MS + TOOL_MARGIN_MS, env: ENGLISH };
}

const IW_DEV = iwCommand(["dev"]);
const NETSH: ToolCommand = { command: "netsh", args: ["wlan", "show", "interfaces"], timeoutMs: NETSH_TIMEOUT_MS + TOOL_MARGIN_MS };
const SYSTEM_PROFILER: ToolCommand = {
  command: "system_profiler",
  args: ["-json", "SPAirPortDataType"],
  timeoutMs: SYSTEM_PROFILER_TIMEOUT_MS + TOOL_MARGIN_MS,
  env: ENGLISH,
};

/** The channel and the band of a Wi-Fi frequency. */
export interface WifiChannel {
  readonly channel: number;
  readonly band: WifiBand;
}

/**
 * This function gives the channel and the band of a center frequency in MHz, by IEEE 802.11. It gives `undefined` for a
 * frequency that is not a Wi-Fi channel.
 */
export function wifiChannelOf(mhz: number): WifiChannel | undefined {
  const at = (channel: number, band: WifiBand): WifiChannel | undefined => (Number.isInteger(channel) ? { channel, band } : undefined);
  if (mhz === 2484) return { channel: 14, band: "2.4" };
  if (mhz >= 2412 && mhz <= 2472) return at((mhz - 2407) / 5, "2.4");
  if (mhz >= 5160 && mhz <= 5885) return at((mhz - 5000) / 5, "5");
  if (mhz === 5935) return { channel: 2, band: "6" };
  if (mhz >= 5955 && mhz <= 7115) return at((mhz - 5950) / 5, "6");
  return undefined;
}

/** This function gives a MAC address in lower case with two digits in each part, or `undefined` for other text. */
function macOf(text: string | undefined): string | undefined {
  const parts = text?.trim().toLowerCase().split(":");
  if (parts?.length !== 6 || !parts.every((part) => /^[0-9a-f]{1,2}$/.test(part))) return undefined;
  return parts.map((part) => part.padStart(2, "0")).join(":");
}

/** This function gives a signal or noise level in dBm, or `undefined` for a value out of the range of a measurement. */
function levelOf(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= WIFI_FLOOR_DBM && value < 0 ? value : undefined;
}

function rateOf(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function widthOf(value: number | undefined): number | undefined {
  return (WIFI_WIDTHS as readonly (number | undefined)[]).includes(value) ? value : undefined;
}

function numberOf(text: string | undefined): number | undefined {
  if (text === undefined || !/^-?\d+(\.\d+)?$/.test(text.trim())) return undefined;
  return Number(text);
}

/** This function removes the fields with no value, and the fields of the link from a link that is not connected. */
function linkOf(fields: WifiLink): WifiLink {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  const link = Object.fromEntries(entries) as unknown as WifiLink;
  return link.state === "connected" ? link : { interface: link.interface, state: link.state };
}

/** This function gives the standard of the flags of a bitrate of iw, for example `VHT-MCS 9 80MHz`. */
function standardOfIw(flags: string): string | undefined {
  if (/\bEHT-MCS\b/.test(flags)) return "802.11be";
  if (/\bHE-MCS\b/.test(flags)) return "802.11ax";
  if (/\bVHT-MCS\b/.test(flags)) return "802.11ac";
  if (/\bMCS \d/.test(flags)) return "802.11n";
  return undefined;
}

/** One interface of `iw dev`. */
interface IwInterface {
  readonly name: string;
  readonly type?: string | undefined;
  readonly channel?: number | undefined;
  readonly mhz?: number | undefined;
  readonly widthMhz?: number | undefined;
}

function readIwDev(stdout: string): IwInterface[] {
  const interfaces: IwInterface[] = [];
  let current: { name: string; type?: string; channel?: number; mhz?: number; widthMhz?: number } | undefined;
  for (const line of stdout.split(LINES)) {
    // A line of a radio ("phy#0") or of a device with no network interface ("Unnamed/non-netdev interface") ends the
    // interface before it. Thus the type of a P2P device does not go to the interface before it.
    if (/^phy#|^\s*Unnamed\//.test(line)) {
      current = undefined;
      continue;
    }
    const name = /^\s*Interface (\S+)/.exec(line)?.[1];
    if (name !== undefined) {
      current = { name };
      interfaces.push(current);
      continue;
    }
    if (current === undefined) continue;
    const type = /^\s*type (\S+)/.exec(line)?.[1];
    if (type !== undefined) current.type = type;
    // "channel 44 (5220 MHz), width: 80 MHz, center1: 5210 MHz". The width can be "20 MHz (no HT)".
    const channel = /^\s*channel (\d+) \((\d+(?:\.\d+)?) MHz\)(?:, width: (\d+) MHz)?/.exec(line);
    if (channel !== null) {
      current.channel = Number(channel[1]);
      current.mhz = Number(channel[2]);
      const width = widthOf(numberOf(channel[3]));
      if (width !== undefined) current.widthMhz = width;
    }
  }
  return interfaces;
}

function readIwLink(entry: IwInterface, link: string, survey: string | undefined): WifiLink {
  if (/^Not connected\./m.test(link)) return { interface: entry.name, state: "disconnected" };
  const bssid = macOf(/^Connected to (\S+)/m.exec(link)?.[1]);
  if (bssid === undefined) throw new Error(`netdiag cannot read the output of iw dev ${entry.name} link: ${firstLine(link) ?? "no output"}`);
  const mhz = numberOf(/^\s*freq: (\d+(?:\.\d+)?)/m.exec(link)?.[1]) ?? entry.mhz;
  const where = mhz === undefined ? undefined : wifiChannelOf(Math.round(mhz));
  const rate = (direction: string): { readonly mbps?: number | undefined; readonly flags: string } => {
    const match = new RegExp(`^\\s*${direction} bitrate: (\\d+(?:\\.\\d+)?) MBit/s(.*)$`, "m").exec(link);
    return { mbps: rateOf(numberOf(match?.[1])), flags: match?.[2] ?? "" };
  };
  const tx = rate("tx");
  const rx = rate("rx");
  // The survey of the channel in use: "frequency: 5220 MHz [in use]", then "noise: -92 dBm" in the same block.
  const inUse = survey?.split(/^Survey data from /m).find((block) => /\[in use\]/.test(block));
  return linkOf({
    interface: entry.name,
    state: "connected",
    ssid: /^\s*SSID: (.+)$/m.exec(link)?.[1]?.trim() || undefined,
    bssid,
    // "signal: -52 dBm". Some versions add the level of each antenna: "signal: -52 [-54, -55] dBm".
    signalDbm: levelOf(numberOf(/^\s*signal:\s*(-?\d+)(?:\s*\[[^\]]*\])?\s*dBm/m.exec(link)?.[1])),
    noiseDbm: levelOf(numberOf(/^\s*noise:\s*(-?\d+) dBm/m.exec(inUse ?? "")?.[1])),
    channel: entry.channel ?? where?.channel,
    band: where?.band,
    widthMhz: entry.widthMhz,
    txMbps: tx.mbps,
    rxMbps: rx.mbps,
    standard: standardOfIw(tx.flags) ?? standardOfIw(rx.flags),
  });
}

/** This function throws when a command did not start, or when the time limit stopped it. */
function checkRun(raw: ToolRaw): void {
  const what = [raw.command, ...raw.args].join(" ");
  if (raw.error !== undefined) throw new Error(`The command ${what} did not start: ${raw.error}`);
  if (raw.timedOut === true) throw new Error(`The time limit stopped the command ${what}.`);
}

function readIw(runs: readonly ToolRaw[]): WifiLink[] {
  const [list, ...rest] = runs;
  if (list === undefined) throw new Error("The Wi-Fi probe has no output of iw dev.");
  checkRun(list);
  if (list.exitCode !== 0) throw new Error(`The command iw dev failed: ${firstLine(list.stderr) ?? firstLine(list.stdout) ?? `exit code ${list.exitCode}`}`);
  const find = (name: string, what: string): ToolRaw | undefined => rest.find((run) => run.args[1] === name && run.args[2] === what);
  const links: WifiLink[] = [];
  for (const entry of readIwDev(list.stdout)) {
    const link = find(entry.name, "link");
    if (link === undefined) continue;
    checkRun(link);
    if (link.exitCode !== 0) throw new Error(`The command iw dev ${entry.name} link failed: ${firstLine(link.stderr) ?? `exit code ${link.exitCode}`}`);
    // A survey that fails gives no noise. Some drivers do not give a survey.
    const survey = find(entry.name, "survey");
    const surveyText = survey !== undefined && survey.error === undefined && survey.timedOut !== true && survey.exitCode === 0 ? survey.stdout : undefined;
    links.push(readIwLink(entry, link.stdout, surveyText));
  }
  return links;
}

/** The band of the field `Band` of netsh, for example `5 GHz`. */
function bandOfText(text: string | undefined): WifiBand | undefined {
  const ghz = /^(2\.4|5|6)\s*GHz/i.exec(text?.trim() ?? "")?.[1];
  return ghz === "2.4" || ghz === "5" || ghz === "6" ? ghz : undefined;
}

function readNetsh(stdout: string): WifiLink[] {
  const blocks: Map<string, string>[] = [];
  let block: Map<string, string> | undefined;
  let last: string | undefined;
  for (const line of stdout.split(LINES)) {
    if (line.trim().length === 0) continue;
    // "    Name                   : Wi-Fi". The first colon ends the key, because a MAC address has colons in the value.
    const field = /^\s+([^:]+?)\s*:(?:\s(.*))?$/.exec(line);
    if (field !== null) {
      const key = (field[1] ?? "").trim();
      const value = (field[2] ?? "").trim();
      if (key === "Name") {
        block = new Map();
        blocks.push(block);
      }
      block?.set(key, value);
      last = key;
    } else if (block !== undefined && last !== undefined && /^\s+\S/.test(line)) {
      // The radio status has a second line: "Hardware On" and then "Software Off".
      block.set(last, `${block.get(last) ?? ""} ${line.trim()}`.trim());
    }
  }
  return blocks.map((fields) => {
    const name = fields.get("Name") ?? "";
    const stateText = (fields.get("State") ?? "").toLowerCase();
    const radioOff = /\b(Hardware|Software) Off\b/i.test(fields.get("Radio status") ?? "");
    const state: WifiState = stateText === "connected" ? "connected" : radioOff ? "off" : "disconnected";
    const quality = /^(\d+)\s*%$/.exec(fields.get("Signal") ?? "")?.[1];
    const channel = numberOf(fields.get("Channel"));
    return linkOf({
      interface: name,
      state,
      ssid: fields.get("SSID") || undefined,
      bssid: macOf(fields.get("AP BSSID") ?? fields.get("BSSID")),
      signalDbm: levelOf(numberOf(fields.get("Rssi"))),
      quality: quality === undefined || Number(quality) > 100 ? undefined : Number(quality),
      channel: channel !== undefined && Number.isInteger(channel) && channel >= 1 && channel <= 233 ? channel : undefined,
      band: bandOfText(fields.get("Band")),
      txMbps: rateOf(numberOf(fields.get("Transmit rate (Mbps)"))),
      rxMbps: rateOf(numberOf(fields.get("Receive rate (Mbps)"))),
      standard: fields.get("Radio type") || undefined,
    });
  });
}

/** The messages of netsh that tell that this computer has no Wi-Fi interface in use. They give no fact. */
const NETSH_NO_WIFI = /There is no wireless interface on the system|Wireless AutoConfig Service \(wlansvc\) is not running/i;

function readNetshRun(raw: ToolRaw): WifiLink[] {
  checkRun(raw);
  const links = readNetsh(raw.stdout);
  if (links.length > 0) return links;
  const text = `${raw.stdout}\n${raw.stderr}`;
  if (NETSH_NO_WIFI.test(text)) return [];
  if (/location permission/i.test(text)) {
    throw new Error("Windows gives the Wi-Fi state to netsh only with the location permission. Turn on the location services in the privacy settings.");
  }
  if (raw.exitCode === 0 && /There (is|are) 0 interfaces?/i.test(text)) return [];
  throw new Error(`netdiag cannot read the output of netsh. netdiag reads only English output: ${firstLine(raw.stdout) ?? firstLine(raw.stderr) ?? "no output"}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The state of the field `spairport_status_information` of macOS. */
function stateOfStatus(status: string | undefined, hasNetwork: boolean): WifiState {
  if (status === "spairport_status_connected") return "connected";
  if (status === "spairport_status_off") return "off";
  if (status === undefined && hasNetwork) return "connected";
  return "disconnected";
}

function readSystemProfiler(stdout: string): WifiLink[] {
  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error(`netdiag cannot read the JSON report of system_profiler: ${firstLine(stdout) ?? "no output"}`);
  }
  const items = isRecord(report) && Array.isArray(report["SPAirPortDataType"]) ? (report["SPAirPortDataType"] as unknown[]) : [];
  const interfaces = items.flatMap((item) => (isRecord(item) && Array.isArray(item["spairport_airport_interfaces"]) ? (item["spairport_airport_interfaces"] as unknown[]) : []));
  const links: WifiLink[] = [];
  for (const entry of interfaces) {
    if (!isRecord(entry)) continue;
    const name = textOf(entry["_name"]);
    const network = isRecord(entry["spairport_current_network_information"]) ? entry["spairport_current_network_information"] : undefined;
    const status = textOf(entry["spairport_status_information"]);
    // The interfaces awdl0 and llw0 have no status and no network. They are not Wi-Fi links to an access point.
    if (name === undefined || (status === undefined && network === undefined)) continue;
    const state = stateOfStatus(status, network !== undefined);
    if (state !== "connected" || network === undefined) {
      links.push({ interface: name, state });
      continue;
    }
    // "149 (5GHz, 80MHz)" or "6 (2GHz, 20MHz)". An old report gives a number.
    const channelText = String(network["spairport_network_channel"] ?? "");
    const channel = /^(\d+)(?:\s*\((2|5|6)GHz(?:,\s*(\d+)MHz)?\))?/.exec(channelText);
    const ghz = channel?.[2];
    // "-52 dBm / -94 dBm"
    const levels = /(-?\d+)\s*(?:dBm)?\s*\/\s*(-?\d+)/.exec(textOf(network["spairport_signal_noise"]) ?? "");
    const ssid = textOf(network["_name"]);
    const rate = network["spairport_network_rate"];
    links.push(
      linkOf({
        interface: name,
        state,
        // macOS writes "<redacted>" for the name of the network without the location permission.
        ssid: ssid === undefined || /^<.*>$/.test(ssid) ? undefined : ssid,
        bssid: macOf(textOf(network["spairport_network_bssid"])),
        signalDbm: levelOf(numberOf(levels?.[1])),
        noiseDbm: levelOf(numberOf(levels?.[2])),
        channel: channel === null ? undefined : Number(channel[1]),
        band: ghz === undefined ? undefined : ghz === "2" ? "2.4" : (ghz as WifiBand),
        widthMhz: widthOf(numberOf(channel?.[3])),
        txMbps: rateOf(typeof rate === "number" ? rate : numberOf(textOf(rate))),
        standard: textOf(network["spairport_network_phymode"]),
      }),
    );
  }
  return links;
}

/**
 * This function reads the raw output of the Wi-Fi probe into the Wi-Fi link of each interface. With an interface in the
 * input, it gives only the link of that interface. It throws for output that it cannot read.
 *
 * - A computer with no Wi-Fi interface gives an empty list.
 * - On Windows, netsh needs the location permission. Without it, the function throws with the step that gives it.
 */
export function readWifi(raw: WifiRaw, input: WifiInput = {}): WifiLink[] {
  let links: WifiLink[];
  switch (raw.platform) {
    case "linux":
      links = readIw(raw.runs);
      break;
    case "darwin":
    case "win32": {
      const [run] = raw.runs;
      if (run === undefined) throw new Error("The Wi-Fi probe has no output.");
      if (raw.platform === "win32") links = readNetshRun(run);
      else {
        checkRun(run);
        links = readSystemProfiler(run.stdout);
      }
      break;
    }
    default:
      throw new Error(`netdiag has no Wi-Fi adapter for ${raw.platform}.`);
  }
  return input.interface === undefined ? links : links.filter((link) => link.interface === input.interface);
}

/**
 * This function tells if the Wi-Fi tool of the operating system is available on the host.
 *
 * - Linux: `iw --version` starts.
 * - macOS: `system_profiler -listDataTypes` lists `SPAirPortDataType`.
 * - Windows: `netsh wlan /?` starts and knows the context `wlan`.
 */
export async function wifiAvailability(host: ToolHost, context: ProbeContext): Promise<Availability> {
  const options = { timeoutMs: AVAILABILITY_TIMEOUT_MS, signal: context.signal, env: ENGLISH };
  switch (host.platform) {
    case "linux":
      return availabilityOf("iw", await host.run("iw", ["--version"], options), /iw version (\S+)/);
    case "darwin": {
      const output = await host.run("system_profiler", ["-listDataTypes"], options);
      if (output.error === undefined && !output.stdout.includes("SPAirPortDataType")) {
        return { available: false, reason: "The system_profiler of this computer has no data type SPAirPortDataType." };
      }
      return availabilityOf("system_profiler", output);
    }
    case "win32": {
      const output = await host.run("netsh", ["wlan", "/?"], { timeoutMs: AVAILABILITY_TIMEOUT_MS, signal: context.signal });
      if (output.error === undefined && (output.exitCode !== 0 || /command was not found/i.test(output.stdout))) {
        return { available: false, reason: "The netsh of this computer has no context wlan." };
      }
      return availabilityOf("netsh", output);
    }
    default:
      return { available: false, reason: `netdiag reads the Wi-Fi link only on Linux, macOS and Windows, not on ${host.platform}.` };
  }
}

async function runWifi(host: ToolHost, input: WifiInput, context: ProbeContext): Promise<WifiRaw> {
  const { platform } = host;
  switch (platform) {
    case "darwin":
      return { platform, runs: [await runTool(host, SYSTEM_PROFILER, context)] };
    case "win32":
      return { platform, runs: [await runTool(host, NETSH, context)] };
    case "linux": {
      const list = await runTool(host, IW_DEV, context);
      const runs = [list];
      if (list.error === undefined && list.timedOut !== true && list.exitCode === 0) {
        for (const entry of readIwDev(list.stdout)) {
          if (entry.type !== "managed" || (input.interface !== undefined && entry.name !== input.interface)) continue;
          runs.push(await runTool(host, iwCommand(["dev", entry.name, "link"]), context));
          runs.push(await runTool(host, iwCommand(["dev", entry.name, "survey", "dump"]), context));
        }
      }
      return { platform, runs };
    }
    default:
      throw new Error(`netdiag has no Wi-Fi adapter for ${platform}.`);
  }
}

/**
 * This function makes the probe `wifi.link`: the Wi-Fi link of each interface, from the tool of the operating system. The
 * probe sends no packet, so it needs no grant. Its subject is this computer. Each fact has the name of its interface.
 */
export function wifiProbe(host: ToolHost): Probe<WifiInput, WifiRaw> {
  return defineProbe<WifiInput, WifiRaw>({
    id: "wifi.link",
    version: "1",
    summary: "The Wi-Fi link of each interface: the access point, the signal, the noise, the channel and the rates.",
    layer: "wifi",
    mode: "passive",
    kinds: [WIFI_LINK],
    tool: WIFI_TOOLS[host.platform],
    peers: () => [],
    available: (context) => wifiAvailability(host, context),
    run: (input, context) => runWifi(host, input, context),
    parse(raw, input): readonly Observation[] {
      const first = raw.runs[0];
      const last = raw.runs.at(-1);
      const time = first === undefined || last === undefined ? undefined : { start: first.start, end: last.end };
      return readWifi(raw, input).map((link) => observe(WIFI_LINK, target(LINK_SUBJECT), link, time));
    },
  });
}
