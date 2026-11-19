import { isFactOf, type Fact, type FactKind } from "./fact.ts";
import { TLS_HANDSHAKE, type TlsHandshake } from "./kinds.ts";
import type { HostHistory, VisitStep } from "./visit-types.ts";

// The history of a host is the values of some keys of its facts in its good checks. The caller keeps the history of a
// good check, and gives it to the next visit. The visit gives it as baseline facts, and the reader compares each key with
// its baseline. Each key is data: a new key is a new entry of `HISTORY_KEYS`.
//
// The history keeps a keyed hash of each value, not the value. The comparison needs only equality, and the key stays on
// the machine. Thus a history, and a record with its baseline facts, holds no network identity.

/** A keyed hash of the values of a history. The function `machineHasher` of the Node entry gives one with a key of the machine. */
export interface HistoryHasher {
  /** The id of the key: a hash of the key. It tells nothing about the key or about a value. */
  readonly id: string;
  /** This function gives the keyed hash of a value. Two equal values give the same hash. */
  readonly hash: (value: string) => string;
}

/** The value of a key in one fact, and the host of the history that the value compares with. */
export interface HistoryRead {
  /** The value of the key, for example the fingerprint of a root. */
  readonly value: string;
  /** The host of the visit that the history is of: a DNS name or an IP address. */
  readonly host: string;
  /** The port of the fact. A baseline with a port compares only with the facts of its port. */
  readonly port?: number | undefined;
  /** The address of the fact, when it has one. A fact of an address of a broken family gives no comparison. */
  readonly address?: string | undefined;
}

/** A key of the facts of one kind that the history keeps, and the feature that compares it with the history. */
export interface HistoryKey {
  /** The feature of the comparison, for example `tls.root`. Its values are `same` and `changed`. */
  readonly feature: string;
  /** The fact kind of the key. */
  readonly kind: FactKind<unknown>;
  /** This function gives the value of the key in a fact, or `undefined` for a fact of another kind or with no value. */
  readonly read: (fact: Fact) => HistoryRead | undefined;
  /** This function tells if a good check keeps the value of a fact in the history. */
  readonly keeps: (fact: Fact) => boolean;
  /**
   * The features whose value in a fact is a property of the value of the key. When the key is `same`, the value of the
   * key explains these features: they had this value in a good check. So the reader does not read them from the fact.
   */
  readonly explains: readonly string[];
}

/** The data of a key of the facts of one kind, with the types of the kind. The function `historyKey` makes the key. */
export interface HistoryKeySpec<V> {
  readonly feature: string;
  readonly kind: FactKind<V>;
  readonly read: (fact: Fact<V>) => HistoryRead | undefined;
  readonly keeps: (fact: Fact<V>) => boolean;
  readonly explains?: readonly string[] | undefined;
}

/** This function makes a key of the history from its data. The key reads only the facts of its kind. */
export function historyKey<V>(spec: HistoryKeySpec<V>): HistoryKey {
  return {
    feature: spec.feature,
    kind: spec.kind as FactKind<unknown>,
    read: (fact) => (isFactOf(spec.kind, fact) ? spec.read(fact) : undefined),
    keeps: (fact) => isFactOf(spec.kind, fact) && spec.keeps(fact),
    explains: spec.explains ?? [],
  };
}

/**
 * The keys of the history.
 *
 * - `tls.root`: the root of the certificate chain of a TLS handshake. A good check keeps the root of each handshake `ok`.
 *   The trust of a root is a property of the root. Thus a root of a good check explains `tls.trust` of the handshake.
 *
 * The next keys are the address of the gateway on the link, the resolver, the route and the key of the certificate.
 */
export const HISTORY_KEYS: readonly HistoryKey[] = [
  historyKey<TlsHandshake>({
    feature: "tls.root",
    kind: TLS_HANDSHAKE,
    read: (fact) => {
      const root = fact.value.certificate?.root;
      return root === undefined ? undefined : { value: root, host: fact.value.servername ?? fact.value.address, port: fact.value.port, address: fact.value.address };
    },
    keeps: (fact) => fact.value.outcome === "ok",
    explains: ["tls.trust"],
  }),
];

/** The options of `historyOf`. */
export interface HistoryOptions {
  /** The time of the good check, as an ISO 8601 time. */
  readonly checked: string;
  /** The keyed hash of the values. The history keeps the hashes and the id of the key. */
  readonly hasher: HistoryHasher;
  /** The keys of the history. The default is `HISTORY_KEYS`. */
  readonly keys?: readonly HistoryKey[] | undefined;
}

/**
 * This function gives the history of each host of the steps of a visit, for the hosts of the roles `target` and
 * `reference`. Give it only the steps of a good check: a check with the diagnosis `none`.
 *
 * - The history of a host has the keyed hash of the value of each fact that a key keeps, each hash one time.
 * - A host with no such fact has no history.
 */
export function historyOf(steps: readonly VisitStep[], options: HistoryOptions): ReadonlyMap<string, HostHistory> {
  const hosts = new Map<string, Map<string, string[]>>();
  for (const step of steps) {
    if (step.kind !== "fact" || (step.role !== "target" && step.role !== "reference")) continue;
    for (const key of options.keys ?? HISTORY_KEYS) {
      const read = key.keeps(step.fact) ? key.read(step.fact) : undefined;
      if (read === undefined) continue;
      const values = hosts.get(step.host) ?? new Map<string, string[]>();
      const known = values.get(key.feature) ?? [];
      const hash = options.hasher.hash(read.value);
      if (!known.includes(hash)) known.push(hash);
      values.set(key.feature, known);
      hosts.set(step.host, values);
    }
  }
  return new Map([...hosts].map(([host, values]) => [host, { checked: options.checked, key: options.hasher.id, values: Object.fromEntries(values) }]));
}
