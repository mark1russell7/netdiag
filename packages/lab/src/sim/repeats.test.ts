import { STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { concentrationCatalog, concentrationIntervals, concentrationRecord, concentrationsSource, intervalText, repeatGain, type CaseUnit, type ConcentrationFit } from "./repeats.ts";

const fitOf = (feature: string, concentration: number | undefined): ConcentrationFit => ({ feature, concentration, repeats: 10, agree: 0.9, gain: 0 });

describe("the concentrations of the repeats", () => {
  it("give a catalog with the fitted concentrations, and no concentration for the other features", () => {
    const catalog = concentrationCatalog([fitOf("tls.trust", 0.05), fitOf("tcp.connect", undefined)]);
    expect(catalog.features.get("tls.trust")?.concentration).toBe(0.05);
    expect(catalog.features.get("tcp.connect")?.concentration).toBeUndefined();
    expect(catalog.hypotheses.map((each) => each.id)).toEqual(STANDARD_CATALOG.hypotheses.map((each) => each.id));
  });

  it("refuse a concentration of 0", () => {
    expect(() => concentrationCatalog([fitOf("tls.trust", 0)])).toThrow(/concentration of tls.trust is 0/);
  });

  it("give a record and a source with only the fitted features", () => {
    const fits = [fitOf("tls.trust", 0.05), fitOf("tcp.connect", undefined), fitOf("dns.answer", 12)];
    expect(concentrationRecord(fits)).toEqual({ "tls.trust": 0.05, "dns.answer": 12 });
    expect(concentrationsSource(fits)).toContain(`= {\n  "tls.trust": 0.05,\n  "dns.answer": 12,\n};\n`);
    expect(concentrationsSource([fitOf("tcp.connect", undefined)])).toContain("= {};\n");
  });

  it("give a gain over independent repeats that is more than 0 for copies, and 0 with no concentration", () => {
    const units = [
      { observations: ["a", "a"], base: { a: 0.5, b: 0.5 } },
      { observations: ["b", "b"], base: { a: 0.5, b: 0.5 } },
    ];
    expect(repeatGain(units, 0.01)).toBeGreaterThan(0.6);
    expect(repeatGain(units, undefined)).toBe(0);
    expect(repeatGain([], 0.01)).toBe(0);
  });

  it("give an interval of each fitted concentration that draws the cases, and no interval for an independent feature", () => {
    const base = { a: 0.5, b: 0.5 };
    // Four of five cases have copies, and one case has two different values. Each case has two roles, thus two units.
    const units: CaseUnit[] = Array.from({ length: 10 }, (_, index) => {
      const split = index >= 8;
      return { case: String(Math.floor(index / 2)), base, observations: split ? ["a", "b"] : index % 4 < 2 ? ["a", "a", "a"] : ["b", "b", "b"] };
    });
    const map = new Map([["tls.root", units], ["tcp.connect", units]]);
    const intervals = concentrationIntervals(map, [fitOf("tls.root", 0.5), fitOf("tcp.connect", undefined)], 50);
    const root = intervals.get("tls.root");
    expect(root?.runs).toBe(50);
    expect(root?.level).toBe(0.95);
    expect(root?.low).toBeLessThanOrEqual(root?.estimate ?? Number.NaN);
    expect(root?.estimate).toBeLessThanOrEqual(root?.high ?? Number.NaN);
    expect(intervals.has("tcp.connect")).toBe(false);
    expect(concentrationIntervals(map, [fitOf("tls.root", 0.5)], 50).get("tls.root")).toEqual(root);
  });

  it("give the text of an interval with the count of its finite runs", () => {
    const interval = { estimate: 0.01, low: 0.001, high: 0.0234, level: 0.95, runs: 200, finite: 200, seed: 1 };
    expect(intervalText(interval)).toBe("0.00100 to 0.0234");
    expect(intervalText({ ...interval, finite: 190 })).toBe("0.00100 to 0.0234 (190 of 200 runs finite)");
    expect(intervalText(undefined)).toBe("-");
  });
});
