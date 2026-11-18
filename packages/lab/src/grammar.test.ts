import { LAYERS, STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { checkSpace } from "@mark1russell7/strategy-space";
import { describe, expect, it } from "vitest";
import { FAULT_ATLAS } from "./atlas.ts";
import {
  FAULT_GRAMMAR,
  FAULT_MODES,
  FAULT_PLACES,
  GRAMMAR_CLASSES,
  GRAMMAR_OPTIONS,
  GRAMMAR_REASONS,
  NO_FAULT,
  OPTION_DEGREES,
  fault,
  faultClass,
  faultVariant,
  faults,
  faultsOf,
  grammarCounts,
  grammarMarkdown,
  grammarNeeds,
  grammarProblems,
  optionId,
  pairDecision,
  sampleTerms,
  sharedNeeds,
  termClasses,
  termNeeds,
  termProblems,
} from "./grammar.ts";

const CLASSES = new Map(GRAMMAR_CLASSES.map((each) => [each.id, each]));
const OPTION_IDS = new Set(GRAMMAR_OPTIONS.map(optionId));
const MTU = fault("path/size", { place: "transit", family: "ipv4", mtu: 1280 });
const ICMP = fault("path/filter", { place: "transit", kind: "icmp-too-big", family: "ipv4" });

describe("the fault grammar", () => {
  it("has no problems, and its space passes the checks of strategy-space", () => {
    expect(grammarProblems()).toEqual([]);
    expect(checkSpace(FAULT_GRAMMAR)).toEqual([]);
  });

  it("gives one decision for each pair of a layer and a mode, and each alias names an option", () => {
    const counts = grammarCounts();
    expect(counts.pairs).toBe(LAYERS.length * FAULT_MODES.length);
    expect(counts.options + counts.aliases + counts.reasons).toBe(counts.pairs);
    expect(counts.options).toBe(GRAMMAR_OPTIONS.length);
    for (const layer of LAYERS) {
      for (const mode of FAULT_MODES) {
        const decision = pairDecision(layer, mode);
        if (decision.kind === "reason") expect(Object.keys(GRAMMAR_REASONS), `${layer}/${mode}`).toContain(decision.reason);
        else expect(OPTION_IDS.has(decision.option), `${layer}/${mode} names ${decision.option}`).toBe(true);
      }
    }
  });

  it("uses each mode and each place in an option", () => {
    for (const mode of FAULT_MODES) expect(GRAMMAR_OPTIONS.some((each) => each.mode === mode), mode).toBe(true);
    for (const place of FAULT_PLACES) expect(GRAMMAR_OPTIONS.some((each) => each.places.includes(place)), place).toBe(true);
  });

  it("gives each fault class of the catalog, on the layer of the catalog", () => {
    for (const each of STANDARD_CATALOG.hypotheses.filter((hypothesis) => hypothesis.kind === "fault")) {
      expect(CLASSES.get(each.id)?.layer, each.id).toBe(each.layer);
    }
  });

  it("gives the class and the layer of each atlas entry from its term", () => {
    for (const entry of FAULT_ATLAS) {
      expect(termProblems(entry.term), entry.id).toEqual([]);
      const label = entry.hypothesis ?? entry.proposal ?? "";
      expect(termClasses(entry.term), entry.id).toContain(label);
      expect(CLASSES.get(label)?.layer, entry.id).toBe(entry.layer);
    }
  });

  it("gives path.mtu only for a small MTU and a filter of the ICMP message of the same family, in each order", () => {
    expect(termClasses(MTU)).toEqual([NO_FAULT]);
    expect(termClasses(ICMP)).toEqual([NO_FAULT]);
    expect(termClasses(faults(MTU, ICMP))).toEqual(["path.mtu"]);
    expect(termClasses(faults(ICMP, MTU))).toEqual(["path.mtu"]);
    const other = fault("path/filter", { place: "transit", kind: "icmp-too-big", family: "ipv6" });
    expect(termClasses(faults(MTU, other))).not.toContain("path.mtu");
    const reverse = fault("path/filter", { place: "transit", kind: "reverse-path", family: "ipv4" });
    expect(termClasses(faults(MTU, reverse))).toEqual(["path.asymmetric"]);
  });

  it("gives proxy.error for an error at the gateway or the provider, and server.error for an error at the remote or the server", () => {
    const refuse = (place: string, kind: string): readonly string[] => termClasses(fault("http/refuse", { place, kind }));
    expect(refuse("gateway", "error")).toEqual(["proxy.error"]);
    expect(refuse("provider", "error")).toEqual(["proxy.error"]);
    expect(refuse("remote", "error")).toEqual(["server.error"]);
    expect(refuse("server", "error")).toEqual(["server.error"]);
    expect(refuse("gateway", "auth")).toEqual(["proxy.auth"]);
  });

  it("gives a class only the traits that each of its terms needs", () => {
    expect(CLASSES.get("path.mtu")?.needs).toEqual([]);
    const ipv6 = FAULT_ATLAS.find((each) => each.id === "path.ipv6-too-big-filtered");
    expect(ipv6 === undefined ? [] : termNeeds(ipv6.term)).toEqual(["ipv6"]);
    expect(CLASSES.get("ipv6.broken")?.needs).toEqual(["ipv6"]);
    expect(grammarNeeds(["path.mtu", "ipv6.broken", "wifi.weak"])).toEqual({ "ipv6.broken": ["ipv6"], "wifi.weak": ["wifi"] });
    expect(sharedNeeds([["ipv6", "link"], ["link"], ["link", "wifi"]])).toEqual(["link"]);
    expect(sharedNeeds([])).toEqual([]);
    for (const term of sampleTerms(300, 17)) {
      const needs = termNeeds(term);
      for (const id of termClasses(term)) for (const trait of CLASSES.get(id)?.needs ?? []) expect(needs, `${id} of ${JSON.stringify(term)}`).toContain(trait);
    }
  });

  it("gives the same seeded sample for the same seed, and each term of it is a term of the grammar", () => {
    const one = sampleTerms(40, 5);
    expect(sampleTerms(40, 5)).toEqual(one);
    expect(sampleTerms(40, 6)).not.toEqual(one);
    const two = sampleTerms(40, 5, true);
    for (const term of [...one, ...two]) expect(termProblems(term), JSON.stringify(term)).toEqual([]);
    for (const term of one) expect(faultsOf(term)).toHaveLength(1);
    for (const term of two) expect(faultsOf(term)).toHaveLength(2);
  });

  it("refuses a term with an option that the grammar does not have", () => {
    expect(termProblems(fault("dns/nothing"))).not.toEqual([]);
    expect(() => faults(MTU, { space: FAULT_GRAMMAR.engine, stages: {} })).toThrow(RangeError);
  });

  it("writes a row of the table for each mode, and a line for each reason", () => {
    const lines = grammarMarkdown().split("\n");
    expect(lines.filter((line) => line.startsWith("| `"))).toHaveLength(FAULT_MODES.length);
    expect(lines).toContain(`| Mode | ${LAYERS.join(" | ")} |`);
    for (const [at, text] of Object.values(GRAMMAR_REASONS).entries()) expect(lines).toContain(`  ${String(at + 1)}. ${text}`);
  });

  it("gives each fault of a table entry a degree of the hypothesis of its class, and no degree to a fault of no entry", () => {
    const reach = (): undefined => undefined;
    for (const entry of OPTION_DEGREES) {
      expect(OPTION_IDS.has(entry.option), entry.option).toBe(true);
      const params = Object.fromEntries(Object.entries(entry.when ?? {}).map(([name, values]) => [name, values[0] as string]));
      const [choice] = faultsOf(fault(entry.option, params));
      if (choice === undefined) throw new Error(`The fault ${entry.option} has no choice.`);
      const hypothesis = STANDARD_CATALOG.hypotheses.find((each) => each.id === faultClass(choice));
      expect(hypothesis?.degree, entry.option).toContain(entry.degree);
      expect(faultVariant(choice, reach).degree).toBe(entry.degree);
    }
    const [mismatch] = faultsOf(fault("tls/mismatch"));
    if (mismatch === undefined) throw new Error("The fault tls/mismatch has no choice.");
    expect(faultVariant(mismatch, reach).degree).toBeUndefined();
  });
});
