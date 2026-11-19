import { NO_CALIBRATION, NONE, STANDARD_ACTIONS, type ActionRule } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { NO_FAULT } from "../grammar.ts";
import { classTerms } from "./cases.ts";
import { costStep, sweepNeedless } from "./policy.ts";
import type { SimOutcome } from "./report.ts";

const ruleOf = (cause: string): ActionRule => {
  const rule = STANDARD_ACTIONS.find((each) => each.cause === cause);
  if (rule === undefined) throw new Error(`STANDARD_ACTIONS has no rule for ${cause}.`);
  return rule;
};

// 80 healthy cases. Each diagnosis gives a failing resolver (action back-off) and no fault (action none).
const healthy = (resolver: number): SimOutcome[] =>
  classTerms(NO_FAULT, 1, 80).map((term, index) => ({
    seed: 1,
    case: { id: `none#${index + 1}`, truth: NO_FAULT, signs: [], term, medium: "wired", ipv6: false, history: "unknown", seed: `test:${index}` },
    predicted: "resolver.failing",
    visits: 1,
    truth: {
      rule: ruleOf(NONE),
      variants: [
        { rule: ruleOf("resolver.failing"), probability: resolver },
        { rule: ruleOf(NONE), probability: 1 - resolver },
      ],
    },
  }));

describe("the needless cost of the fit", () => {
  // Back-off is correct with 1.5 times the probability of no fault.
  const outcomes = healthy(0.6);

  it("gives a false action on each healthy case at the cost of a useless action, and none at a higher cost", () => {
    const at = (needless: number) => costStep(outcomes, { calibration: NO_CALIBRATION, costs: { none: 1, useless: 1, needless, harmful: 10 } }, [[1]]);
    expect(at(1).falseHigh).toBe(1);
    expect(at(2).falseHigh).toBeLessThan(0.05);
    expect(at(2).harmHigh).toBeLessThan(0.05);
  });

  it("stops the sweep at the first cost that keeps the false actions and the harm at the limit", () => {
    const steps = sweepNeedless(outcomes, NO_CALIBRATION, 10, [[1]]);
    expect(steps.map((step) => step.needless)).toEqual([1, 1.5]);
    expect(steps.map((step) => step.harmful)).toEqual([10, 10]);
    expect(steps[1]?.falseSets).toEqual([steps[1]?.falseHigh]);
  });

  it("raises the harmful cost to a needless cost over it", () => {
    // Back-off is correct with 9 times the probability of no fault. Only a needless cost over 9 gives none.
    const last = sweepNeedless(healthy(0.9), NO_CALIBRATION, 3, [[1]]).at(-1);
    expect(last?.needless).toBe(10);
    expect(last?.harmful).toBe(10);
    expect(last?.falseHigh).toBeLessThan(0.05);
  });
});
