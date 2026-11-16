import { median } from "@mark1russell7/rigor-statistics";
import type { Fact } from "../fact.ts";
import type { WifiLink } from "../kinds.ts";

// The estimators of the Wi-Fi link (ND-10). Each one reads the `wifi.link` facts of one interface in the order of time.

/**
 * This function gives the signal level of a Wi-Fi link, in dBm. Windows gives a quality from 0 to 100 when it gives no
 * level. The quality of the WLAN API of Windows is linear from -100 dBm (0) to -50 dBm (100), so the level is
 * `quality / 2 - 100`. A link that is not connected has no signal.
 */
export function wifiSignalOf(link: WifiLink): number | undefined {
  if (link.state !== "connected") return undefined;
  if (link.signalDbm !== undefined) return link.signalDbm;
  return link.quality === undefined ? undefined : link.quality / 2 - 100;
}

/**
 * The kinds of a change of a Wi-Fi link between two facts of one interface.
 *
 * - `roam`: the access point changed, and the network stayed the same. A tool that hides the name of the network gives a roam for each change of the access point.
 * - `network`: the interface moved to another network.
 * - `channel`: the access point stayed the same, and its channel changed.
 * - `drop`: the interface lost its link.
 * - `join`: the interface got a link again.
 */
export const WIFI_CHANGE_KINDS = ["roam", "network", "channel", "drop", "join"] as const;
export type WifiChangeKind = (typeof WIFI_CHANGE_KINDS)[number];

/** One change of a Wi-Fi link, at the start time of the later fact. */
export interface WifiChange {
  readonly kind: WifiChangeKind;
  /** The start time of the fact that shows the change, in milliseconds of the clock of the runner. */
  readonly at: number;
  /** The id of the fact that shows the change. */
  readonly fact: string;
}

/** The summary of the signal levels of the connected facts of one interface, in dBm. */
export interface WifiSignalSummary {
  readonly samples: number;
  readonly minDbm: number;
  readonly medianDbm: number;
  readonly maxDbm: number;
  /**
   * The median of the signal-to-noise ratio, in dB. It uses only the facts with a level of the noise. Windows gives no
   * level of the noise.
   */
  readonly snrDb?: number | undefined;
}

/** The changes of the Wi-Fi link of one interface over a series of facts. */
export interface WifiChanges {
  readonly interface: string;
  /** The number of facts of the interface. */
  readonly samples: number;
  /** The changes, in the order of time. */
  readonly changes: readonly WifiChange[];
  /** The number of each kind of change. */
  readonly counts: Readonly<Record<WifiChangeKind, number>>;
  /** The summary of the signal. A series with no connected fact that has a signal does not have it. */
  readonly signal?: WifiSignalSummary | undefined;
}

function changeOf(before: WifiLink, after: WifiLink): WifiChangeKind | undefined {
  const was = before.state === "connected";
  const is = after.state === "connected";
  if (was && !is) return "drop";
  if (!was && is) return "join";
  if (!was || !is) return undefined;
  if (before.bssid !== undefined && after.bssid !== undefined && before.bssid !== after.bssid) return before.ssid === after.ssid ? "roam" : "network";
  if (before.ssid !== after.ssid) return "network";
  if (before.channel !== undefined && after.channel !== undefined && before.channel !== after.channel) return "channel";
  return undefined;
}

function signalSummary(links: readonly WifiLink[]): WifiSignalSummary | undefined {
  const levels = links.flatMap((link) => {
    const level = wifiSignalOf(link);
    return level === undefined ? [] : [level];
  });
  if (levels.length === 0) return undefined;
  const ratios = links.flatMap((link) => {
    const level = wifiSignalOf(link);
    return level === undefined || link.noiseDbm === undefined ? [] : [level - link.noiseDbm];
  });
  return {
    samples: levels.length,
    minDbm: Math.min(...levels),
    medianDbm: median(levels),
    maxDbm: Math.max(...levels),
    ...(ratios.length === 0 ? {} : { snrDb: median(ratios) }),
  };
}

/**
 * This function gives the changes of the Wi-Fi link of each interface, in the order of the first fact of each interface.
 * It sorts the facts of an interface by their start time. Two facts at the same time keep their order in the list.
 */
export function wifiChanges(facts: readonly Fact<WifiLink>[]): WifiChanges[] {
  const byInterface = new Map<string, Fact<WifiLink>[]>();
  for (const fact of facts) {
    const list = byInterface.get(fact.value.interface) ?? [];
    list.push(fact);
    byInterface.set(fact.value.interface, list);
  }
  return [...byInterface].map(([name, list]) => {
    const series = [...list].sort((a, b) => a.time.start - b.time.start);
    const changes: WifiChange[] = [];
    for (let index = 1; index < series.length; index += 1) {
      const before = series[index - 1];
      const after = series[index];
      if (before === undefined || after === undefined) continue;
      const kind = changeOf(before.value, after.value);
      if (kind !== undefined) changes.push({ kind, at: after.time.start, fact: after.id });
    }
    const counts = Object.fromEntries(WIFI_CHANGE_KINDS.map((kind) => [kind, changes.filter((change) => change.kind === kind).length])) as Record<WifiChangeKind, number>;
    const signal = signalSummary(series.map((fact) => fact.value));
    return { interface: name, samples: series.length, changes, counts, ...(signal === undefined ? {} : { signal }) };
  });
}
