import { describe, expect, it } from "vitest";
import { WIFI_LINK, target, type Fact, type WifiLink } from "../index.ts";
import { WIFI_CHANGE_KINDS, wifiChanges, wifiSignalOf } from "./index.ts";

const AP1 = "02:00:00:00:00:a1";
const AP2 = "02:00:00:00:00:a2";
const AP3 = "02:00:00:00:00:a3";

/** This function makes `wifi.link` facts. Each pair is a start time and a link. */
function facts(entries: readonly (readonly [number, WifiLink])[]): Fact<WifiLink>[] {
  return entries.map(([start, value], index) => ({
    id: `f${index}`,
    kind: WIFI_LINK.kind,
    layer: WIFI_LINK.layer,
    subject: target("localhost"),
    time: { start, end: start + 1 },
    source: { probe: "test", version: "1" },
    value,
  }));
}

function up(bssid: string, signalDbm: number, more: Partial<WifiLink> = {}): WifiLink {
  return { interface: "wlan0", state: "connected", ssid: "lab-net", bssid, signalDbm, channel: 36, ...more };
}

describe("wifiSignalOf", () => {
  it("gives the level in dBm, or the level of the quality of Windows", () => {
    expect(wifiSignalOf(up(AP1, -52))).toBe(-52);
    expect([0, 50, 100].map((quality) => wifiSignalOf({ interface: "Wi-Fi", state: "connected", quality }))).toEqual([-100, -75, -50]);
    expect(wifiSignalOf({ interface: "Wi-Fi", state: "connected", signalDbm: -40, quality: 10 })).toBe(-40);
  });

  it("gives no level for a link that is not connected, or with no level and no quality", () => {
    expect(wifiSignalOf({ interface: "wlan0", state: "disconnected" })).toBeUndefined();
    expect(wifiSignalOf({ interface: "wlan0", state: "connected" })).toBeUndefined();
  });
});

describe("wifiChanges", () => {
  it("tells each roam, change of channel, drop, join and change of network, in the order of time", () => {
    const series = facts([
      [0, up(AP1, -50)],
      [10, up(AP1, -55, { channel: 40 })],
      [20, up(AP2, -60, { channel: 40 })],
      [30, { interface: "wlan0", state: "disconnected" }],
      [40, up(AP2, -62)],
      [50, up(AP3, -70, { ssid: "guest-net" })],
    ]);
    const [result] = wifiChanges(series);
    expect(result?.changes).toEqual([
      { kind: "channel", at: 10, fact: "f1" },
      { kind: "roam", at: 20, fact: "f2" },
      { kind: "drop", at: 30, fact: "f3" },
      { kind: "join", at: 40, fact: "f4" },
      { kind: "network", at: 50, fact: "f5" },
    ]);
    expect(result?.counts).toEqual({ roam: 1, network: 1, channel: 1, drop: 1, join: 1 });
    expect(result?.samples).toBe(6);
  });

  it("sorts the facts of each interface by time, and keeps the interfaces apart", () => {
    const series = facts([
      [20, up(AP2, -60)],
      [0, { interface: "wlan1", state: "off" }],
      [0, up(AP1, -50)],
      [10, { interface: "wlan1", state: "off" }],
    ]);
    const results = wifiChanges(series);
    expect(results.map((result) => [result.interface, result.samples, result.changes.map((change) => change.kind)])).toEqual([
      ["wlan0", 2, ["roam"]],
      ["wlan1", 2, []],
    ]);
    expect(results[1]?.signal).toBeUndefined();
  });

  it("counts a change of the access point as a roam when the tool hides the name of the network", () => {
    const hidden = facts([
      [0, up(AP1, -50, { ssid: undefined })],
      [1, up(AP2, -50, { ssid: undefined })],
    ]);
    expect(wifiChanges(hidden)[0]?.counts.roam).toBe(1);
  });

  it("gives the summary of the signal and the median of the signal-to-noise ratio", () => {
    const series = facts([
      [0, up(AP1, -50, { noiseDbm: -90 })],
      [1, up(AP1, -60)],
      [2, up(AP1, -70, { noiseDbm: -94 })],
      [3, { interface: "wlan0", state: "disconnected" }],
    ]);
    expect(wifiChanges(series)[0]?.signal).toEqual({ samples: 3, minDbm: -70, medianDbm: -60, maxDbm: -50, snrDb: 32 });
    const noNoise = facts([[0, up(AP1, -50)]]);
    expect(wifiChanges(noNoise)[0]?.signal).toEqual({ samples: 1, minDbm: -50, medianDbm: -50, maxDbm: -50 });
  });

  it("gives no result for no fact, and a count of 0 for each kind of a link with no change", () => {
    expect(wifiChanges([])).toEqual([]);
    const [steady] = wifiChanges(facts([[0, up(AP1, -50)], [1, up(AP1, -51)]]));
    expect(steady?.counts).toEqual(Object.fromEntries(WIFI_CHANGE_KINDS.map((kind) => [kind, 0])));
  });
});
