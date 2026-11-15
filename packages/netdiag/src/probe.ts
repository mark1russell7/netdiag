import type { Clock } from "@mark1russell7/algebra/clock";
import type { FactKind, Observation } from "./fact.ts";
import type { Layer } from "./layer.ts";
import type { Target } from "./target.ts";

/**
 * The mode of a probe.
 *
 * - `active`: the probe sends packets to its peers, for example a TCP connect.
 * - `passive`: the probe reads only the state of this computer, for example its routes. It has no peers.
 */
export type ProbeMode = "active" | "passive";

/** The context of a run: the clock of the runner, and the signal that stops the run. */
export interface ProbeContext {
  readonly clock: Clock;
  readonly signal: AbortSignal;
}

/** The availability of a probe on this computer. An unavailable probe tells why, for example a tool that is not installed. */
export type Availability =
  | { readonly available: true; readonly version?: string | undefined }
  | { readonly available: false; readonly reason: string };

/**
 * The contract of a probe. A probe is an adapter: it tells if it is available, it does its work, and it parses its raw output into
 * observations.
 *
 * - `peers` gives each host that `run` sends packets to. A passive probe gives no peers. The runner examines each peer
 *   against the scope before `run` starts.
 * - `run` does the effects and gives the raw output. A network failure is an observation, not an error. For example, a
 *   TCP connect that times out gives the outcome `timeout`. `run` throws only for a fault of the probe.
 * - `parse` is a pure function of the raw output and the input. Thus a record of a raw output gives the same facts again,
 *   also after a correction of the parser.
 *
 * The input and the raw output are plain JSON data, so a record can keep them.
 */
export interface Probe<I, R> {
  /** The id has lower-case words with dots, for example `tcp.connect`. */
  readonly id: string;
  /** The version of the probe changes when its facts change. */
  readonly version: string;
  readonly summary: string;
  readonly layer: Layer;
  readonly mode: ProbeMode;
  /** The kinds of the facts that the probe gives. The runner refuses an observation of a different kind. */
  readonly kinds: readonly FactKind<unknown>[];
  /** The outside tool that the probe starts, for example `ping`. A native probe has no tool. */
  readonly tool?: string | undefined;
  peers(input: I): readonly Target[];
  available(context: ProbeContext): Promise<Availability>;
  run(input: I, context: ProbeContext): Promise<R>;
  parse(raw: R, input: I): readonly Observation[];
}

/** This function makes a probe, and examines its fields. */
export function defineProbe<I, R>(probe: Probe<I, R>): Probe<I, R> {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(probe.id)) throw new RangeError(`"${probe.id}" is not a valid probe id`);
  if (probe.kinds.length === 0) throw new RangeError(`The probe "${probe.id}" gives no kind of fact`);
  return probe;
}
