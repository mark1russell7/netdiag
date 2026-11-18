import { STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { concentrationCatalog, concentrationRecord, concentrationsSource, repeatGain, type ConcentrationFit } from "./repeats.ts";

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
});
