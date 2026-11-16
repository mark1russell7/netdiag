import { LOOPBACK_CASES } from "@netdiag/lab";
import { readSamples } from "@netdiag/lab/samples";
import { WHERE_CASES } from "@netdiag/lab/where";
import { describe, expect, it } from "vitest";
import { pathsOf } from "./report-views.ts";
import samplesJson from "./samples.json";
import whereSamplesJson from "./where-samples.json";

// The gate of the samples that the site shows: the lab job writes `samples.json`, and a pull request commits it. Each
// loopback case has one sample, with the truth of the case, and each report passes `readCheckReport`.

describe("the samples of the site", () => {
  const read = readSamples(samplesJson);

  it("pass readSamples", () => {
    expect(read.tag === "err" ? read.error : []).toEqual([]);
  });

  it("have one sample for each loopback case, with the truth of the case", () => {
    const samples = read.tag === "ok" ? read.value.samples : [];
    expect(samples.map((sample) => [sample.id, sample.truth])).toEqual(LOOPBACK_CASES.map((labCase) => [labCase.id, labCase.truth]));
  });

  it("name the commit of the run that made them", () => {
    expect(read.tag === "ok" ? read.value.commit : "").toMatch(/^[0-9a-f]{40}$/);
  });
});

// The where job of the kernel lab writes `samples.json` too, and a pull request commits it as `where-samples.json`.
describe("the where samples of the site", () => {
  const read = readSamples(whereSamplesJson);

  it("pass readSamples", () => {
    expect(read.tag === "err" ? read.error : []).toEqual([]);
  });

  it("have one sample for each where case, with the truth of the case", () => {
    const samples = read.tag === "ok" ? read.value.samples : [];
    expect(samples.map((sample) => [sample.id, sample.truth])).toEqual(WHERE_CASES.map((labCase) => [labCase.id, labCase.truth]));
  });

  it("name the commit of the run that made them", () => {
    expect(read.tag === "ok" ? read.value.commit : "").toMatch(/^[0-9a-f]{40}$/);
  });

  it("show the start of the loss that each case expects: its hops, and the hop before them", () => {
    const samples = read.tag === "ok" ? read.value.samples : [];
    for (const labCase of WHERE_CASES) {
      const sample = samples.find((each) => each.id === labCase.id);
      const places = sample === undefined ? [] : pathsOf(sample.report).flatMap((view) => view.hops.map((hop) => hop.place));
      const count = (place: string): number => places.filter((each) => each === place).length;
      expect([count("start"), count("bound")], labCase.id).toEqual([labCase.expect?.hops.length ?? 0, labCase.expect?.after ? 1 : 0]);
      expect(places.length, labCase.id).toBeGreaterThan(0);
    }
  });
});
