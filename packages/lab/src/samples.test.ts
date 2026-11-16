import { planCheck, reportOf } from "@mark1russell7/netdiag-cli";
import { describe, expect, it } from "vitest";
import { SAMPLES_FORMAT, readSamples, type CheckSamples } from "./samples.ts";

// The reader of the file of samples. The reports here come from a plan with no steps, so no test sends a packet.

const planned = planCheck({ target: "https://www.shop-lab.net:8443/" }, { resolvers: ["203.0.113.53"] });
if (planned.tag === "err") throw new Error(planned.error.join(" "));
const report = reportOf(planned.value, []);

const file: CheckSamples = {
  format: SAMPLES_FORMAT,
  commit: "0123abc",
  samples: [
    { id: "none", truth: "none", summary: "No fault.", report },
    { id: "port.closed", truth: "port.closed", summary: "The target port is closed.", report },
  ],
};
const copy = (change: Record<string, unknown>): unknown => ({ ...(JSON.parse(JSON.stringify(file)) as object), ...change });

describe("readSamples", () => {
  it("gives the same file after a round trip through JSON", () => {
    expect(readSamples(JSON.parse(JSON.stringify(file)))).toEqual({ tag: "ok", value: file });
  });

  it("refuses a file of another format, or with no list", () => {
    expect(readSamples(copy({ format: "netdiag-check/1" }))).toEqual({ tag: "err", error: [`The samples do not have the format "${SAMPLES_FORMAT}".`] });
    expect(readSamples(copy({ samples: {} }))).toEqual({ tag: "err", error: ["The samples have no commit or no list of samples."] });
  });

  it("gives the problems of each sample and of each report", () => {
    const [first] = file.samples;
    if (first === undefined) throw new Error("The file has no samples.");
    const samples = [first, first, { id: "x" }, { ...first, id: "bad", report: { ...first.report, scheme: "ftp" } }];
    expect(readSamples(copy({ samples }))).toEqual({
      tag: "err",
      error: ["The sample id none is not unique.", "The sample 3 has no id, no truth or no summary.", "The report of bad: The scheme of the report is not http or https."],
    });
  });
});
