import { readFileSync } from "node:fs";
import { LAYERS, STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { FAULT_ATLAS } from "./atlas.ts";
import { ATLAS_END, ATLAS_START, STANDARD_CLASS_PLACES, atlasPart, coverage, coverageMarkdown, markedPart, roadmapPart, withMarkedPart, withRoadmapParts, type CoverageWorld } from "./coverage.ts";
import { KERNEL_LATER } from "./kernel/cases.ts";
import { ROADMAP_FILE, labWorlds, readBars } from "./worlds.ts";

const WORLDS = labWorlds();
const TODAY = coverage({ catalog: STANDARD_CATALOG, worlds: WORLDS, atlas: FAULT_ATLAS });
const FAULTS = STANDARD_CATALOG.hypotheses.filter((each) => each.kind === "fault").map((each) => each.id);

/** A world of a later step: it has IPv6, and one case of `ipv6.broken`. */
const IPV6_WORLD: CoverageWorld = {
  id: "ipv6",
  name: "IPv6",
  scores: "class",
  traits: ["ipv6"],
  cases: [{ id: "ipv6.broken/no-route", truth: "ipv6.broken" }],
  bars: { "ipv6.broken": 0.5 },
};

describe("coverage", () => {
  it("has each fault class of the catalog in exactly one row, with a layer of LAYERS", () => {
    const ids = TODAY.rows.map((row) => row.hypothesis);
    expect([...ids].sort()).toEqual([...FAULTS].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of TODAY.rows) expect(LAYERS, row.hypothesis).toContain(row.layer);
    expect(Object.keys(STANDARD_CLASS_PLACES).sort()).toEqual([...FAULTS].sort());
    expect(TODAY.problems).toEqual([]);
  });

  it("gives the rows in the order of the layers, with a cell for each world", () => {
    const ranks = TODAY.rows.map((row) => LAYERS.indexOf(row.layer!));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const row of TODAY.rows) expect(row.worlds.map((cell) => cell.world)).toEqual(["loopback", "kernel", "where"]);
  });

  it("gives the gaps of today", () => {
    expect(TODAY.gaps.noCase).toEqual([
      { hypothesis: "interface.down", layer: "link", needs: ["link"], able: [] },
      { hypothesis: "wifi.weak", layer: "wifi", needs: ["wifi"], able: [] },
      { hypothesis: "ipv6.broken", layer: "ip", needs: ["ipv6"], able: [] },
    ]);
    expect(TODAY.gaps.noBar).toEqual([]);
    expect(TODAY.gaps.layers).toEqual(["link", "wifi"]);
    expect(TODAY.rows.filter((row) => row.state === "covered")).toHaveLength(17);
  });

  it("gives the cases of each world, and a bar only for a world with a bar for each case", () => {
    const loss = TODAY.rows.find((row) => row.hypothesis === "path.loss")!;
    expect(loss.worlds).toEqual([
      { world: "loopback", cases: [], bar: false },
      { world: "kernel", cases: ["path.loss"], bar: true },
      { world: "where", cases: ["loss.last-link", "loss.first-link"], bar: false },
    ]);
    const where = coverage({ catalog: STANDARD_CATALOG, worlds: labWorlds((name) => (name === "where" ? { "loss.last-link": 0.5 } : readBars(name))) });
    expect(where.rows.find((row) => row.hypothesis === "path.loss")?.worlds[2]?.bar).toBe(false);
    expect(TODAY.controls.map((cell) => cell.bar)).toEqual([true, true, false]);
  });

  it("closes a gap with a fake world that has one more case", () => {
    const later = coverage({ catalog: STANDARD_CATALOG, worlds: [...WORLDS, IPV6_WORLD] });
    expect(later.rows.find((row) => row.hypothesis === "ipv6.broken")?.state).toBe("covered");
    expect(later.gaps.noCase.map((gap) => gap.hypothesis)).toEqual(["interface.down", "wifi.weak"]);
    expect(later.problems).toEqual([]);
    const noBar = coverage({ catalog: STANDARD_CATALOG, worlds: [...WORLDS, { ...IPV6_WORLD, bars: {} }] });
    expect(noBar.rows.find((row) => row.hypothesis === "ipv6.broken")?.state).toBe("no-bar");
    expect(noBar.gaps.noBar).toEqual(["ipv6.broken"]);
    expect(coverage({ catalog: STANDARD_CATALOG, worlds: [{ ...IPV6_WORLD, cases: [] }] }).gaps.noCase.find((gap) => gap.hypothesis === "ipv6.broken")?.able).toEqual(["ipv6"]);
  });

  it("does not count a case in a world with no trait that the class needs, and tells it", () => {
    const result = coverage({ catalog: STANDARD_CATALOG, worlds: [...WORLDS, { ...IPV6_WORLD, traits: [] }] });
    expect(result.rows.find((row) => row.hypothesis === "ipv6.broken")?.state).toBe("no-case");
    expect(result.problems).toEqual(["The case ipv6.broken/no-route of the world ipv6 needs IPv6, and the world does not have it."]);
  });

  it("tells a truth that is not in the catalog, and a class with no place", () => {
    const { "wifi.weak": _wifi, ...places } = STANDARD_CLASS_PLACES;
    const result = coverage({ catalog: STANDARD_CATALOG, worlds: [{ ...IPV6_WORLD, cases: [{ id: "x", truth: "dns.lame" }] }], places: { ...places, "dns.lame": { layer: "dns" } } });
    expect(result.problems).toEqual([
      "The case x of the world ipv6 has the truth dns.lame, and the catalog has no such hypothesis.",
      "The class wifi.weak has no place, so it has no layer.",
      `The place of dns.lame is not for a fault class of the catalog ${STANDARD_CATALOG.version}.`,
    ]);
    expect(result.rows.at(-1)).toMatchObject({ hypothesis: "wifi.weak", layer: undefined, state: "no-case" });
  });

  it("agrees with the list of the kernel classes for later", () => {
    const gaps = new Set(TODAY.gaps.noCase.map((gap) => gap.hypothesis));
    for (const later of KERNEL_LATER) expect(gaps.has(later.hypothesis), later.hypothesis).toBe(true);
  });
});

describe("coverageMarkdown", () => {
  it("names each gap as a gap, and never shows a class with no case as covered", () => {
    const lines = coverageMarkdown(TODAY).split("\n");
    for (const row of TODAY.rows) {
      const line = lines.find((each) => each.startsWith(`| \`${row.hypothesis}\` |`));
      expect(line, row.hypothesis).toBeDefined();
      if (row.state === "covered") expect(line).toMatch(/\| Covered \|$/);
      else expect(line).toMatch(/\| Gap: [^|]+\|$/);
    }
    expect(lines).toContain("| `ipv6.broken` | `ip` | – | – | – | Gap: no case. No world has IPv6. |");
    expect(lines).toContain("- The layers with no case: `link`, `wifi`.");
  });

  it("gives one cell for each column in each line of the table", () => {
    const table = coverageMarkdown(TODAY).split("\n").filter((line) => line.startsWith("|"));
    const columns = (line: string): number => line.split("|").length - 2;
    for (const line of table) expect(columns(line), line).toBe(2 + WORLDS.length + 1);
  });
});

describe("the table of the roadmap", () => {
  it("is the rendering of the query. To correct it, start pnpm --filter @netdiag/lab roadmap", () => {
    const text = readFileSync(ROADMAP_FILE, "utf8");
    expect(markedPart(text)).toBe(roadmapPart(TODAY));
    expect(TODAY.atlas).toBeDefined();
    expect(markedPart(text, ATLAS_START, ATLAS_END)).toBe(atlasPart(TODAY.atlas!));
    expect(withRoadmapParts(text, TODAY)).toBe(text);
  });
});

describe("markedPart and withMarkedPart", () => {
  const START = "<!-- a -->";
  const END = "<!-- b -->";
  const TEXT = `head\n${START}\nold\n${END}\ntail\n`;

  it("read and write the part between the marker lines", () => {
    expect(markedPart(TEXT, START, END)).toBe("old\n");
    expect(withMarkedPart(TEXT, "new\nlines\n", START, END)).toBe(`head\n${START}\nnew\nlines\n${END}\ntail\n`);
    expect(withMarkedPart(`${START}\n${END}\n`, "x\n", START, END)).toBe(`${START}\nx\n${END}\n`);
  });

  it("give undefined for a file with no pair of marker lines, or with two start lines", () => {
    expect(markedPart("head\n", START, END)).toBeUndefined();
    expect(markedPart(`${START}\nold\n`, START, END)).toBeUndefined();
    expect(markedPart(`${START}\n${START}\n${END}\n`, START, END)).toBeUndefined();
    expect(withMarkedPart("head\n", "x", START, END)).toBeUndefined();
  });
});
