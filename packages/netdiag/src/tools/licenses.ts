/**
 * The use of an outside tool in netdiag.
 *
 * - `adapter`: netdiag has an optional adapter. The user installs the tool, and netdiag starts it when it is available.
 * - `not-bundled`: netdiag does not start the tool, because its license is restrictive.
 */
export type ToolUse = "adapter" | "not-bundled";

/** A row of the table of the licenses of the outside tools. */
export interface ToolLicense {
  /** The name of the program, for example `ping`. */
  readonly tool: string;
  readonly license: string;
  readonly use: ToolUse;
  /** The ids of the probes that start the tool. A tool with the use `not-bundled` has no probe. */
  readonly probes: readonly string[];
}

/**
 * The licenses of the outside tools, as data. netdiag bundles no tool. A test makes sure that each probe of an adapter
 * is in the row of its tool, with the use `adapter`.
 */
export const TOOL_LICENSES: readonly ToolLicense[] = [
  { tool: "ping", license: "The license of the operating system", use: "adapter", probes: ["icmp.ping", "path.mtu"] },
  { tool: "traceroute", license: "GPL on Linux", use: "adapter", probes: ["path.traceroute"] },
  { tool: "mtr", license: "GPL", use: "adapter", probes: ["path.mtr"] },
  { tool: "tshark", license: "GPL", use: "adapter", probes: ["path.capture"] },
  { tool: "iperf3", license: "BSD", use: "adapter", probes: ["path.iperf3"] },
  { tool: "nmap", license: "NPSL", use: "not-bundled", probes: [] },
  { tool: "masscan", license: "AGPL", use: "not-bundled", probes: [] },
  { tool: "speedtest", license: "Ookla EULA", use: "not-bundled", probes: [] },
];

/** This function gives the row of a tool, or `undefined` for a tool that is not in the table. */
export function toolLicense(tool: string): ToolLicense | undefined {
  return TOOL_LICENSES.find((row) => row.tool === tool);
}
