import { describe, expect, it } from "vitest";
import { bandLine } from "./report.ts";

describe("bandLine", () => {
  it("counts the records with causes of the same facts, also at the distance 0", () => {
    const line = bandLine({ alike: 5, inner: 0, innerCase: "filter.drop#0", outer: 2.1, outerCase: "gateway.down#0", nearest: "wifi.weak" });
    expect(line).toContain("5 records have an alike cause. The largest distance of an alike cause is 0.00e+0 (`filter.drop#0`)");
    expect(line).toContain("the smallest distance of another cause is 2.100e+0 (`gateway.down#0` to `wifi.weak`)");
    expect(bandLine({ alike: 1, inner: 1e-9, innerCase: "a" })).toContain("1 record has an alike cause.");
  });

  it("says that no record has an alike cause only when the count is 0", () => {
    expect(bandLine({ alike: 0, inner: 0, outer: 1, outerCase: "a", nearest: "none" })).toMatch(/^No record has an alike cause, and/);
  });
});
