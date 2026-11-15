// The entry `@mark1russell7/netdiag/tools`: the adapters of outside tools. netdiag bundles no tool. The host starts each
// tool with a list of arguments and no shell.
export {
  AVAILABILITY_TIMEOUT_MS,
  availabilityOf,
  runTool,
  TOOL_MARGIN_MS,
  type ToolCommand,
  type ToolHost,
  type ToolOutput,
  type ToolRaw,
  type ToolRunOptions,
} from "./host.ts";
export { TOOL_LICENSES, toolLicense, type ToolLicense, type ToolUse } from "./licenses.ts";
export {
  DEFAULT_PING_COUNT,
  DEFAULT_PING_WAIT_MS,
  MAX_PING_COUNT,
  PING6_LAST_WAIT_MS,
  PING_INTERVAL_MS,
  pingAvailability,
  pingCommand,
  pingProbe,
  readPing,
  type PingInput,
} from "./ping.ts";
export {
  DEFAULT_TRACE_HOPS,
  DEFAULT_TRACE_WAIT_MS,
  MAX_TRACE_HOPS,
  TRACE_QUERIES,
  readTraceroute,
  tracerouteAvailability,
  tracerouteCommand,
  tracerouteProbe,
  type TraceInput,
} from "./traceroute.ts";
export { DEFAULT_MTR_CYCLES, MAX_MTR_CYCLES, MTR_GRACE_MS, mtrAvailability, mtrCommand, mtrProbe, readMtr, type MtrInput } from "./mtr.ts";
