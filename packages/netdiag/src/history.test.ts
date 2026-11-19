import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BASELINE_KINDS,
  HISTORY_KEYS,
  LINK_STATE,
  STANDARD_FEATURES,
  TLS_HANDSHAKE,
  historyKey,
  historyOf,
  target,
  type Fact,
  type HistoryHasher,
  type TlsHandshake,
  type VisitRole,
  type VisitStep,
} from "./core.ts";
import { HISTORY_KEY_BYTES, machineHasher } from "./history-key.ts";
import { HISTORY_PROBE } from "./probes/history.ts";

const KEY = new Uint8Array(HISTORY_KEY_BYTES).fill(7);
const HASHER: HistoryHasher = machineHasher(KEY);
const ROOT = "AB:CD:EF:01";

function handshake(address: string, outcome: TlsHandshake["outcome"], root?: string, servername?: string): Fact<TlsHandshake> {
  const certificate = root === undefined ? undefined : { subject: "a.test", issuer: "R", names: ["a.test"], validFrom: "2026-01-01T00:00:00.000Z", validTo: "2027-01-01T00:00:00.000Z", fingerprint256: "11:22", selfSigned: false, chain: 2, trust: "public" as const, root };
  const value: TlsHandshake = { address, port: 443, outcome, ms: 20, ...(servername === undefined ? {} : { servername }), ...(certificate === undefined ? {} : { certificate }) };
  return { id: `f-${address}-${outcome}-${root ?? ""}`, kind: TLS_HANDSHAKE.kind, layer: TLS_HANDSHAKE.layer, subject: target(address, 443), time: { start: 0, end: 1 }, source: { probe: "test", version: "1" }, value };
}

const step = (role: VisitRole, host: string, fact: Fact): VisitStep => ({ kind: "fact", role, host, fact });

describe("the keys of the history", () => {
  it("names a feature of the catalog with the values same and changed for each key, and a baseline kind for its layer", () => {
    for (const key of HISTORY_KEYS) {
      expect(STANDARD_FEATURES.find((feature) => feature.id === key.feature)?.values).toEqual(["same", "changed"]);
      expect(BASELINE_KINDS[key.kind.layer].kind).toBe(`${key.kind.layer}.baseline`);
    }
  });

  it("reads only the facts of its kind", () => {
    const key = historyKey<TlsHandshake>({ feature: "tls.root", kind: TLS_HANDSHAKE, read: (fact) => ({ value: fact.value.address, host: fact.value.address }), keeps: () => true });
    const link: Fact = { id: "l", kind: LINK_STATE.kind, layer: LINK_STATE.layer, subject: target("eth0"), time: { start: 0, end: 1 }, source: { probe: "test", version: "1" }, value: { state: "up", interfaces: [] } };
    expect(key.read(link)).toBeUndefined();
    expect(key.keeps(link)).toBe(false);
    expect(key.read(handshake("192.0.2.1", "ok"))?.value).toBe("192.0.2.1");
  });

  it("gives the root of a handshake with its servername as the host, or its address with no servername", () => {
    const [root] = HISTORY_KEYS;
    expect(root?.read(handshake("192.0.2.1", "ok", ROOT, "a.test"))).toEqual({ value: ROOT, host: "a.test", port: 443, address: "192.0.2.1" });
    expect(root?.read(handshake("192.0.2.1", "ok", ROOT))?.host).toBe("192.0.2.1");
    expect(root?.read(handshake("192.0.2.1", "ok"))).toBeUndefined();
    expect(root?.keeps(handshake("192.0.2.1", "cert-error", ROOT))).toBe(false);
  });
});

describe("the history of a good check", () => {
  it("keeps the hash of each root of the target and the references one time, with the time and the id of the key", () => {
    const steps = [
      step("target", "a.test", handshake("192.0.2.1", "ok", ROOT, "a.test")),
      step("target", "a.test", handshake("192.0.2.2", "ok", ROOT, "a.test")),
      step("target", "a.test", handshake("192.0.2.3", "ok", "99:99", "a.test")),
      step("target", "a.test", handshake("192.0.2.4", "cert-error", "66:66", "a.test")),
      step("reference", "b.test", handshake("198.51.100.1", "ok", ROOT, "b.test")),
      step("gateway", "192.0.2.254", handshake("192.0.2.254", "ok", ROOT)),
      { kind: "problem", role: "target", host: "a.test", problem: "no answer" },
    ] satisfies VisitStep[];
    const history = historyOf(steps, { checked: "2026-11-18T12:00:00.000Z", hasher: HASHER });
    expect([...history.keys()]).toEqual(["a.test", "b.test"]);
    expect(history.get("a.test")).toEqual({ checked: "2026-11-18T12:00:00.000Z", key: HASHER.id, values: { "tls.root": [HASHER.hash(ROOT), HASHER.hash("99:99")] } });
    expect(history.get("b.test")?.values["tls.root"]).toEqual([HASHER.hash(ROOT)]);
  });

  it("gives no history for a host with no fact that a key keeps", () => {
    expect(historyOf([step("target", "a.test", handshake("192.0.2.1", "timeout"))], { checked: "2026-11-18T12:00:00.000Z", hasher: HASHER }).size).toBe(0);
  });

  it("keeps no raw value: no root, no address and no MAC address is in the text of a history", () => {
    const hex = fc.stringMatching(/^[0-9A-F]{2}(:[0-9A-F]{2}){5,31}$/);
    const address = fc.ipV4();
    const addressKey = historyKey<TlsHandshake>({ feature: "tls.address", kind: TLS_HANDSHAKE, read: (fact) => ({ value: fact.value.address, host: fact.value.servername ?? fact.value.address }), keeps: () => true });
    fc.assert(
      fc.property(fc.array(fc.tuple(address, hex), { minLength: 1, maxLength: 8 }), (entries) => {
        const steps = entries.map(([ip, root]) => step("target", "a.test", handshake(ip, "ok", root, "a.test")));
        const text = JSON.stringify([...historyOf(steps, { checked: "2026-11-18T12:00:00.000Z", hasher: HASHER, keys: [...HISTORY_KEYS, addressKey] })]);
        return entries.every(([ip, root]) => !text.includes(ip) && !text.includes(root) && !text.toLowerCase().includes(root.toLowerCase()));
      }),
    );
  });
});

describe("the hasher of a machine", () => {
  it("gives the same hash for the same value and key, and a different hash and id for a different key", () => {
    const other = machineHasher(new Uint8Array(HISTORY_KEY_BYTES).fill(8));
    expect(HASHER.hash(ROOT)).toBe(machineHasher(KEY).hash(ROOT));
    expect(HASHER.hash(ROOT)).toMatch(/^[0-9a-f]{64}$/);
    expect(other.hash(ROOT)).not.toBe(HASHER.hash(ROOT));
    expect(other.id).not.toBe(HASHER.id);
    expect(HASHER.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuses a key of fewer than 32 bytes, and keeps a copy of the key", () => {
    expect(() => machineHasher(new Uint8Array(HISTORY_KEY_BYTES - 1))).toThrow(RangeError);
    const key = new Uint8Array(HISTORY_KEY_BYTES).fill(7);
    const hasher = machineHasher(key);
    const before = hasher.hash(ROOT);
    key.fill(0);
    expect(hasher.hash(ROOT)).toBe(before);
  });
});

describe("the history probe", () => {
  it("gives one baseline fact for each key with values, of the port of the host, and no packet", async () => {
    const context = { clock: { now: () => 5 } } as Parameters<typeof HISTORY_PROBE.run>[1];
    const history = { checked: "2026-11-18T12:00:00.000Z", key: HASHER.id, values: { "tls.root": [HASHER.hash(ROOT)], "no.key": ["x"] } };
    const input = { host: "a.test", port: 8443, history };
    const raw = await HISTORY_PROBE.run(input, context);
    const observations = HISTORY_PROBE.parse(raw, input);
    expect(observations).toEqual([
      { kind: BASELINE_KINDS.tls, subject: target("a.test", 8443), value: { feature: "tls.root", values: [HASHER.hash(ROOT)], checked: history.checked, key: HASHER.id }, time: { start: 5, end: 5 } },
    ]);
    expect(HISTORY_PROBE.peers({ host: "a.test", history })).toEqual([]);
    expect(HISTORY_PROBE.parse({ ...raw, history: { ...history, values: { "tls.root": [] } } }, input)).toEqual([]);
  });
});
