export { LAYERS, isLayer, layerRank, type Layer } from "./layer.ts";
export { canonicalHost, formatTarget, hostKind, parseTarget, sameTarget, target, type HostKind, type Target } from "./target.ts";
export {
  defineFactKind,
  factsOf,
  isFactOf,
  observe,
  type Fact,
  type FactKind,
  type FactSource,
  type FactTime,
  type Observation,
  type ValueOf,
} from "./fact.ts";
export { defineProbe, type Availability, type Probe, type ProbeContext, type ProbeMode } from "./probe.ts";
export {
  DEFAULT_MAX_PORTS_PER_HOST,
  decideScope,
  grantProblems,
  namedGrant,
  resolvedGrant,
  scopeOf,
  widen,
  type Grant,
  type GrantBasis,
  type HostGrant,
  type PortLedger,
  type RangeGrant,
  type Scope,
  type ScopeDecision,
} from "./scope.ts";
export { createRunner, type ClockOrigin, type ProbeOutcome, type Runner, type RunnerOptions } from "./run.ts";
export * from "./diagnosis/index.ts";
export * from "./kinds.ts";
export {
  DEFAULT_MAX_BYTES,
  DNS_PROBE,
  HTTP_PROBE,
  TCP_PROBE,
  TLS_PROBE,
  dnsOutcome,
  httpProbe,
  tcpProbe,
  tlsProbe,
  type DnsInput,
  type DnsRaw,
  type HttpInput,
  type HttpRaw,
  type TcpInput,
  type TcpRaw,
  type TlsInput,
  type TlsProbeOptions,
  type TlsRaw,
} from "./probes/native.ts";
export {
  DEFAULT_TIMEOUT_MS,
  KEPT_FIELDS,
  certProblem,
  connectOutcome,
  handshakeOutcome,
  type ConnectOptions,
  type Dial,
  type HttpPhase,
  type TcpPhase,
  type TlsPhase,
} from "./probes/socket.ts";
