import { LAYERS, STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { ATLAS_WORLDS, FAULT_ATLAS, isRfcSource, type AtlasEntry } from "./atlas.ts";
import { STANDARD_CLASS_PLACES, atlasMarkdown, coverage, type AtlasCoverage } from "./coverage.ts";
import { labWorlds } from "./worlds.ts";

const FAULTS = STANDARD_CATALOG.hypotheses.filter((each) => each.kind === "fault").map((each) => each.id);
const HYPOTHESES = new Set(STANDARD_CATALOG.hypotheses.map((each) => each.id));
const WORLDS = labWorlds();
const TODAY = coverage({ catalog: STANDARD_CATALOG, worlds: WORLDS, atlas: FAULT_ATLAS });
const ATLAS: AtlasCoverage = TODAY.atlas!;

/** An entry with a class, for the tests of the problems. */
const ENTRY: AtlasEntry = {
  id: "test.entry",
  summary: "A test entry.",
  layer: "dns",
  hypothesis: "name.missing",
  signs: ["A sign."],
  world: "loopback",
  sources: [{ rfc: 2308, section: "2.1", title: "Negative Caching of DNS Queries (DNS NCACHE)" }],
};

describe("FAULT_ATLAS", () => {
  it("has 30 to 50 entries with unique ids, and no id of a hypothesis of the catalog", () => {
    expect(FAULT_ATLAS.length).toBeGreaterThanOrEqual(30);
    expect(FAULT_ATLAS.length).toBeLessThanOrEqual(50);
    const ids = FAULT_ATLAS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(HYPOTHESES.has(id), id).toBe(false);
  });

  it("gives each entry a layer of LAYERS, a world, a sign and a source", () => {
    for (const entry of FAULT_ATLAS) {
      expect(LAYERS, entry.id).toContain(entry.layer);
      expect(ATLAS_WORLDS, entry.id).toContain(entry.world);
      expect(entry.summary.length, entry.id).toBeGreaterThan(0);
      expect(entry.signs.length, entry.id).toBeGreaterThan(0);
      expect(entry.sources.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("gives each source an RFC with its section, or a public report with its address", () => {
    for (const entry of FAULT_ATLAS) {
      for (const source of entry.sources) {
        expect(source.title.length, entry.id).toBeGreaterThan(0);
        if (isRfcSource(source)) {
          expect(Number.isInteger(source.rfc) && source.rfc > 0, entry.id).toBe(true);
          expect(source.section, entry.id).toMatch(/^(\d+(\.\d+)*|Appendix [A-Z](\.\d+)*)$/);
        } else {
          expect(source.report, entry.id).toMatch(/^https:\/\/[^\s]+$/);
        }
      }
    }
  });

  it("names only fault classes of the catalog, each with the layer of its place", () => {
    for (const entry of FAULT_ATLAS) {
      if (entry.hypothesis === null) continue;
      expect(FAULTS, entry.id).toContain(entry.hypothesis);
      expect(entry.layer, entry.id).toBe(STANDARD_CLASS_PLACES[entry.hypothesis]?.layer);
      expect(entry.proposal, entry.id).toBeUndefined();
    }
  });

  it("gives each entry with no class a proposal that the catalog does not have", () => {
    for (const entry of FAULT_ATLAS) {
      if (entry.hypothesis !== null) continue;
      expect(entry.proposal, entry.id).toBeDefined();
      expect(HYPOTHESES.has(entry.proposal!), entry.id).toBe(false);
    }
  });

  it("has at least one entry for each fault class of the catalog, and for each layer", () => {
    const named = new Set(FAULT_ATLAS.map((entry) => entry.hypothesis));
    for (const id of FAULTS) expect(named.has(id), id).toBe(true);
    const layers = new Set(FAULT_ATLAS.map((entry) => entry.layer));
    for (const layer of LAYERS) expect(layers.has(layer), layer).toBe(true);
  });
});

describe("the coverage of the atlas", () => {
  it("has no problem of the data", () => {
    expect(TODAY.problems).toEqual([]);
  });

  it("gives the gap counts of today", () => {
    expect(ATLAS.total).toEqual({ entries: 49, covered: 19, noBar: 0, noCase: 4, noClass: 26 });
    expect(ATLAS.layers).toEqual([
      { layer: "link", entries: 2, covered: 0, noBar: 0, noCase: 1, noClass: 1 },
      { layer: "wifi", entries: 3, covered: 0, noBar: 0, noCase: 1, noClass: 2 },
      { layer: "ip", entries: 6, covered: 2, noBar: 0, noCase: 1, noClass: 3 },
      { layer: "route", entries: 5, covered: 1, noBar: 0, noCase: 0, noClass: 4 },
      { layer: "path", entries: 9, covered: 2, noBar: 0, noCase: 1, noClass: 6 },
      { layer: "dns", entries: 9, covered: 3, noBar: 0, noCase: 0, noClass: 6 },
      { layer: "tcp", entries: 5, covered: 3, noBar: 0, noCase: 0, noClass: 2 },
      { layer: "tls", entries: 6, covered: 5, noBar: 0, noCase: 0, noClass: 1 },
      { layer: "http", entries: 4, covered: 3, noBar: 0, noCase: 0, noClass: 1 },
    ]);
    expect(ATLAS.worlds).toEqual([
      { world: "loopback", entries: 13, covered: 12, noBar: 0, noCase: 0, noClass: 1 },
      { world: "kernel", entries: 10, covered: 7, noBar: 0, noCase: 0, noClass: 3 },
      { world: "containerlab", entries: 19, covered: 0, noBar: 0, noCase: 2, noClass: 17 },
      { world: "vm", entries: 7, covered: 0, noBar: 0, noCase: 2, noClass: 5 },
    ]);
  });

  it("gives the gaps of the labs: the entries of a class with no case", () => {
    expect(ATLAS.rows.filter((row) => row.state === "no-case").map((row) => [row.id, row.hypothesis])).toEqual([
      ["link.no-carrier", "interface.down"],
      ["wifi.weak-signal", "wifi.weak"],
      ["ip.ipv6-no-route", "ipv6.broken"],
      ["path.ipv6-too-big-filtered", "path.mtu"],
    ]);
  });

  it("counts an entry with IPv6 only in a world with IPv6, while its class is covered in IPv4", () => {
    expect(TODAY.rows.find((row) => row.hypothesis === "path.mtu")?.state).toBe("covered");
    expect(ATLAS.rows.find((row) => row.id === "path.ipv6-too-big-filtered")).toMatchObject({ needs: ["ipv6"], state: "no-case" });
    const ipv6: (typeof WORLDS)[number] = { id: "ipv6", name: "IPv6", scores: "class", traits: ["ipv6"], cases: [{ id: "mtu", truth: "path.mtu" }], bars: { "path.mtu": 0.5 } };
    const later = coverage({ catalog: STANDARD_CATALOG, worlds: [...WORLDS, ipv6], atlas: FAULT_ATLAS });
    expect(later.atlas?.rows.find((row) => row.id === "path.ipv6-too-big-filtered")?.state).toBe("covered");
  });

  it("gives the classes that the atlas proposes, with their entries", () => {
    expect(ATLAS.proposals).toHaveLength(25);
    expect(ATLAS.proposals.find((each) => each.proposal === "dnssec.bogus")).toEqual({
      proposal: "dnssec.bogus",
      layer: "dns",
      entries: ["dns.dnssec-bogus", "dns.dnssec-expired"],
      worlds: ["containerlab"],
    });
    const proposed = ATLAS.proposals.flatMap((each) => each.entries);
    expect(proposed.sort()).toEqual(ATLAS.rows.filter((row) => row.state === "no-class").map((row) => row.id).sort());
  });

  it("gives the rows in the order of the layers", () => {
    const ranks = ATLAS.rows.map((row) => LAYERS.indexOf(row.layer));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("tells the problems of a bad atlas", () => {
    const atlas: readonly AtlasEntry[] = [
      ...FAULT_ATLAS.filter((entry) => entry.hypothesis !== "server.slow"),
      { ...ENTRY, id: "name.missing" },
      { ...ENTRY, hypothesis: "dns.lame", signs: [], sources: [] },
      { ...ENTRY, id: "test.layer", layer: "tcp" },
      { ...ENTRY, id: "test.proposal", hypothesis: null, proposal: "name.missing" },
      { ...ENTRY, id: "test.none", hypothesis: null },
      { ...ENTRY, id: "test.both", proposal: "dns.other" },
      { ...ENTRY, id: "test.both" },
    ];
    expect(coverage({ catalog: STANDARD_CATALOG, worlds: WORLDS, atlas }).problems).toEqual([
      "The atlas entry name.missing has the id of a hypothesis of the catalog.",
      "The atlas entry test.entry has no sign.",
      "The atlas entry test.entry has no source.",
      "The atlas entry test.entry names dns.lame, and the catalog has no such fault class.",
      "The atlas entry test.layer has the layer tcp, and its class name.missing has the layer dns.",
      "The atlas entry test.proposal proposes name.missing, and the catalog has it. Name it as the class of the entry.",
      "The atlas entry test.none has no class and no proposal.",
      "The atlas entry test.both has a class and a proposal.",
      "The atlas has the entry test.both more than once.",
      "The class server.slow has no entry in the atlas.",
    ]);
  });
});

describe("atlasMarkdown", () => {
  const lines = atlasMarkdown(ATLAS).split("\n");

  it("gives a row for each layer and each world, with a line of the totals", () => {
    expect(lines).toContain("| `link` | 2 | 0 | 0 | 1 | 1 |");
    expect(lines).toContain("| All | 49 | 19 | 0 | 4 | 26 |");
    expect(lines).toContain("| containerlab | 19 | 0 | 0 | 2 | 17 |");
    const table = lines.filter((line) => line.startsWith("|"));
    for (const line of table) expect(line.split("|").length - 2, line).toBe(6);
    expect(table).toHaveLength(2 + LAYERS.length + 1 + 2 + ATLAS_WORLDS.length);
  });

  it("names the gaps of the labs and the classes that the atlas proposes", () => {
    expect(lines).toContain("- The atlas has 49 entries. 23 name a class of the catalog, and 26 have no class.");
    expect(lines.find((line) => line.startsWith("- The gaps of the labs"))).toContain("`path.ipv6-too-big-filtered` (`path.mtu`, containerlab)");
    expect(lines).toContain("- The gaps of the catalog. The atlas proposes 25 classes:");
    expect(lines).toContain("  - `dnssec.bogus` (`dns`, containerlab): `dns.dnssec-bogus`, `dns.dnssec-expired`.");
  });
});
