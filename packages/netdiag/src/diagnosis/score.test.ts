import { wilson } from "@mark1russell7/rigor-statistics";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LAB_RECORD_FORMAT, STANDARD_CATALOG, diagnose, labGate, labRecordOf, scoreLab, type LabRecord, type LabScore } from "./index.ts";

const catalog = STANDARD_CATALOG;
const ids = catalog.hypotheses.map((hypothesis) => hypothesis.id);

/** A correct record gives the truth a probability of 1. A wrong record gives 0.6 to the prediction and 0.4 to the truth. */
function record(truth: string, predicted: string = truth, caseId: string = truth): LabRecord {
  const causes = predicted === truth ? [{ id: truth, probability: 1 }] : [{ id: predicted, probability: 0.6 }, { id: truth, probability: 0.4 }];
  return { format: LAB_RECORD_FORMAT, case: caseId, catalog: catalog.version, truth, predicted, rank: predicted === truth ? 1 : 2, causes };
}

function scored(records: readonly LabRecord[]): LabScore {
  const score = scoreLab(catalog, records);
  if (score.tag === "err") throw new Error(score.error.join(" "));
  return score.value;
}

const RECORDS = [
  record("port.closed"),
  record("port.closed"),
  record("port.closed"),
  record("port.closed", "host.down"),
  record("none"),
  record("none"),
];

describe("labRecordOf", () => {
  it("records the predicted cause, the rank of the truth and each probability", () => {
    const diagnosis = diagnose(catalog, [{ feature: "tcp.connect", value: "refused", primary: true }]);
    const result = labRecordOf(catalog, "port.closed/refused", "port.closed", diagnosis);
    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;
    expect(result.value).toMatchObject({ format: LAB_RECORD_FORMAT, case: "port.closed/refused", catalog: catalog.version, truth: "port.closed", predicted: "port.closed", rank: 1 });
    expect(result.value.causes.map((cause) => cause.id).sort()).toEqual([...ids].sort());
    expect(result.value.causes.reduce((total, cause) => total + cause.probability, 0)).toBeCloseTo(1);
  });

  it("gives the rank of a truth that is not the first cause", () => {
    const diagnosis = diagnose(catalog, [{ feature: "tcp.connect", value: "refused", primary: true }]);
    const result = labRecordOf(catalog, "lab", "server.slow", diagnosis);
    expect(result.tag === "ok" && result.value.rank).toBeGreaterThan(1);
  });

  it("refuses a truth that is not a hypothesis, and a diagnosis with no cause", () => {
    const diagnosis = diagnose(catalog, []);
    expect(labRecordOf(catalog, "lab", "dns.slow", diagnosis)).toMatchObject({ tag: "err" });
    expect(labRecordOf(catalog, "lab", "none", { causes: [], used: [], ignored: [] })).toMatchObject({ tag: "err" });
  });
});

describe("scoreLab", () => {
  it("gives the confusion table, the recall of each hypothesis and the accuracy", () => {
    const score = scored(RECORDS);
    expect(score.table.labels).toEqual(ids);
    expect(score).toMatchObject({ catalog: catalog.version, n: 6, correct: 5 });
    expect(score.accuracy).toEqual(wilson(5, 6));
    const closed = score.classes.find((scores) => scores.label === "port.closed");
    expect(closed).toMatchObject({ support: 4, hits: 3, recall: 0.75, precision: 1 });
    expect(score.classes.find((scores) => scores.label === "host.down")).toMatchObject({ support: 0, predicted: 1, precision: 0 });
    expect(score.classes.find((scores) => scores.label === "tls.proxy")).toMatchObject({ support: 0, predicted: 0, recall: undefined });
  });

  it("gives the mean Brier score over each hypothesis", () => {
    // Only the wrong record adds: 0.6 squared and 0.6 squared, so 0.72 over 6 records.
    expect(scored(RECORDS).brier).toBeCloseTo(0.12);
    expect(scored([]).brier).toBeUndefined();
  });

  it("refuses a record of a different catalog, an unknown hypothesis and a wrong format", () => {
    const old = { ...record("none"), catalog: "0" };
    const strange = record("none", "dns.slow");
    const format = { ...record("none"), format: "netdiag.lab-record/0" } as unknown as LabRecord;
    const result = scoreLab(catalog, [old, strange, format]);
    expect(result.tag).toBe("err");
    if (result.tag !== "err") return;
    expect(result.error).toHaveLength(3);
    expect(result.error.join(" ")).toContain("dns.slow");
  });

  it("keeps the sums of the table, and a Brier score from 0 to 2", () => {
    const hypothesis = fc.constantFrom(...ids);
    fc.assert(
      fc.property(fc.array(fc.tuple(hypothesis, hypothesis), { maxLength: 40 }), (pairs) => {
        const score = scored(pairs.map(([truth, predicted]) => record(truth, predicted)));
        expect(score.classes.reduce((total, scores) => total + scores.support, 0)).toBe(pairs.length);
        expect(score.classes.reduce((total, scores) => total + scores.hits, 0)).toBe(score.correct);
        if (score.brier !== undefined) expect(score.brier).toBeGreaterThanOrEqual(0);
        if (score.brier !== undefined) expect(score.brier).toBeLessThanOrEqual(2);
      }),
      { seed: 20261115, numRuns: 200 },
    );
  });
});

describe("labGate", () => {
  it("passes, fails or gives no read for each bar, and lists the hypotheses with no bar", () => {
    const score = scored(RECORDS);
    const result = labGate(score, { "port.closed": 0.25, none: 0.5, "tls.proxy": 0.5 });
    expect(result.tag).toBe("ok");
    if (result.tag !== "ok") return;
    expect(result.value.verdicts).toEqual([
      { hypothesis: "none", status: "fail", bar: 0.5, low: wilson(2, 2).low, support: 2 },
      { hypothesis: "port.closed", status: "pass", bar: 0.25, low: wilson(3, 4).low, support: 4 },
      { hypothesis: "tls.proxy", status: "no-read", bar: 0.5, low: undefined, support: 0 },
    ]);
    expect(result.value.pass).toBe(false);
    expect(result.value.unbarred).toHaveLength(ids.length - 3);
  });

  it("passes only when each bar passes, and does not pass with no bar", () => {
    const score = scored(RECORDS);
    expect(labGate(score, { "port.closed": 0.25, none: 0.3 })).toMatchObject({ tag: "ok", value: { pass: true } });
    expect(labGate(score, {})).toMatchObject({ tag: "ok", value: { pass: false, verdicts: [] } });
  });

  it("refuses a bar of a hypothesis that is not in the catalog, and a bar outside 0 to 1", () => {
    const result = labGate(scored(RECORDS), { "dns.slow": 0.5, none: 1.5 });
    expect(result.tag === "err" && result.error).toHaveLength(2);
  });
});
