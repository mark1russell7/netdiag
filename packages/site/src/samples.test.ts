import { LOOPBACK_CASES } from "@netdiag/lab";
import { readSamples } from "@netdiag/lab/samples";
import { describe, expect, it } from "vitest";
import samplesJson from "./samples.json";

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
