import { entropy } from "@mark1russell7/rigor-statistics";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_JOINT_VALUES,
  STANDARD_CATALOG,
  STANDARD_FEATURES,
  diagnose,
  predictive,
  rankProbes,
  type Candidate,
  type Diagnosis,
  type Evidence,
  type Observable,
} from "./index.ts";

const catalog = STANDARD_CATALOG;

/** The entropy of the causes of a diagnosis, with the causes after the first `top` causes of `groups` in one group. */
function entropyOf(diagnosis: Diagnosis, groups: readonly string[] | undefined): number {
  if (groups === undefined) return entropy(diagnosis.causes.map((cause) => cause.probability));
  const apart = groups.map((id) => diagnosis.causes.find((cause) => cause.id === id)?.probability ?? 0);
  return entropy([...apart, Math.max(0, 1 - apart.reduce((a, b) => a + b, 0))]);
}

/** The expected fall of the entropy of the causes from the observation of some features, from `diagnose` and `predictive`. */
function expectedFall(evidence: readonly Evidence[], observes: readonly Observable[], top?: number): number {
  const before = diagnose(catalog, evidence);
  const groups = top === undefined ? undefined : before.causes.slice(0, top).map((cause) => cause.id);
  let after = 0;
  const walk = (index: number, known: readonly Evidence[], p: number): void => {
    const item = observes[index];
    if (item === undefined) {
      after += p * entropyOf(diagnose(catalog, known), groups);
      return;
    }
    const dist = predictive(catalog, diagnose(catalog, known), item.feature, item.primary);
    for (const [value, q] of Object.entries(dist)) walk(index + 1, [...known, { feature: item.feature, value, primary: item.primary }], p * q);
  };
  walk(0, evidence, 1);
  return entropyOf(before, groups) - after;
}

const gainOf = (evidence: readonly Evidence[], observes: readonly Observable[], top?: number): number =>
  rankProbes(catalog, diagnose(catalog, evidence), [{ id: "c", observes }], { top })[0]?.gain ?? Number.NaN;

const evidenceItem = fc
  .tuple(fc.constantFrom(...STANDARD_FEATURES), fc.boolean(), fc.nat())
  .map(([feature, primary, n]): Evidence => ({ feature: feature.id, value: feature.values[n % feature.values.length] ?? "", primary }));
const observable = fc.record({ feature: fc.constantFrom(...STANDARD_FEATURES.map((f) => f.id)), primary: fc.boolean() });
const key = (item: Observable): string => `${item.feature}|${String(item.primary)}`;

describe("rankProbes", () => {
  it("gives the expected fall of the entropy of the causes", () => {
    fc.assert(
      fc.property(fc.array(evidenceItem, { maxLength: 4 }), fc.uniqueArray(observable, { minLength: 1, maxLength: 2, selector: key }), fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }), (evidence, observes, top) => {
        const fresh = observes.filter((item) => !evidence.some((e) => key(e) === key(item)));
        expect(gainOf(evidence, observes, top)).toBeCloseTo(fresh.length === 0 ? 0 : expectedFall(evidence, fresh, top), 9);
      }),
      { seed: 20261115, numRuns: 120 },
    );
  });

  it("gives at least the gain of a part of the features, and at most the entropy of the causes", () => {
    fc.assert(
      fc.property(fc.array(evidenceItem, { maxLength: 4 }), fc.uniqueArray(observable, { minLength: 2, maxLength: 3, selector: key }), (evidence, observes) => {
        const all = gainOf(evidence, observes);
        expect(all).toBeGreaterThanOrEqual(gainOf(evidence, observes.slice(1)) - 1e-12);
        expect(all).toBeLessThanOrEqual(entropyOf(diagnose(catalog, evidence), undefined) + 1e-12);
      }),
      { seed: 20261116, numRuns: 120 },
    );
  });

  it("gives 0 to a feature that the evidence has with the same role", () => {
    const evidence = [{ feature: "tcp.connect", value: "timeout", primary: true }];
    const [choice] = rankProbes(catalog, diagnose(catalog, evidence), [{ id: "again", observes: [{ feature: "tcp.connect", primary: true }] }]);
    expect(choice).toMatchObject({ gain: 0, counted: [] });
    expect(gainOf(evidence, [{ feature: "tcp.connect", primary: false }])).toBeGreaterThan(0);
  });

  it("counts a feature once when a candidate names it twice", () => {
    const once = gainOf([], [{ feature: "dns.answer", primary: true }]);
    expect(gainOf([], [{ feature: "dns.answer", primary: true }, { feature: "dns.answer", primary: true }])).toBeCloseTo(once, 12);
  });

  it("puts the ping of the gateway first after a DNS timeout", () => {
    // A DNS timeout leaves the resolver, the gateway and the interface. The reply of the gateway tells them apart.
    const evidence = [{ feature: "dns.answer", value: "timeout", primary: true }];
    const candidates: Candidate[] = [
      { id: "http.get reference", observes: [{ feature: "http.status", primary: false }] },
      { id: "icmp.ping gateway", observes: [{ feature: "gateway.reply", primary: true }] },
      { id: "tls.handshake reference", observes: [{ feature: "tls.handshake", primary: false }] },
    ];
    const ranked = rankProbes(catalog, diagnose(catalog, evidence), candidates);
    expect(ranked[0]?.candidate.id).toBe("icmp.ping gateway");
    expect(ranked.map((choice) => choice.gain)).toEqual([...ranked.map((choice) => choice.gain)].sort((a, b) => b - a));
  });

  it("puts the lower cost first when two gains are equal, then the order of the candidates", () => {
    const observes = [{ feature: "tcp.connect", primary: true }];
    const ranked = rankProbes(catalog, diagnose(catalog, []), [
      { id: "slow", observes, cost: 5 },
      { id: "first", observes },
      { id: "fast", observes, cost: 1 },
      { id: "second", observes, cost: 0 },
    ]);
    expect(ranked.map((choice) => choice.candidate.id)).toEqual(["first", "second", "fast", "slow"]);
  });

  it("refuses a bad option, an unknown feature and too many joint values", () => {
    const diagnosis = diagnose(catalog, []);
    const one: Candidate[] = [{ id: "c", observes: [{ feature: "tcp.connect", primary: true }] }];
    expect(() => rankProbes(catalog, diagnosis, one, { top: 0 })).toThrow(RangeError);
    expect(() => rankProbes(catalog, diagnosis, one, { top: 1.5 })).toThrow(RangeError);
    expect(() => rankProbes(catalog, diagnosis, [{ id: "c", observes: [{ feature: "no.such", primary: true }] }])).toThrow(/no feature/);
    const many = STANDARD_FEATURES.flatMap((feature) => [true, false].map((primary) => ({ feature: feature.id, primary })));
    expect(() => rankProbes(catalog, diagnosis, [{ id: "all", observes: many }])).toThrow(new RegExp(String(MAX_JOINT_VALUES)));
  });
});
