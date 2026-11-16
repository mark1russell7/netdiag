/**
 * The loopback lab of netdiag. Each case makes one fault with real servers on lab addresses. The lab examines the
 * world with the probes, diagnoses it, and scores the diagnosis against the true fault.
 */
export {
  CI_HOSTS,
  LOCAL_HOSTS,
  LOOPBACK_CASES,
  OTHER_NAME,
  PORTAL,
  PORTAL_NAME,
  PROXY_DELAY_MS,
  REFERENCE_NAME,
  SLOW_REPLY_MS,
  TARGET_NAME,
  type Certificate,
  type DnsSpec,
  type HostSpec,
  type LabCase,
  type LabHosts,
  signsOf,
  type CaseSign,
  type Sign,
  type SignGroup,
} from "./cases.ts";
export { HOLD_WINDOW_MS, LEGACY_CIPHER, labTrust, startWorld, zoneOf, type Endpoint, type LabTrust, type World } from "./world.ts";
export {
  DNS_TIMEOUT_MS,
  HTTP_TIMEOUT_MS,
  missingSigns,
  readVisit,
  roundOrder,
  runCase,
  runLab,
  runRounds,
  visitLoopback,
  visitRounds,
  type CaseBase,
  type CaseRun,
  type LabRound,
  type RunOptions,
  type Visit,
} from "./run.ts";
export { labReport, reportMarkdown, type LabReport, type LaterClass, type ReportOptions } from "./report.ts";
