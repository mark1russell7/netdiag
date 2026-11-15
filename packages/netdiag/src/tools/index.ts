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
