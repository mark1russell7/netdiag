import { observe, type Observation } from "../fact.ts";
import { HISTORY_KEYS, type HistoryKey } from "../history.ts";
import { BASELINE_KINDS } from "../kinds.ts";
import { defineProbe, type Availability, type Probe } from "../probe.ts";
import { target } from "../target.ts";
import type { HostHistory } from "../visit-types.ts";

// The history probe gives the baseline facts of the history that the caller keeps. It sends no packet. A visit starts it
// for each host with a history, before the other probes of the host.

/** The input of the history probe: a host of the visit, and its history. */
export interface HistoryInput {
  readonly host: string;
  /** The port of the service of the host. The baseline facts are of this port. */
  readonly port?: number | undefined;
  readonly history: HostHistory;
}

/** The raw result of the history probe: its input, and the times of the run. */
export interface HistoryRaw extends HistoryInput {
  readonly start: number;
  readonly end: number;
}

const NATIVE: Availability = { available: true, version: process.versions.node };

/**
 * This function gives the history probe. The probe gives one baseline fact for each key of the history with values. The
 * kind of the fact is the baseline kind of the layer of the key, for example `tls.baseline`. It skips a feature of no key.
 */
export function historyProbe(keys: readonly HistoryKey[] = HISTORY_KEYS): Probe<HistoryInput, HistoryRaw> {
  return defineProbe<HistoryInput, HistoryRaw>({
    id: "history",
    version: "1",
    summary: "The values of the keys of the facts of a host in its good checks, from the history of the caller.",
    // The layer of the probe is the layer of its first key. The kind of each fact has the layer of its key.
    layer: keys[0]?.kind.layer ?? "tls",
    mode: "passive",
    kinds: [...new Set(keys.map((key) => BASELINE_KINDS[key.kind.layer]))],
    peers: () => [],
    available: () => Promise.resolve(NATIVE),
    run(input, context) {
      const start = context.clock.now();
      return Promise.resolve({ ...input, start, end: context.clock.now() });
    },
    parse(raw) {
      const observations: Observation[] = [];
      for (const key of keys) {
        const values = raw.history.values[key.feature];
        if (values === undefined || values.length === 0) continue;
        const value = { feature: key.feature, values, checked: raw.history.checked, key: raw.history.key };
        observations.push(observe(BASELINE_KINDS[key.kind.layer], target(raw.host, raw.port), value, { start: raw.start, end: raw.end }));
      }
      return observations;
    },
  });
}

/** The history probe of the keys of `HISTORY_KEYS`. */
export const HISTORY_PROBE: Probe<HistoryInput, HistoryRaw> = historyProbe();
