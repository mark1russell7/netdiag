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
export {
  DEFAULT_IPERF3_PORT,
  DEFAULT_IPERF3_SECONDS,
  DEFAULT_UDP_BITS_PER_SECOND,
  IPERF3_MIN_VERSION,
  IPERF3_SETUP_MS,
  MAX_IPERF3_BITS_PER_SECOND,
  MAX_IPERF3_SECONDS,
  MAX_IPERF3_STREAMS,
  iperf3Availability,
  iperf3Command,
  iperf3Probe,
  readIperf3,
  type Iperf3Input,
} from "./iperf3.ts";
export {
  CAPTURE_FIELDS,
  CAPTURE_SETUP_MS,
  DEFAULT_CAPTURE_PACKETS,
  DEFAULT_CAPTURE_SECONDS,
  MAX_CAPTURE_PACKETS,
  MAX_CAPTURE_SECONDS,
  captureAvailability,
  captureCommand,
  captureFilter,
  captureProbe,
  readCapture,
  type CaptureInput,
} from "./capture.ts";
