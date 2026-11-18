import { wilson } from "@mark1russell7/rigor-statistics";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LAB_RECORD_FORMAT, STANDARD_CATALOG, ALIKE_EPSILON, alikeBand, alikeCauses, alikeMargin, bandProblems, diagnose, labBars, labGate, labRecordOf, scoreLab, scoredCause, type AlikeMargin, type LabRecalls, type LabRecord, type LabScore } from "./index.ts";

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

  it("gives the record the alike causes of the truth, and no field when the truth has none", () => {
    // The record keeps the result of alikeCauses for its truth. A wide bound makes each cause alike.
    const diagnosis = diagnose(catalog, [{ feature: "tcp.connect", value: "refused", primary: true }]);
    const alike = alikeCauses(catalog, diagnosis, "port.closed");
    const result = labRecordOf(catalog, "port.closed/refused", "port.closed", diagnosis);
    expect(result.tag === "ok" && (result.value.alike ?? [])).toEqual(alike);
    expect(result.tag === "ok" && "alike" in result.value).toBe(alike.length > 0);
    const wide = labRecordOf(catalog, "lab", "port.closed", diagnosis, 100);
    expect(wide.tag === "ok" && wide.value.alike?.length).toBe(ids.length - 1);
  });

  it("gives the record the distances around the truth", () => {
    const diagnosis = diagnose(catalog, [{ feature: "tcp.connect", value: "refused", primary: true }]);
    const result = labRecordOf(catalog, "port.closed/refused", "port.closed", diagnosis);
    expect(result.tag === "ok" && result.value.margin).toEqual(alikeMargin(catalog, diagnosis, "port.closed"));
  });

  it("refuses a truth that is not a hypothesis, and a diagnosis with no cause", () => {
    const diagnosis = diagnose(catalog, []);
    expect(labRecordOf(catalog, "lab", "dns.slow", diagnosis)).toMatchObject({ tag: "err" });
    expect(labRecordOf(catalog, "lab", "none", { causes: [], used: [], ignored: [] })).toMatchObject({ tag: "err" });
  });
});

describe("alikeBand and bandProblems", () => {
  const withMargin = (caseId: string, margin: AlikeMargin): LabRecord => ({ ...record("port.closed", "port.closed", caseId), margin });

  it("gives the largest inner distance and the smallest outer distance of the records, with their cases", () => {
    const band = alikeBand([
      withMargin("a", { inner: 0, outer: 0.5, nearest: "host.down" }),
      withMargin("b", { inner: 1e-9, outer: 0.02, nearest: "none" }),
      withMargin("c", { inner: 0 }),
      record("none", "none", "d"),
    ]);
    expect(band).toEqual({ inner: 1e-9, innerCase: "b", outer: 0.02, outerCase: "b", nearest: "none" });
    expect(alikeBand([])).toEqual({ inner: 0 });
    expect(bandProblems(band)).toEqual([]);
  });

  it("gives a problem for an alike cause above epsilon / margin, and for another cause below epsilon * margin", () => {
    const inner = alikeBand([withMargin("a", { inner: ALIKE_EPSILON / 10, outer: 1, nearest: "none" })]);
    expect(bandProblems(inner)).toHaveLength(1);
    expect(bandProblems(inner)[0]).toContain("a");
    const outer = alikeBand([withMargin("b", { inner: 0, outer: ALIKE_EPSILON * 10, nearest: "host.down" })]);
    expect(bandProblems(outer)).toHaveLength(1);
    expect(bandProblems(outer)[0]).toContain("host.down");
    expect(bandProblems(outer, ALIKE_EPSILON, 5)).toEqual([]);
  });

  it("is a field of the score", () => {
    const records = [withMargin("a", { inner: 0, outer: 0.3, nearest: "none" }), ...RECORDS];
    expect(scored(records).band).toEqual(alikeBand(records));
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

  it("counts a record with alike causes as a hit only when the truth and the alike causes are the first causes", () => {
    const pair = (causes: readonly string[]): LabRecord => ({
      ...record("filter.drop", causes[0]),
      causes: causes.map((id, i) => ({ id, probability: [0.48, 0.47, 0.05][i] ?? 0 })),
      rank: causes.indexOf("filter.drop") + 1,
      alike: ["host.down"],
    });
    const tie = pair(["host.down", "filter.drop", "filter.icmp"]);
    const first = pair(["filter.drop", "host.down", "filter.icmp"]);
    const apart = pair(["filter.drop", "filter.icmp", "host.down"]);
    expect([tie, first, apart].map(scoredCause)).toEqual(["filter.drop", "filter.drop", "filter.icmp"]);
    expect(scoredCause(record("none", "host.down"))).toBe("host.down");
    const score = scored([tie, first, apart]);
    expect(score.correct).toBe(2);
    expect(score.classes.find((scores) => scores.label === "host.down")?.predicted).toBe(0);
  });

  it("counts the predicted cause when the truth is alike to each cause, because the probes told no cause apart", () => {
    // With no evidence, the diagnosis reads no feature, so each cause is alike to the truth.
    const diagnosis = diagnose(catalog, []);
    const result = labRecordOf(catalog, "lab", "port.closed", diagnosis);
    if (result.tag !== "ok") throw new Error(result.error.join(" "));
    expect(result.value.alike?.length).toBe(ids.length - 1);
    expect(scoredCause(result.value)).toBe(result.value.predicted);
    expect(scoredCause(result.value)).not.toBe("port.closed");
    expect(scored([result.value]).correct).toBe(0);
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

/** The records of one run: `hits` of `support` right for each hypothesis. A miss names `none`, or `port.closed` for `none`. */
function run(counts: Readonly<Record<string, readonly [hits: number, support: number]>>): LabScore {
  return scored(
    Object.entries(counts).flatMap(([truth, [hits, support]]) =>
      Array.from({ length: support }, (_, i) => record(truth, i < hits ? truth : truth === "none" ? "port.closed" : "none", `${truth}/${i}`)),
    ),
  );
}

/** The bar from the lower ends of the runs, with the sample standard deviation from its formula. */
function expectedBar(lows: readonly number[], k = 2): number {
  const mean = lows.reduce((a, b) => a + b, 0) / lows.length;
  const sd = Math.sqrt(lows.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (lows.length - 1));
  return Math.max(0, Math.floor((Math.min(...lows) - k * sd) * 1000 + 1e-9) / 1000);
}

describe("labBars", () => {
  it("gives the least lower end of the runs when the runs agree, and no bar to a hypothesis with no read", () => {
    const runs = Array.from({ length: 5 }, () => run({ none: [2, 2], "port.closed": [3, 4] }));
    const result = labBars(runs);
    expect(result).toEqual({ tag: "ok", value: { none: expectedBar(Array(5).fill(wilson(2, 2).low)), "port.closed": expectedBar(Array(5).fill(wilson(3, 4).low)) } });
    expect(result.tag === "ok" && result.value["none"]).toBeCloseTo(Math.floor(wilson(2, 2).low * 1000) / 1000, 12);
  });

  it("takes the spread of the lower ends from the least lower end, and stops at 0", () => {
    const counts = [5, 5, 5, 4, 5].map((hits) => ({ "port.closed": [hits, 5] as const, none: [hits - 3, 5] as const }));
    const result = labBars(counts.map(run));
    expect(result).toEqual({
      tag: "ok",
      value: {
        "port.closed": expectedBar(counts.map((c) => wilson(c["port.closed"][0], 5).low)),
        none: expectedBar(counts.map((c) => wilson(c.none[0], 5).low)),
      },
    });
    expect(result.tag === "ok" && result.value["none"]).toBe(0);
    expect(result.tag === "ok" && result.value["port.closed"]).toBeLessThan(wilson(4, 5).low);
  });

  it("takes the number of standard deviations and the fewest runs as options", () => {
    const runs = [5, 4, 5].map((hits) => run({ "port.closed": [hits, 5] }));
    expect(labBars(runs, { k: 0, minimum: 3 })).toEqual({ tag: "ok", value: { "port.closed": Math.floor(wilson(4, 5).low * 1000) / 1000 } });
    expect(labBars(runs, { minimum: 3 })).toEqual({ tag: "ok", value: { "port.closed": expectedBar([5, 4, 5].map((hits) => wilson(hits, 5).low)) } });
  });

  it("refuses too few runs, the scores of two catalogs, and a hypothesis with a read in only some runs", () => {
    const one = run({ none: [2, 2] });
    expect(labBars([one, one, one, one])).toMatchObject({ tag: "err", error: [expect.stringContaining("5 runs")] });
    expect(labBars([one, one, one, one, { ...one, catalog: "other@1" }])).toMatchObject({ tag: "err", error: [expect.stringContaining("2 catalogs")] });
    const some = [one, one, one, one, run({ none: [2, 2], "port.closed": [1, 1] })];
    expect(labBars(some)).toMatchObject({ tag: "err", error: [expect.stringContaining('"port.closed" has a read in 1 of 5 runs')] });
  });
});

describe("the recalls of a lab with no catalog of faults", () => {
  /** The recalls of one run of two cases, with no confusion table: `hits` of `reads` for each case. */
  const recalls = (counts: Readonly<Record<string, readonly [hits: number, reads: number]>>): LabRecalls => ({
    catalog: "cases@1",
    classes: Object.entries(counts).map(([label, [hits, reads]]) => ({ label, support: reads, recallInterval: wilson(hits, reads) })),
  });

  it("give the bars and the gate as a score does", () => {
    const runs = [5, 5, 4, 5, 5].map((hits) => recalls({ "loss.last-link": [hits, 5], none: [5, 5] }));
    const bars = labBars(runs);
    expect(bars).toEqual({
      tag: "ok",
      value: { "loss.last-link": expectedBar([5, 5, 4, 5, 5].map((hits) => wilson(hits, 5).low)), none: expectedBar(Array(5).fill(wilson(5, 5).low)) },
    });
    if (bars.tag !== "ok") return;
    const gate = labGate(recalls({ "loss.last-link": [5, 5], none: [0, 0] }), bars.value);
    expect(gate).toMatchObject({ tag: "ok", value: { pass: false, unbarred: [] } });
    expect(gate.tag === "ok" && gate.value.verdicts.map((verdict) => verdict.status)).toEqual(["pass", "no-read"]);
    expect(labGate(recalls({ none: [5, 5] }), { "loss.last-link": 0.5 })).toMatchObject({ tag: "err", error: [expect.stringContaining('"loss.last-link"')] });
  });

  it("give the gate of a score from its catalog and the three fields of each class only", () => {
    const score: LabRecalls = scored(RECORDS);
    const only: LabRecalls = { catalog: score.catalog, classes: score.classes.map(({ label, support, recallInterval }) => ({ label, support, recallInterval })) };
    const bars = { "port.closed": 0.25, none: 0.5 };
    expect(labGate(only, bars)).toEqual(labGate(score, bars));
  });
});
