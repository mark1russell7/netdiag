/**
 * The entry `@mark1russell7/netdiag/core` has all of netdiag that imports no module of Node. A browser can import it.
 *
 * The entry has the layers, the targets, the facts, the scope and the runner. It has the addresses, the diagnosis, the
 * kinds of facts, the metrics and the readers. It also has the data of a visit and the limits of the echo requests. The
 * readers of RDAP and of the DNS of Team Cymru are in it too. The probes and the visit are in the root entry.
 *
 * @packageDocumentation
 */
export { LAYERS, isLayer, layerRank, type Layer } from "./layer.ts";
export { canonicalHost, formatTarget, hostKind, parseTarget, sameTarget, target, type HostKind, type Target } from "./target.ts";
export {
  defineFactKind,
  factsOf,
  isFactOf,
  observe,
  readFact,
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
export * from "./address/index.ts";
export * from "./diagnosis/index.ts";
export * from "./kinds.ts";
export * from "./metrics/index.ts";
export * from "./readers.ts";
export {
  MAX_REGISTRY_TEXT,
  RDAP_BOOTSTRAP,
  RDAP_REGISTRIES,
  networkQuery,
  readBootstrap,
  readNetwork,
  secureBase,
  serviceFor,
  type RdapBootstrap,
  type RdapService,
} from "./lookups/rdap.ts";
export { CYMRU_ZONES, originQuery, readOrigin, type CymruOrigin } from "./lookups/cymru.ts";
export { lookupGrants } from "./lookups/grants.ts";
export { DEFAULT_MTR_CYCLES, DEFAULT_PING_COUNT, MAX_MTR_CYCLES, MAX_PING_COUNT } from "./tools/counts.ts";
export {
  MTU_SEARCHES,
  VISIT_ROLES,
  type MtuSearch,
  type VisitHost,
  type VisitInput,
  type VisitResolver,
  type VisitRole,
  type VisitStep,
} from "./visit-types.ts";
