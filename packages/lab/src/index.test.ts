import { STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CI_HOSTS,
  LOCAL_HOSTS,
  LOOPBACK_CASES,
  REFERENCE_NAME,
  TARGET_NAME,
  labReport,
  labTrust,
  missingSigns,
  reportMarkdown,
  roundOrder,
  runLab,
  zoneOf,
  type CaseRun,
  type LabTrust,
} from "./index.ts";

describe("the cases", () => {
  it("have different ids, a hypothesis of the catalog as the truth, and signs with values of the catalog", () => {
    expect(new Set(LOOPBACK_CASES.map((c) => c.id)).size).toBe(LOOPBACK_CASES.length);
    const ids = new Set(STANDARD_CATALOG.hypotheses.map((h) => h.id));
    for (const labCase of LOOPBACK_CASES) {
      expect(ids.has(labCase.truth), labCase.id).toBe(true);
      expect(labCase.signs.length, labCase.id).toBeGreaterThan(0);
      for (const sign of labCase.signs) expect(STANDARD_CATALOG.features.get(sign.feature)?.values, `${labCase.id} ${sign.feature}`).toContain(sign.value);
    }
  });

  it("cover each fault of the loopback column of the roadmap", () => {
    const truths = new Set(LOOPBACK_CASES.map((c) => c.truth));
    const loopback = ["none", "resolver.down", "resolver.failing", "name.missing", "port.closed", "tls.cert-invalid", "tls.mismatch", "tls.proxy", "server.slow", "server.error", "captive.portal"];
    expect([...truths].sort()).toEqual([...loopback].sort());
  });
});

describe("zoneOf", () => {
  it("answers the names of the lab, and NXDOMAIN for each other name", () => {
    const zone = zoneOf(CI_HOSTS, { mode: "answer" });
    expect(zone(TARGET_NAME)).toEqual({ rcode: 0, a: [CI_HOSTS.target] });
    expect(zone(REFERENCE_NAME)).toEqual({ rcode: 0, a: [CI_HOSTS.reference] });
    expect(zone("www.example.net")).toEqual({ rcode: 3 });
  });

  it("removes the target name, sends each name to the portal, fails or keeps silent", () => {
    expect(zoneOf(CI_HOSTS, { mode: "answer", missing: true })(TARGET_NAME)).toEqual({ rcode: 3 });
    expect(zoneOf(CI_HOSTS, { mode: "answer", portal: true })(REFERENCE_NAME)).toEqual({ rcode: 0, a: [CI_HOSTS.portal] });
    expect(zoneOf(CI_HOSTS, { mode: "servfail" })(TARGET_NAME)).toEqual({ rcode: 2 });
    expect(zoneOf(CI_HOSTS, { mode: "silent" })(TARGET_NAME)).toBe("silent");
  });
});

describe("roundOrder and missingSigns", () => {
  it("turns the order of the cases in each round", () => {
    expect(roundOrder(["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
    expect(roundOrder(["a", "b", "c"], 4)).toEqual(["b", "c", "a"]);
    expect(roundOrder([], 3)).toEqual([]);
  });

  it("gives each sign that no evidence shows", () => {
    const signs = [
      { feature: "tcp.connect", primary: true, value: "refused" },
      { feature: "http.status", primary: false, value: "ok" },
    ];
    const evidence = [{ feature: "tcp.connect", primary: true, value: "refused", facts: ["f1"] }];
    expect(missingSigns(signs, evidence)).toEqual([signs[1]]);
  });
});

// The mechanics of the lab on loopback addresses: each world starts, shows its signs and gives a record. The readers
// see the loopback addresses as private, so this test does not examine the accuracy. The CI lab does.
describe("the lab on loopback addresses", () => {
  let trust: LabTrust;
  beforeAll(async () => {
    trust = await labTrust();
  }, 60_000);

  it("gives a read for each case", async () => {
    const runs: CaseRun[] = await runLab(LOOPBACK_CASES, 1, { hosts: LOCAL_HOSTS, trust });
    const noReads = runs.filter((run) => run.status === "no-read");
    expect(noReads).toEqual([]);
    const report = labReport(STANDARD_CATALOG, runs, 1, LOOPBACK_CASES.length);
    expect(report.records).toHaveLength(LOOPBACK_CASES.length);
    expect(report.score?.n).toBe(LOOPBACK_CASES.length);
    expect(reportMarkdown(report)).toContain("## The loopback lab");
  }, 120_000);
});
