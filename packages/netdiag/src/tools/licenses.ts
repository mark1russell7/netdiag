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
  /** The id of the probe of the adapter. A planned adapter has no probe yet. */
  readonly probe?: string | undefined;
}

/**
 * The licenses of the outside tools, as data. netdiag bundles no tool. A test makes sure that the probe of each adapter
 * has a row with the use `adapter`.
 */
export const TOOL_LICENSES: readonly ToolLicense[] = [
  { tool: "ping", license: "The license of the operating system", use: "adapter", probe: "icmp.ping" },
  { tool: "traceroute", license: "GPL on Linux", use: "adapter" },
  { tool: "mtr", license: "GPL", use: "adapter" },
  { tool: "tshark", license: "GPL", use: "adapter" },
  { tool: "iperf3", license: "BSD", use: "adapter" },
  { tool: "nmap", license: "NPSL", use: "not-bundled" },
  { tool: "masscan", license: "AGPL", use: "not-bundled" },
  { tool: "speedtest", license: "Ookla EULA", use: "not-bundled" },
];

/** This function gives the row of a tool, or `undefined` for a tool that is not in the table. */
export function toolLicense(tool: string): ToolLicense | undefined {
  return TOOL_LICENSES.find((row) => row.tool === tool);
}
