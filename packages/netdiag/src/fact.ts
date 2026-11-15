import type { Layer } from "./layer.ts";
import type { Target } from "./target.ts";

/**
 * The time of a fact, in milliseconds on the monotonic clock of the runner.
 *
 * The field `origin` of the runner gives the wall-clock time of one monotonic time. Thus each fact time has a wall-clock time.
 */
export interface FactTime {
  readonly start: number;
  readonly end: number;
}

/** The source of a fact: the probe and its version, and the outside tool when the probe starts one. */
export interface FactSource {
  readonly probe: string;
  readonly version: string;
  readonly tool?: string | undefined;
}

/**
 * A typed fact of one layer of the network stack.
 *
 * A fact has a layer, a time, a source and a value. Its kind names the type of its value, for example `tcp.connect`.
 * The subject is the target of the fact. A fact is plain data, so a record of facts is JSON.
 */
export interface Fact<V = unknown> {
  /** The id is unique in the facts of one runner, for example `f12`. */
  readonly id: string;
  readonly kind: string;
  readonly layer: Layer;
  readonly subject: Target;
  readonly time: FactTime;
  readonly source: FactSource;
  readonly value: V;
}

/**
 * The definition of a kind of fact: its name, its layer and the check of its value.
 *
 * The check is the contract of the value. The runner refuses a value that does not pass it, thus each fact of a kind has a
 * value of the type `V`.
 */
export interface FactKind<V> {
  readonly kind: string;
  readonly layer: Layer;
  readonly summary: string;
  readonly check: (value: unknown) => value is V;
}

/** The value type of a fact kind. */
export type ValueOf<K> = K extends FactKind<infer V> ? V : never;

const KIND_NAME = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

/** This function makes a fact kind. The name has lower-case words with dots, for example `tls.handshake`. */
export function defineFactKind<V>(spec: FactKind<V>): FactKind<V> {
  if (!KIND_NAME.test(spec.kind)) throw new RangeError(`"${spec.kind}" is not a valid name of a fact kind`);
  return Object.freeze({ ...spec });
}

/** This function tells if a fact is of a kind, and if its value passes the check of the kind. */
export function isFactOf<V>(kind: FactKind<V>, fact: Fact): fact is Fact<V> {
  return fact.kind === kind.kind && fact.layer === kind.layer && kind.check(fact.value);
}

/** This function gives the facts of one kind, in their order. */
export function factsOf<V>(kind: FactKind<V>, facts: readonly Fact[]): Fact<V>[] {
  return facts.filter((fact): fact is Fact<V> => isFactOf(kind, fact));
}

/**
 * An observation is a fact that a probe parsed, before the runner gives it an id, a layer and a source.
 *
 * The time is optional. Without a time, the fact gets the time of the run of the probe.
 */
export interface Observation<V = unknown> {
  readonly kind: FactKind<V>;
  readonly subject: Target;
  readonly value: V;
  readonly time?: FactTime | undefined;
}

/** This function makes an observation with a type check of its value against its kind. */
export function observe<V>(kind: FactKind<V>, subject: Target, value: V, time?: FactTime): Observation<V> {
  return time === undefined ? { kind, subject, value } : { kind, subject, value, time };
}
