import { describe, expect, it } from "vitest";
import {
  ACTION_KINDS,
  NO_CALIBRATION,
  NONE,
  STANDARD_ACTIONS,
  STANDARD_CATALOG,
  STANDARD_CATALOG_SPEC,
  STANDARD_POLICY,
  UNKNOWN,
  actionCost,
  checkActions,
  checkPolicy,
  chooseAction,
  compileCatalog,
  diagnose,
  harmOf,
  harmfulOf,
  ruleOf,
  type ActionPolicy,
  type ActionRule,
  type Catalog,
  type Cause,
  type Diagnosis,
  type Evidence,
} from "./index.ts";

const catalog = STANDARD_CATALOG;

/** A diagnosis with the given probability of each variant. A variant is a cause, a reach and a degree. */
function diagnosisOf(variants: readonly { cause: string; reach?: "shared" | "upstream" | "target"; degree?: string; probability: number }[]): Diagnosis {
  const causes: Cause[] = catalog.hypotheses.map((h) => {
    const own = variants.filter((variant) => variant.cause === h.id);
    const probability = own.reduce((sum, variant) => sum + variant.probability, 0);
    if (h.reach === undefined || h.reach.length === 0) return { ...h, probability };
    const reaches = h.reach;
    const degrees: readonly (string | undefined)[] = h.degree ?? [undefined];
    // each variant of the cause, with the probability of the given variants that match it
    const shares = degrees.flatMap((degree) =>
      reaches.map((reach) => {
        const p = own.filter((v) => (v.reach ?? reaches[0]) === reach && (v.degree ?? degrees[0]) === degree).reduce((sum, v) => sum + v.probability, 0);
        return { reach, ...(degree !== undefined ? { degree } : {}), probability: p };
      }),
    );
    return { ...h, probability, reaches: reaches.map((reach) => ({ reach, probability: shares.filter((s) => s.reach === reach).reduce((sum, s) => sum + s.probability, 0) })), variants: shares };
  });
  return { causes, used: [], ignored: [] };
}

describe("STANDARD_ACTIONS", () => {
  it("has exactly one rule for each variant of each cause of the standard catalog", () => {
    expect(checkActions(catalog, STANDARD_ACTIONS)).toEqual([]);
  });

  it("gives each rule a reason", () => {
    for (const rule of STANDARD_ACTIONS) expect(rule.why.length).toBeGreaterThan(10);
  });

  it("gives the actions of the plan", () => {
    const kind = (cause: string, reach?: "shared" | "upstream" | "target", degree?: string) => ruleOf(STANDARD_ACTIONS, cause, reach, degree).action.kind;
    expect(kind(NONE)).toBe("none");
    expect(kind(UNKNOWN)).toBe("none");
    expect(kind("interface.down", "shared", "no-carrier")).toBe("wait-network");
    expect(kind("name.missing", "target")).toBe("stop");
    expect(kind("ipv6.broken", "target")).toBe("change-path");
    expect(kind("server.slow", "target")).toBe("back-off");
    expect(kind("server.error", "target")).toBe("change-copy");
    expect(kind("path.loss", "upstream", "loss-5")).toBe("retry");
    expect(kind("path.loss", "upstream", "loss-90")).toBe("wait-network");
    expect(kind("path.loss", "target", "loss-90")).toBe("change-copy");
  });
});

describe("checkActions", () => {
  const base = STANDARD_ACTIONS.filter((rule) => rule.cause !== "server.slow");

  it("finds a variant with no rule", () => {
    expect(checkActions(catalog, base)).toEqual(["The variant server.slow target has 0 action rules. It must have one."]);
  });

  it("finds a variant with two rules", () => {
    const twice: ActionRule = { cause: "port.closed", action: { kind: "retry" }, why: "twice" };
    expect(checkActions(catalog, [...STANDARD_ACTIONS, twice])).toEqual(["The variant port.closed target has 2 action rules. It must have one."]);
  });

  it("finds a cause, a reach or a degree that the catalog does not have", () => {
    const wrong: ActionRule[] = [
      { cause: "no.such", action: { kind: "none" }, why: "-" },
      { cause: "server.slow", reaches: ["shared"], action: { kind: "none" }, why: "-" },
      { cause: "server.slow", degrees: ["heavy"], action: { kind: "none" }, why: "-" },
    ];
    expect(checkActions(catalog, [...base, { cause: "server.slow", action: { kind: "none" }, why: "-" }, ...wrong])).toEqual([
      "A rule names no.such, which the catalog does not have.",
      "A rule of server.slow names the reach shared, which the cause does not have.",
      "A rule of server.slow names the degree heavy, which the cause does not have.",
    ]);
  });

  it("finds a time that is not a whole number of milliseconds of 1 or more", () => {
    const rules = [...base, { cause: "server.slow", action: { kind: "back-off", leastMs: 0.5 }, why: "-" } satisfies ActionRule];
    expect(checkActions(catalog, rules)).toEqual(["The action of a rule of server.slow has the time 0.5. It must be a whole number of milliseconds of 1 or more."]);
  });
});

describe("ruleOf", () => {
  it("throws for a variant with no rule or with two rules", () => {
    expect(() => ruleOf([], "server.slow", "target")).toThrow("The variant server.slow target has no action rule.");
    const rule: ActionRule = { cause: "server.slow", action: { kind: "none" }, why: "-" };
    expect(() => ruleOf([rule, rule], "server.slow", "target")).toThrow("has 2 action rules");
  });
});

describe("harmOf", () => {
  const harm = (cause: string, reach?: "shared" | "upstream" | "target", degree?: string) => harmfulOf(catalog, ruleOf(STANDARD_ACTIONS, cause, reach, degree));

  it("finds a stop harmful unless the fault stays, and a wait harmful unless the fault stops each loop", () => {
    for (const rule of STANDARD_ACTIONS) {
      const harmful = harmfulOf(catalog, rule);
      expect(harmful.includes("stop")).toBe(rule.action.kind !== "stop");
      expect(harmful.includes("wait-network")).toBe(rule.action.kind !== "stop" && rule.action.kind !== "wait-network");
      expect(harmful).not.toContain("none");
      expect(harmful).not.toContain(rule.action.kind);
    }
  });

  it("finds a change-copy harmful only when the copy is healthy", () => {
    expect(harm(NONE)).toContain("change-copy");
    expect(harm("gateway.down", "shared", "silent")).toContain("change-copy");
    expect(harm("path.loss", "upstream", "loss-50")).toContain("change-copy");
    expect(harm("filter.icmp", "target")).toContain("change-copy");
    expect(harm("name.missing", "target")).not.toContain("change-copy");
    expect(harm("server.slow", "target")).toEqual(["retry", "change-copy", "wait-network", "stop"].filter((kind) => kind !== "change-copy"));
  });

  it("finds a retry harmful only for a target with too much load", () => {
    expect(STANDARD_ACTIONS.filter((rule) => harmfulOf(catalog, rule).includes("retry")).map((rule) => rule.cause)).toEqual(["server.slow"]);
  });

  it("gives the harm of a proxy error to each copy, because each copy goes through the proxy", () => {
    const rule = ruleOf(STANDARD_ACTIONS, "proxy.error", "target");
    expect(rule.action).toEqual({ kind: "back-off", leastMs: 5000 });
    expect(harmfulOf(catalog, rule)).toEqual(["change-copy", "wait-network", "stop"]);
  });

  it("takes the list of a rule when it has one, and otherwise the kinds of harmOf", () => {
    for (const rule of STANDARD_ACTIONS.filter((each) => each.harmful === undefined)) {
      expect(harmfulOf(catalog, rule)).toEqual(harmOf(catalog, rule));
      expect(harmfulOf(catalog, rule)).toBe(harmfulOf(catalog, rule));
    }
    const own: ActionRule = { cause: "name.missing", action: { kind: "none" }, harmful: ["stop"], why: "A test rule." };
    expect(harmfulOf(catalog, own)).toEqual(["stop"]);
    expect(harmOf(catalog, own)).toContain("wait-network");
  });

  it("prefers the IPv4 path when IPv6 does not operate", () => {
    expect(ruleOf(STANDARD_ACTIONS, "ipv6.broken", "target").action).toEqual({ kind: "change-path", prefer: "ipv4" });
  });
});

/** A policy with no calibration map and a harmful cost of 10. The tests of the choice use it, so a new fit does not change them. */
const policy: ActionPolicy = { calibration: NO_CALIBRATION, costs: { none: 1, useless: 1, needless: 1, harmful: 10 } };

describe("actionCost and checkPolicy", () => {
  it("gives 0 for the correct kind, the unit for none, the harmful cost for a harmful kind, and the needless cost for an action on no fault", () => {
    const rule = ruleOf(STANDARD_ACTIONS, "name.missing", "target");
    expect(actionCost(catalog, rule, "stop", policy.costs)).toBe(0);
    expect(actionCost(catalog, rule, "none", policy.costs)).toBe(1);
    expect(actionCost(catalog, rule, "retry", policy.costs)).toBe(1);
    expect(actionCost(catalog, ruleOf(STANDARD_ACTIONS, NONE), "stop", policy.costs)).toBe(10);
    expect(actionCost(catalog, ruleOf(STANDARD_ACTIONS, NONE), "none", policy.costs)).toBe(0);
    const costs = { ...policy.costs, needless: 3 };
    expect(actionCost(catalog, ruleOf(STANDARD_ACTIONS, NONE), "back-off", costs)).toBe(3);
    expect(actionCost(catalog, ruleOf(STANDARD_ACTIONS, NONE), "stop", costs)).toBe(10);
    expect(actionCost(catalog, rule, "retry", costs)).toBe(1);
  });

  it("finds the standard policy correct and a bad policy not correct", () => {
    expect(checkPolicy(STANDARD_POLICY)).toEqual([]);
    expect(checkPolicy({ calibration: { cause: 0, variant: 1 }, costs: policy.costs })).toHaveLength(1);
    expect(checkPolicy({ calibration: NO_CALIBRATION, costs: { none: 1, useless: 0.5, needless: 1, harmful: 10 } })).toHaveLength(1);
    expect(checkPolicy({ calibration: NO_CALIBRATION, costs: { none: 1, useless: 1, needless: 1, harmful: 1 } })).toHaveLength(1);
    expect(checkPolicy({ calibration: NO_CALIBRATION, costs: { ...policy.costs, needless: 0.5 } })).toHaveLength(1);
    expect(checkPolicy({ calibration: NO_CALIBRATION, costs: { ...policy.costs, needless: 20 } })).toHaveLength(1);
    expect(checkPolicy({ calibration: { cause: Number.NaN, variant: -1 }, costs: { none: 0, useless: 1, needless: 1, harmful: Number.POSITIVE_INFINITY } })).toHaveLength(4);
  });
});

describe("chooseAction", () => {
  it("takes the kind with the least expected cost", () => {
    const choice = chooseAction(catalog, diagnosisOf([{ cause: "name.missing", probability: 0.95 }, { cause: NONE, probability: 0.05 }]), STANDARD_ACTIONS, policy);
    expect(choice.action).toEqual({ kind: "stop", forMs: 300_000 });
    expect(choice.confidence).toBeCloseTo(0.95);
    expect(choice.cost).toBeCloseTo(0.5);
    expect(chooseAction(catalog, diagnosisOf([{ cause: "tls.mismatch", probability: 1 }]), STANDARD_ACTIONS, policy).action).toEqual({ kind: "stop", forMs: null });
  });

  it("gives none when a harmful kind is not certain enough", () => {
    const choice = chooseAction(catalog, diagnosisOf([{ cause: "name.missing", probability: 0.85 }, { cause: NONE, probability: 0.15 }]), STANDARD_ACTIONS, policy);
    expect(choice.action).toEqual({ kind: "none" });
    expect(choice.confidence).toBeCloseTo(0.15);
    expect(choice.kinds.map((share) => [share.kind, Number(share.cost.toFixed(2))])).toEqual([
      ["none", 0.85],
      ["stop", 1.5],
    ]);
  });

  it("asks for more certainty for an action on a healthy target when a needless action costs more", () => {
    const diagnosis = diagnosisOf([{ cause: "resolver.failing", probability: 0.6 }, { cause: NONE, probability: 0.4 }]);
    expect(chooseAction(catalog, diagnosis, STANDARD_ACTIONS, policy).action.kind).toBe("back-off");
    expect(chooseAction(catalog, diagnosis, STANDARD_ACTIONS, { ...policy, costs: { ...policy.costs, needless: 2 } }).action.kind).toBe("none");
  });

  it("asks for more certainty when a harmful action costs more", () => {
    const diagnosis = diagnosisOf([{ cause: "name.missing", probability: 0.93 }, { cause: NONE, probability: 0.07 }]);
    expect(chooseAction(catalog, diagnosis, STANDARD_ACTIONS, policy).action.kind).toBe("stop");
    expect(chooseAction(catalog, diagnosis, STANDARD_ACTIONS, { ...policy, costs: { ...policy.costs, harmful: 20 } }).action.kind).toBe("none");
  });

  it("makes an overconfident cause less certain with a cause temperature over 1", () => {
    const diagnosis = diagnosisOf([{ cause: "name.missing", probability: 0.97 }, { cause: NONE, probability: 0.03 }]);
    expect(chooseAction(catalog, diagnosis, STANDARD_ACTIONS, policy).action.kind).toBe("stop");
    const warm = chooseAction(catalog, diagnosis, STANDARD_ACTIONS, { ...policy, calibration: { cause: 3, variant: 1 } });
    expect(warm.action.kind).toBe("none");
    expect(warm.kinds.find((share) => share.kind === "stop")?.probability).toBeCloseTo(0.761, 3);
  });

  it("makes an overconfident degree less certain with a variant temperature over 1, and keeps the probability of the cause", () => {
    const diagnosis = diagnosisOf([
      { cause: "wifi.weak", reach: "shared", degree: "loss-70", probability: 0.72 },
      { cause: "wifi.weak", reach: "shared", degree: "loss-50", probability: 0.08 },
      { cause: NONE, probability: 0.2 },
    ]);
    const share = (choice: ReturnType<typeof chooseAction>, kind: string): number => choice.kinds.find((each) => each.kind === kind)?.probability ?? 0;
    const cold = chooseAction(catalog, diagnosis, STANDARD_ACTIONS, policy);
    const warm = chooseAction(catalog, diagnosis, STANDARD_ACTIONS, { ...policy, calibration: { cause: 1, variant: 3 } });
    expect(share(cold, "wait-network")).toBeCloseTo(0.72);
    // The shares 0.9 and 0.1 of the cause become 0.675 and 0.325. The cause keeps its 0.8.
    expect(share(warm, "wait-network")).toBeCloseTo(0.8 * 0.675, 3);
    expect(share(warm, "back-off")).toBeCloseTo(0.8 * 0.325, 3);
    expect(share(warm, "none")).toBeCloseTo(0.2);
  });

  it("takes a kind that is not harmful when it is more probable than none", () => {
    const choice = chooseAction(
      catalog,
      diagnosisOf([
        { cause: "server.slow", probability: 0.4 },
        { cause: "path.loss", reach: "shared", degree: "loss-30", probability: 0.3 },
        { cause: NONE, probability: 0.3 },
      ]),
      STANDARD_ACTIONS,
      policy,
    );
    // The values of the action come from the most probable variant of the kind: server.slow, not path.loss.
    expect(choice.action).toEqual({ kind: "back-off", leastMs: 2000 });
    expect(choice.confidence).toBeCloseTo(0.7);
  });

  it("adds the variants of different causes with the same kind", () => {
    const choice = chooseAction(
      catalog,
      diagnosisOf([
        { cause: "port.closed", probability: 0.5 },
        { cause: "host.down", degree: "silent", probability: 0.45 },
        { cause: NONE, probability: 0.05 },
      ]),
      STANDARD_ACTIONS,
      policy,
    );
    expect(choice.action).toEqual({ kind: "change-copy" });
    expect(choice.confidence).toBeCloseTo(0.95);
  });

  it("has only none as a candidate for a diagnosis of no fault", () => {
    const choice = chooseAction(catalog, diagnosisOf([{ cause: NONE, probability: 1 }]), STANDARD_ACTIONS, policy);
    expect(choice).toEqual({ action: { kind: "none" }, confidence: 1, cost: 0, kinds: [{ kind: "none", probability: 1, cost: 0 }] });
  });

  it("chooses an action for a real diagnosis of the standard catalog with the standard policy", () => {
    const diagnosis = diagnose(catalog, [
      { feature: "dns.rcode", value: "nxdomain", primary: true },
      { feature: "dns.rcode", value: "noerror", primary: false },
    ]);
    const choice = chooseAction(catalog, diagnosis, STANDARD_ACTIONS);
    expect(choice.kinds.reduce((sum, share) => sum + share.probability, 0)).toBeCloseTo(1);
    expect(ACTION_KINDS).toContain(choice.action.kind);
    expect(choice.kinds[0]?.kind).toBe(choice.action.kind);
  });
});

describe("the repeats of a private certificate by design", () => {
  // A target with a private root by design gives tls.trust=private over IPv4 and over IPv6. The two observations are one fact.
  const compiled = compileCatalog({ ...STANDARD_CATALOG_SPEC, features: STANDARD_CATALOG_SPEC.features.map((feature) => ({ ...feature, concentration: undefined })) });
  if (compiled.tag === "err") throw new Error(compiled.error.join(" "));
  const independent = compiled.value;
  const healthy: Evidence[] = [...STANDARD_CATALOG.features.values()].flatMap((feature) => {
    const value = Object.entries(feature.healthy).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (value === undefined || feature.id === "tls.trust") return [];
    return [true, false].map((primary) => ({ feature: feature.id, value, primary }));
  });
  const evidence = (privates: number): Evidence[] => [
    ...healthy,
    { feature: "tls.trust", value: "public", primary: false },
    ...Array.from({ length: privates }, () => ({ feature: "tls.trust", value: "private", primary: true })),
  ];
  // The two causes of a proxy share the observation, so the odds of a proxy are the odds of the two causes together.
  const proxyOdds = (model: Catalog, privates: number): number => {
    const p = diagnose(model, evidence(privates))
      .causes.filter((cause) => cause.id === "tls.proxy" || cause.id === "proxy.error")
      .reduce((sum, cause) => sum + cause.probability, 0);
    return p / (1 - p);
  };

  it("do not reach the confidence of a proxy through the repeat alone", () => {
    expect(STANDARD_CATALOG.features.get("tls.trust")?.concentration).toBeDefined();
    expect(proxyOdds(STANDARD_CATALOG, 2) / proxyOdds(STANDARD_CATALOG, 1)).toBeLessThan(2);
    const one = chooseAction(STANDARD_CATALOG, diagnose(STANDARD_CATALOG, evidence(1)), STANDARD_ACTIONS);
    const two = chooseAction(STANDARD_CATALOG, diagnose(STANDARD_CATALOG, evidence(2)), STANDARD_ACTIONS);
    expect(two.action).toEqual(one.action);
  });

  it("reach it with independent repeats, the old count", () => {
    expect(proxyOdds(independent, 2) / proxyOdds(independent, 1)).toBeGreaterThan(10);
  });
});
