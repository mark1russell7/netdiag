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
