import { err, ok, type Result } from "@mark1russell7/optional";
import { isLayer, type Layer } from "./layer.ts";
import type { HostKind, Target } from "./target.ts";

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

/** The kinds of the host of a target. The list is the type `HostKind` of `target.ts`. */
const HOST_KINDS: ReadonlySet<string> = new Set<HostKind>(["name", "ipv4", "ipv6"]);

/** This function tells if a value is a plain object of JSON. The checks of the fact kinds also use it. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** This function tells if a value is a text with one character or more. */
export function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** This function tells if a value is a TCP or UDP port: an integer from 1 to 65535. */
export function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isSubject(value: unknown): value is Target {
  if (!isRecord(value) || !isText(value["host"]) || typeof value["kind"] !== "string" || !HOST_KINDS.has(value["kind"])) return false;
  return value["port"] === undefined || isPort(value["port"]);
}

function isTime(value: unknown): value is FactTime {
  if (!isRecord(value)) return false;
  const { start, end } = value;
  return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) && start <= end;
}

function isSource(value: unknown): value is FactSource {
  return isRecord(value) && isText(value["probe"]) && isText(value["version"]) && (value["tool"] === undefined || isText(value["tool"]));
}

/**
 * This function reads a fact of a record, for example a fact of a JSON report, and checks it.
 *
 * - A fact has an id, a kind, a layer, a subject, a time, a source and a value. The start of its time is at or before its end.
 * - A fact of a kind of `kinds` has the layer of its kind, and its value passes the check of its kind.
 * - The function does not check the value of a fact of another kind. Thus a record of a later version can have new kinds.
 *
 * The result is the same object with the type `Fact`, or the problems of the value.
 */
export function readFact(value: unknown, kinds: readonly FactKind<unknown>[]): Result<Fact, string[]> {
  if (!isRecord(value)) return err(["The fact is not an object."]);
  const name = isText(value["id"]) ? `The fact ${value["id"]}` : "The fact";
  const problems: string[] = [];
  if (!isText(value["id"])) problems.push(`${name} has no id.`);
  if (typeof value["kind"] !== "string" || !KIND_NAME.test(value["kind"])) problems.push(`${name} has no valid kind.`);
  if (!isLayer(value["layer"])) problems.push(`${name} has no valid layer.`);
  if (!isSubject(value["subject"])) problems.push(`${name} has no valid subject.`);
  if (!isTime(value["time"])) problems.push(`${name} has no valid time.`);
  if (!isSource(value["source"])) problems.push(`${name} has no valid source.`);
  if (!("value" in value)) problems.push(`${name} has no value.`);
  if (problems.length > 0) return err(problems);
  const fact = value as unknown as Fact;
  const kind = kinds.find((each) => each.kind === fact.kind);
  if (kind !== undefined && !isFactOf(kind, fact)) return err([`${name} has a layer or a value that the kind ${kind.kind} does not accept.`]);
  return ok(fact);
}
