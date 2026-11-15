import type { Clock } from "@mark1russell7/algebra/clock";
import type { Fact, FactTime, Observation } from "./fact.ts";
import type { Probe, ProbeContext } from "./probe.ts";
import { decideScope, widen, type Grant, type PortLedger, type Scope } from "./scope.ts";
import { canonicalHost, formatTarget, type Target } from "./target.ts";

/**
 * The outcome of one run of a probe.
 *
 * - `done`: the probe did its work. The facts include each network failure that it saw.
 * - `refused`: a peer is not in the scope, so the probe did not start.
 * - `unavailable`: the probe cannot operate on this computer.
 * - `failed`: the probe or its parser has a fault. The raw output is present when the run ended.
 * - `aborted`: the signal stopped the run.
 */
export type ProbeOutcome<R> =
  | { readonly status: "done"; readonly time: FactTime; readonly raw: R; readonly facts: readonly Fact[] }
  | { readonly status: "refused"; readonly peer: Target; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "failed"; readonly stage: "probe" | "run" | "parse"; readonly error: string; readonly raw?: R | undefined }
  | { readonly status: "aborted"; readonly reason: string };

/** The wall-clock time of one monotonic time of the runner. */
export interface ClockOrigin {
  readonly wall: string;
  readonly monotonic: number;
}

/** The options of a runner. */
export interface RunnerOptions {
  readonly scope: Scope;
  readonly clock: Clock;
  /** The wall-clock time of the start, as an ISO 8601 text. The default is the time of the computer. */
  readonly wall?: string | undefined;
}

/**
 * A runner starts probes in one scope, and keeps the facts of the diagnosis.
 *
 * It gives each fact an id in sequence. It keeps the ledger of the ports of each host, for the limit of ports of the scope.
 */
export interface Runner {
  readonly origin: ClockOrigin;
  scope(): Scope;
  facts(): readonly Fact[];
  /** This method adds grants to the scope, for example the addresses of a granted name. */
  grant(grants: readonly Grant[]): void;
  run<I, R>(probe: Probe<I, R>, input: I, signal?: AbortSignal): Promise<ProbeOutcome<R>>;
}

function message(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  return String(thrown);
}

function abortReason(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  return reason === undefined ? "The signal stopped the run." : message(reason);
}

/** This function makes a runner. */
export function createRunner(options: RunnerOptions): Runner {
  const { clock } = options;
  const origin: ClockOrigin = { wall: options.wall ?? new Date().toISOString(), monotonic: clock.now() };
  let scope = options.scope;
  const facts: Fact[] = [];
  let ledger: PortLedger = new Map();
  let next = 1;

  /** This function gives the ledger with the ports of the peers, or the refusal of the first peer out of the scope. */
  function reserve(peers: readonly Target[]): PortLedger | { readonly peer: Target; readonly reason: string } {
    const planned = new Map([...ledger].map(([host, ports]) => [host, new Set(ports)]));
    for (const peer of peers) {
      const decision = decideScope(scope, peer, planned);
      if (!decision.allowed) return { peer, reason: decision.reason };
      if (peer.port === undefined) continue;
      const host = canonicalHost(peer.host);
      planned.set(host, (planned.get(host) ?? new Set<number>()).add(peer.port));
    }
    return planned;
  }

  function stamp<I, R>(probe: Probe<I, R>, observations: readonly Observation[], time: FactTime): Fact[] | string {
    const stamped: Fact[] = [];
    for (const observation of observations) {
      const { kind } = observation;
      if (!probe.kinds.some((known) => known.kind === kind.kind)) return `The probe gave the kind "${kind.kind}", which it does not declare.`;
      if (!kind.check(observation.value)) return `The value of a "${kind.kind}" fact does not pass the check of its kind.`;
      stamped.push({
        id: `f${next + stamped.length}`,
        kind: kind.kind,
        layer: kind.layer,
        subject: observation.subject,
        time: observation.time ?? time,
        source: probe.tool === undefined ? { probe: probe.id, version: probe.version } : { probe: probe.id, version: probe.version, tool: probe.tool },
        value: observation.value,
      });
    }
    return stamped;
  }

  async function run<I, R>(probe: Probe<I, R>, input: I, signal: AbortSignal = new AbortController().signal): Promise<ProbeOutcome<R>> {
    if (signal.aborted) return { status: "aborted", reason: abortReason(signal) };
    let peers: readonly Target[];
    try {
      peers = probe.peers(input);
    } catch (thrown) {
      return { status: "failed", stage: "probe", error: message(thrown) };
    }
    if (probe.mode === "passive" && peers.length > 0) {
      return { status: "failed", stage: "probe", error: `The passive probe "${probe.id}" gives peers: ${peers.map(formatTarget).join(", ")}.` };
    }
    if (probe.mode === "active" && peers.length === 0) {
      return { status: "failed", stage: "probe", error: `The active probe "${probe.id}" gives no peer.` };
    }
    // The decision and the reservation of the ports happen with no await between them. Thus two runs at the same time
    // cannot both pass the limit of ports. A run that does not start keeps its reservation: the ledger only grows.
    const reserved = reserve(peers);
    if ("reason" in reserved) return { status: "refused", peer: reserved.peer, reason: reserved.reason };
    ledger = reserved;
    const context: ProbeContext = { clock, signal };
    let availability;
    try {
      availability = await probe.available(context);
    } catch (thrown) {
      return { status: "failed", stage: "probe", error: message(thrown) };
    }
    if (!availability.available) return { status: "unavailable", reason: availability.reason };
    if (signal.aborted) return { status: "aborted", reason: abortReason(signal) };
    const start = clock.now();
    let raw: R;
    try {
      raw = await probe.run(input, context);
    } catch (thrown) {
      if (signal.aborted) return { status: "aborted", reason: abortReason(signal) };
      return { status: "failed", stage: "run", error: message(thrown) };
    }
    const time: FactTime = { start, end: clock.now() };
    let observations: readonly Observation[];
    try {
      observations = probe.parse(raw, input);
    } catch (thrown) {
      return { status: "failed", stage: "parse", error: message(thrown), raw };
    }
    const stamped = stamp(probe, observations, time);
    if (typeof stamped === "string") return { status: "failed", stage: "parse", error: stamped, raw };
    facts.push(...stamped);
    next += stamped.length;
    return { status: "done", time, raw, facts: stamped };
  }

  return {
    origin,
    scope: () => scope,
    facts: () => [...facts],
    grant(grants) {
      const widened = widen(scope, grants);
      if (widened.tag === "err") throw new RangeError(widened.error.join(" "));
      scope = widened.value;
    },
    run,
  };
}
