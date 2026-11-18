import { featuresOf } from "@mark1russell7/netdiag";
import { GAIN_RESOLUTION, LOSS_DEGREES, MAX_JOINT_VALUES, NONE, UNKNOWN } from "@mark1russell7/netdiag/diagnosis";
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  FEATURE_NAMES,
  FOUND,
  PROBES,
  SCENARIOS,
  SCENARIO_CAUSES,
  TRUTHS,
  autoSearch,
  diagnoseBoard,
  explainCause,
  factorText,
  featureGroups,
  featureOf,
  hiddenTruth,
  observe,
  percent,
  runLab,
  search,
  searchDone,
  usualValue,
  worldDegree,
} from "./model.ts";

describe("the board", () => {
  it("names each feature of the catalog, in groups by layer", () => {
    expect(Object.keys(FEATURE_NAMES).sort()).toEqual([...CATALOG.features.keys()].sort());
    expect(featureGroups().flatMap((group) => group.features.map((feature) => feature.id)).sort()).toEqual([...CATALOG.features.keys()].sort());
  });

  it("gives the cause of each scenario", () => {
    expect(SCENARIOS).toHaveLength(SCENARIO_CAUSES.length);
    SCENARIOS.forEach((scenario, index) => {
      expect(diagnoseBoard(scenario.board).causes[0]?.id, scenario.label).toBe(SCENARIO_CAUSES[index]);
    });
  });

  it("observes each feature with its usual value when everything works", () => {
    const works = SCENARIOS[0]?.board.target ?? {};
    expect(Object.keys(works)).toHaveLength(CATALOG.features.size);
    expect(works["tcp.connect"]).toBe(usualValue(featureOf("tcp.connect")));
  });

  it("explains a fault against no fault, and no fault against the most probable fault", () => {
    const board = SCENARIOS[2]?.board ?? { target: {}, reference: {} };
    const diagnosis = diagnoseBoard(board);
    const fault = explainCause(board, diagnosis, "port.closed");
    expect(fault?.versus.id).toBe(NONE);
    expect(fault?.contributions[0]?.evidence.feature).toBe("tcp.connect");
    expect(fault?.contributions[0]?.weight).toBeGreaterThan(1);
    const none = explainCause(board, diagnosis, NONE);
    expect(none?.versus.id).toBe("port.closed");
  });

  it("writes a factor in plain words", () => {
    expect(factorText(Math.log10(25))).toBe("×25");
    expect(factorText(-Math.log10(2))).toBe("÷2.0");
    expect(factorText(3)).toBe("×1,000");
    expect(percent(0.004)).toBe("0.4%");
    expect(percent(0.678)).toBe("68%");
  });
});

describe("the probes", () => {
  it("observe the features that netdiag gives for their fact kinds", () => {
    for (const probe of PROBES) {
      expect(
        probe.observes.map((item) => item.feature),
        probe.id,
      ).toEqual(featuresOf(probe.kinds, { gateway: probe.gateway }));
    }
  });

  it("have few enough joint values for rankProbes", () => {
    for (const probe of PROBES) {
      const joint = probe.observes.reduce((count, item) => count * featureOf(item.feature).values.length, 1);
      expect(joint, probe.id).toBeLessThanOrEqual(MAX_JOINT_VALUES);
    }
  });

  it("draw the same world from the same seed", () => {
    expect(hiddenTruth("7")).toBe(hiddenTruth("7"));
    expect(TRUTHS).toContain(hiddenTruth("7"));
    expect(TRUTHS).not.toContain(UNKNOWN);
    const values = ["1", "2", "3"].map((seed) => observe("port.closed", seed, "tcp.connect", true));
    expect(["1", "2", "3"].map((seed) => observe("port.closed", seed, "tcp.connect", true))).toEqual(values);
  });

  it("draw one degree for each world of a fault with degrees, by its part of the prior", () => {
    const seeds = Array.from({ length: 200 }, (_, i) => String(i));
    const degrees = seeds.map((seed) => worldDegree("path.loss", seed));
    expect(seeds.map((seed) => worldDegree("path.loss", seed))).toEqual(degrees);
    const ids = new Set(LOSS_DEGREES.map((degree) => degree.id));
    for (const degree of degrees) expect(ids.has(degree ?? ""), degree).toBe(true);
    const large = new Set(LOSS_DEGREES.filter((degree) => degree.loss >= 0.5).map((degree) => degree.id));
    const heavy = degrees.filter((degree) => large.has(degree ?? "")).length;
    // The degrees with a loss of 0.5 or more have 1 part of 4. With 200 worlds, their count is from 30 to 70 in more than 99 of 100 draws.
    expect(heavy).toBeGreaterThanOrEqual(30);
    expect(heavy).toBeLessThanOrEqual(70);
    expect(worldDegree("port.closed", "1")).toBeUndefined();
  });

  it("rank the probes from the largest gain", () => {
    const state = search(NONE, "1", []);
    const gains = state.ranked.map((choice) => choice.gain);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
    expect(state.ranked).toHaveLength(PROBES.length);
  });

  it("end the search of each truth, and name the truth first for most truths", () => {
    let first = 0;
    for (const truth of TRUTHS) {
      const runs = autoSearch(truth, "1", []);
      const state = search(truth, "1", runs);
      expect(searchDone(state), truth).toBe(true);
      expect(new Set(runs).size, truth).toBe(runs.length);
      const top = state.diagnosis.causes[0];
      // A search ends before FOUND only when no probe of the demo adds information.
      if ((top?.probability ?? 0) < FOUND) expect(state.ranked[0]?.gain ?? 0, truth).toBeLessThanOrEqual(GAIN_RESOLUTION);
      if (top?.id === truth) first++;
    }
    expect(first).toBeGreaterThan(TRUTHS.length / 2);
  });

  it("observe nothing new when a probe runs again", () => {
    const state = search("host.down", "1", ["tcp", "tcp"]);
    expect(state.steps[1]?.observed).toEqual([]);
  });
});

describe("the lab", () => {
  it("makes the runs of each truth, and holds each recall with the bar", () => {
    const lab = runLab({ runs: 5, seed: "1", probes: PROBES.map((probe) => probe.id), bar: 0.5 });
    expect(lab.records).toHaveLength(TRUTHS.length * 5);
    expect(lab.score.n).toBe(TRUTHS.length * 5);
    expect(lab.gate.verdicts.map((verdict) => verdict.hypothesis)).toEqual(TRUTHS);
    expect(lab.gate.unbarred).toEqual([UNKNOWN]);
  });

  it("names only no fault when no probe observes the network", () => {
    const lab = runLab({ runs: 3, seed: "1", probes: [], bar: 0 });
    expect(lab.records.every((record) => record.predicted === NONE)).toBe(true);
    expect(lab.gate.pass).toBe(true);
    expect(lab.mistakes.get("port.closed")).toEqual({ id: NONE, count: 3 });
  });
});
