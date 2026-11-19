import { entropy } from "@mark1russell7/rigor-statistics";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_JOINT_VALUES,
  STANDARD_CATALOG,
  STANDARD_CATALOG_SPEC,
  STANDARD_FEATURES,
  compileCatalog,
  diagnose,
  predictive,
  rankProbes,
  type Candidate,
  type Catalog,
  type Diagnosis,
  type Evidence,
  type Feature,
  type Observable,
} from "./index.ts";

const catalog = STANDARD_CATALOG;

/** The standard catalog with a concentration for each feature from `of`. No value gives independent repeats. */
function withConcentrations(of: (feature: Feature, index: number) => number | undefined): Catalog {
  const compiled = compileCatalog({ ...STANDARD_CATALOG_SPEC, features: STANDARD_FEATURES.map((feature, index) => ({ ...feature, concentration: of(feature, index) })) });
  if (compiled.tag === "err") throw new Error(compiled.error.join(" "));
  return compiled.value;
}

const independent = withConcentrations(() => undefined);
const mixed = withConcentrations((_, index) => [undefined, 0.05, 2, 50][index % 4]);
const copies = withConcentrations(() => 1e-9);

/** The entropy of the causes of a diagnosis, with the causes after the first `top` causes of `groups` in one group. */
function entropyOf(diagnosis: Diagnosis, groups: readonly string[] | undefined): number {
  if (groups === undefined) return entropy(diagnosis.causes.map((cause) => cause.probability));
  const apart = groups.map((id) => diagnosis.causes.find((cause) => cause.id === id)?.probability ?? 0);
  return entropy([...apart, Math.max(0, 1 - apart.reduce((a, b) => a + b, 0))]);
}

/** The expected fall of the entropy of the causes from the observation of some features, from `diagnose` and `predictive`. */
function expectedFall(evidence: readonly Evidence[], observes: readonly Observable[], top?: number, model: Catalog = catalog): number {
  const before = diagnose(model, evidence);
  const groups = top === undefined ? undefined : before.causes.slice(0, top).map((cause) => cause.id);
  let after = 0;
  const walk = (index: number, known: readonly Evidence[], p: number): void => {
    const item = observes[index];
    if (item === undefined) {
      after += p * entropyOf(diagnose(model, known), groups);
      return;
    }
    const dist = predictive(model, diagnose(model, known), item.feature, item.primary);
    for (const [value, q] of Object.entries(dist)) walk(index + 1, [...known, { feature: item.feature, value, primary: item.primary }], p * q);
  };
  walk(0, evidence, 1);
  return entropyOf(before, groups) - after;
}

const gainOf = (evidence: readonly Evidence[], observes: readonly Observable[], top?: number, model: Catalog = catalog): number =>
  rankProbes(model, diagnose(model, evidence), [{ id: "c", observes }], { top })[0]?.gain ?? Number.NaN;
const model = fc.constantFrom(independent, mixed, copies);

const evidenceItem = fc
  .tuple(fc.constantFrom(...STANDARD_FEATURES), fc.boolean(), fc.nat())
  .map(([feature, primary, n]): Evidence => ({ feature: feature.id, value: feature.values[n % feature.values.length] ?? "", primary }));
const observable = fc.record({ feature: fc.constantFrom(...STANDARD_FEATURES.map((f) => f.id)), primary: fc.boolean() });
const key = (item: Observable): string => `${item.feature}|${String(item.primary)}`;

describe("rankProbes", () => {
  it("gives the expected fall of the entropy of the causes, with repeats in the evidence and in the candidate", () => {
    // The evidence draws its features from a small set, thus most candidates repeat a feature and role of the evidence.
    const near = fc.record({ feature: fc.constantFrom("tcp.connect", "tls.trust", "dns.answer"), primary: fc.boolean() });
    const nearItem = near.chain((item) => fc.constantFrom(...(catalog.features.get(item.feature)?.values ?? [])).map((value): Evidence => ({ ...item, value })));
    fc.assert(
      fc.property(model, fc.array(fc.oneof(evidenceItem, nearItem), { maxLength: 4 }), fc.array(fc.oneof(observable, near), { minLength: 1, maxLength: 2 }), fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }), (each, evidence, observes, top) => {
        expect(gainOf(evidence, observes, top, each)).toBeCloseTo(expectedFall(evidence, observes, top, each), 9);
      }),
      { seed: 20261115, numRuns: 150 },
    );
  });

  it("gives the expected fall of the entropy for 3 and 4 features, with each feature of the candidate as a digit", () => {
    fc.assert(
      fc.property(model, fc.array(evidenceItem, { maxLength: 2 }), fc.array(observable, { minLength: 3, maxLength: 4 }), fc.option(fc.constant(3), { nil: undefined }), (each, evidence, observes, top) => {
        expect(gainOf(evidence, observes, top, each)).toBeCloseTo(expectedFall(evidence, observes, top, each), 9);
      }),
      { seed: 20261117, numRuns: 30 },
    );
  });

  it("ranks the 7 features of an HTTPS request, with 5400 joint values", () => {
    const https = ["tcp.connect", "tcp.time", "tls.handshake", "tls.trust", "tls.ratio", "http.status", "http.ttfb"];
    expect(https.reduce((product, id) => product * (catalog.features.get(id)?.values.length ?? Number.NaN), 1)).toBe(5400);
    for (const primary of [true, false]) {
      const observes = https.map((feature) => ({ feature, primary }));
      const tls = observes.filter((item) => !item.feature.startsWith("http."));
      for (const top of [3, undefined]) {
        const gain = gainOf([], observes, top);
        expect(gain).toBeGreaterThanOrEqual(gainOf([], tls, top) - 1e-12);
        expect(gain).toBeLessThanOrEqual(entropy(diagnose(catalog, []).causes.map((cause) => cause.probability)) + 1e-12);
      }
    }
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

  it("gives nearly 0 to a copy of a feature that the evidence has, and a gain to an independent repeat", () => {
    const evidence = [{ feature: "tcp.connect", value: "timeout", primary: true }];
    const again = [{ feature: "tcp.connect", primary: true }];
    expect(gainOf(evidence, again, undefined, copies)).toBeLessThan(1e-6);
    expect(gainOf(evidence, again, undefined, independent)).toBeGreaterThan(0.01);
    expect(gainOf(evidence, [{ feature: "tcp.connect", primary: false }], undefined, copies)).toBeGreaterThan(0.01);
  });

  it("gives a feature that a candidate names two times the gain of one copy, or more for independent repeats", () => {
    const one = [{ feature: "dns.answer", primary: true }];
    const two = [...one, ...one];
    expect(gainOf([], two, undefined, copies)).toBeCloseTo(gainOf([], one, undefined, copies), 6);
    expect(gainOf([], two, undefined, independent)).toBeGreaterThan(gainOf([], one, undefined, independent) + 1e-6);
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
