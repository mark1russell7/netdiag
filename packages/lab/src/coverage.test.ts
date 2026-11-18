import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LAYERS, STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { FAULT_ATLAS } from "./atlas.ts";
import {
  ATLAS_END,
  ATLAS_START,
  STANDARD_CLASS_NEEDS,
  STATE_KEYS,
  atlasPart,
  coverage,
  coverageMarkdown,
  gateCounts,
  markedPart,
  roadmapPart,
  siteLadderText,
  withMarkedPart,
  withRoadmapParts,
  type Coverage,
  type CoverageGate,
  type CoverageWorld,
  type LadderCell,
} from "./coverage.ts";
import { GRAMMAR_CLASSES, GRAMMAR_END, GRAMMAR_START, grammarPart } from "./grammar.ts";
import { KERNEL_LATER } from "./kernel/cases.ts";
import { LAB_LAYERS, LAYER_FACTS, LAYER_LIMITS, LAYER_STATE_TEXT, type LabLayer } from "./ladder.ts";
import { CASES_PER_CLASS } from "./sim/cases.ts";
import { GATE_FILE, ROADMAP_FILE, SITE_FILE, labWorlds, readBars } from "./worlds.ts";

const WORLDS = labWorlds();
const TODAY = coverage({ catalog: STANDARD_CATALOG, worlds: WORLDS, atlas: FAULT_ATLAS });
/** The worlds on the layer E1. The tests of the query use them, because the simulated world has a case of each class. */
const E1_WORLDS = WORLDS.filter((world) => world.layer === "E1");
const E1 = coverage({ catalog: STANDARD_CATALOG, worlds: E1_WORLDS, atlas: FAULT_ATLAS });
/** The ids of the cases of one class in the simulated world. */
const simCases = (label: string): string[] => Array.from({ length: CASES_PER_CLASS }, (_, at) => `${label}#${at + 1}`);
const FAULTS = STANDARD_CATALOG.hypotheses.filter((each) => each.kind === "fault").map((each) => each.id);

/** A world of a later step: it has IPv6, and one case of `ipv6.broken`. */
const IPV6_WORLD: CoverageWorld = {
  id: "ipv6",
  name: "IPv6",
  layer: "E1",
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
    for (const id of Object.keys(STANDARD_CLASS_NEEDS)) expect(FAULTS, id).toContain(id);
    expect(TODAY.problems).toEqual([]);
  });

  it("gives the rows in the order of the layers, with a cell for each world", () => {
    const ranks = TODAY.rows.map((row) => LAYERS.indexOf(row.layer!));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const row of TODAY.rows) expect(row.worlds.map((cell) => cell.world)).toEqual(["sim", "loopback", "kernel", "where"]);
  });

  it("gives the gaps of today: none, because the simulated world has a case and a bar of each class", () => {
    expect(TODAY.gaps).toMatchObject({ noCase: [], noBar: [], layers: [] });
    expect(TODAY.rows.filter((row) => row.state === "covered")).toHaveLength(21);
    expect(E1.gaps.noCase).toEqual([
      { hypothesis: "interface.down", layer: "link", needs: ["link"], able: [] },
      { hypothesis: "wifi.weak", layer: "wifi", needs: ["wifi"], able: [] },
      { hypothesis: "ipv6.broken", layer: "ip", needs: ["ipv6"], able: [] },
    ]);
    // The loopback lab has a case of proxy.error. Its bar comes from a dispatch of 5 runs.
    expect(E1.gaps.noBar).toEqual(["proxy.error"]);
    expect(E1.gaps.layers).toEqual(["link", "wifi"]);
    expect(E1.rows.filter((row) => row.state === "covered")).toHaveLength(17);
  });

  it("gives the cases of each world, and a bar only for a world with a bar for each case", () => {
    const loss = TODAY.rows.find((row) => row.hypothesis === "path.loss")!;
    expect(loss.worlds).toEqual([
      { world: "sim", cases: simCases("path.loss"), bar: true },
      { world: "loopback", cases: [], bar: false },
      { world: "kernel", cases: ["path.loss"], bar: true },
      { world: "where", cases: ["loss.last-link", "loss.first-link"], bar: false },
    ]);
    const where = coverage({ catalog: STANDARD_CATALOG, worlds: labWorlds((name) => (name === "where" ? { "loss.last-link": 0.5 } : readBars(name))) });
    expect(where.rows.find((row) => row.hypothesis === "path.loss")?.worlds[3]?.bar).toBe(false);
    expect(TODAY.controls.map((cell) => cell.bar)).toEqual([true, true, true, false]);
  });

  it("gives no bar for a bar of 0, because a bar of 0 holds nothing", () => {
    const zero = coverage({ catalog: STANDARD_CATALOG, worlds: labWorlds((name) => (name === "sim" ? { ...readBars(name), "path.loss": 0 } : readBars(name))) });
    expect(zero.rows.find((row) => row.hypothesis === "path.loss")?.worlds[0]).toEqual({ world: "sim", cases: simCases("path.loss"), bar: false });
    expect(readBars("sim")["path.mtu"]).toBeGreaterThan(0);
    expect(TODAY.rows.find((row) => row.hypothesis === "path.mtu")?.worlds[0]?.bar).toBe(true);
  });

  it("closes a gap with a fake world that has one more case", () => {
    const later = coverage({ catalog: STANDARD_CATALOG, worlds: [...E1_WORLDS, IPV6_WORLD] });
    expect(later.rows.find((row) => row.hypothesis === "ipv6.broken")?.state).toBe("covered");
    expect(later.gaps.noCase.map((gap) => gap.hypothesis)).toEqual(["interface.down", "wifi.weak"]);
    expect(later.problems).toEqual([]);
    const noBar = coverage({ catalog: STANDARD_CATALOG, worlds: [...E1_WORLDS, { ...IPV6_WORLD, bars: {} }] });
    expect(noBar.rows.find((row) => row.hypothesis === "ipv6.broken")?.state).toBe("no-bar");
    expect(noBar.gaps.noBar).toEqual(["ipv6.broken", "proxy.error"]);
    expect(coverage({ catalog: STANDARD_CATALOG, worlds: [{ ...IPV6_WORLD, cases: [] }] }).gaps.noCase.find((gap) => gap.hypothesis === "ipv6.broken")?.able).toEqual(["ipv6"]);
  });

  it("does not count a case in a world with no trait that the class needs, and tells it", () => {
    const result = coverage({ catalog: STANDARD_CATALOG, worlds: [...E1_WORLDS, { ...IPV6_WORLD, traits: [] }] });
    expect(result.rows.find((row) => row.hypothesis === "ipv6.broken")?.state).toBe("no-case");
    expect(result.problems).toEqual(["The case ipv6.broken/no-route of the world ipv6 needs IPv6, and the world does not have it."]);
  });

  it("tells a truth that is not in the catalog, a class with no layer, and needs of a class that is not in the catalog", () => {
    const catalog = { ...STANDARD_CATALOG, hypotheses: STANDARD_CATALOG.hypotheses.map((each) => (each.id === "wifi.weak" ? { ...each, layer: undefined } : each)) };
    const result = coverage({ catalog, worlds: [{ ...IPV6_WORLD, cases: [{ id: "x", truth: "dns.lame" }] }], needs: { ...STANDARD_CLASS_NEEDS, "dns.lame": [] } });
    expect(result.problems).toEqual([
      "The case x of the world ipv6 has the truth dns.lame, and the catalog has no such hypothesis.",
      "The class wifi.weak has no layer in the catalog.",
      `The needs of dns.lame are not for a fault class of the catalog ${STANDARD_CATALOG.version}.`,
    ]);
    expect(result.rows.at(-1)).toMatchObject({ hypothesis: "wifi.weak", layer: undefined, state: "no-case" });
  });

  it("agrees with the list of the kernel classes for later", () => {
    const gaps = new Set(E1.gaps.noCase.map((gap) => gap.hypothesis));
    for (const later of KERNEL_LATER) expect(gaps.has(later.hypothesis), later.hypothesis).toBe(true);
  });
});

describe("the ladder", () => {
  const { ladder } = TODAY;
  const cellOf = (result: Coverage, id: string, layer: LabLayer): LadderCell | undefined =>
    result.ladder.rows.find((row) => row.id === id)?.cells.find((cell) => cell.layer === layer);

  it("has the layers of the harness, with the facts of S7 for each layer", () => {
    expect(ladder.layers).toEqual(LAB_LAYERS);
    expect(Object.keys(LAYER_FACTS)).toEqual([...LAB_LAYERS]);
    for (const layer of LAB_LAYERS) {
      for (const each of LAYER_LIMITS[layer]) {
        expect(each.layer).toBe(layer);
        expect(LAYER_FACTS[layer].cannot, each.reason).toContain(each.reason);
        expect(each.source).toContain(`row ${layer}`);
      }
    }
    expect(LAYER_LIMITS.E0).toEqual([]);
    expect(LAYER_LIMITS.E6).toEqual([]);
    expect(LAYER_FACTS.E6.cannot).toEqual([]);
  });

  it("gives the site the texts of S7 and the limits of the lab for each layer, and not the faults and loads of the harness", () => {
    const layers = (JSON.parse(siteLadderText(TODAY)) as { layers: Record<string, unknown>[] }).layers;
    expect(layers.map((layer) => layer["id"])).toEqual([...LAB_LAYERS]);
    for (const layer of layers) {
      const facts = LAYER_FACTS[layer["id"] as LabLayer];
      expect(Object.keys(layer).sort()).toEqual(["cannot", "id", "limits", "name", "proves", "state", "stateText", "tools"]);
      expect(layer).toMatchObject({ name: facts.name, state: facts.state, stateText: LAYER_STATE_TEXT[facts.state] });
      expect(layer["limits"]).toEqual(LAYER_LIMITS[layer["id"] as LabLayer]);
    }
    expect(LAYER_STATE_TEXT.waiting).toBe("Waits on the owner");
  });

  it("has a row for each class of the catalog and each proposed class, with a cell for each layer", () => {
    expect(ladder.rows.filter((row) => row.kind === "class").map((row) => row.id)).toEqual(TODAY.rows.map((row) => row.hypothesis));
    const proposed = GRAMMAR_CLASSES.filter((each) => !FAULTS.includes(each.id)).map((each) => each.id);
    expect(ladder.rows.filter((row) => row.kind === "proposal").map((row) => row.id)).toEqual(proposed);
    for (const each of TODAY.atlas!.proposals) expect(proposed).toContain(each.proposal);
    for (const row of ladder.rows) expect(row.cells.map((cell) => cell.layer), row.id).toEqual(LAB_LAYERS);
    expect(coverage({ catalog: STANDARD_CATALOG, worlds: WORLDS, classes: [] }).ladder.rows.every((row) => row.kind === "class")).toBe(true);
  });

  it("gives the counts of today: each covered cell is on E0 or E1, and only link.duplex on E4 is impossible", () => {
    expect(ladder.classes).toEqual({ cells: 147, covered: 38, noBar: 1, gap: 108, noClass: 0, impossible: 0, gaps: 109 });
    expect(ladder.proposals).toEqual({ cells: 511, covered: 0, noBar: 0, gap: 0, noClass: 510, impossible: 1, gaps: 510 });
    expect(ladder.total).toEqual({ cells: 658, covered: 38, noBar: 1, gap: 108, noClass: 510, impossible: 1, gaps: 619 });
    const impossible = ladder.rows.flatMap((row) => row.cells.filter((cell) => cell.state === "impossible").map((cell) => [row.id, cell.layer]));
    expect(impossible).toEqual([["link.duplex", "E4"]]);
    const covered = ladder.rows.flatMap((row) => row.cells).filter((cell) => cell.state === "covered");
    expect(new Set(covered.map((cell) => cell.layer))).toEqual(new Set(["E0", "E1"]));
    expect(cellOf(TODAY, "path.mtu", "E0")).toEqual({ layer: "E0", state: "covered", worlds: [{ world: "sim", cases: simCases("path.mtu"), bar: true }], limits: [] });
    expect(cellOf(TODAY, "path.loss", "E1")).toEqual({
      layer: "E1",
      state: "covered",
      worlds: [
        { world: "kernel", cases: ["path.loss"], bar: true },
        { world: "where", cases: ["loss.last-link", "loss.first-link"], bar: false },
      ],
      limits: [],
    });
    expect(cellOf(TODAY, "path.loss", "E3")).toEqual({ layer: "E3", state: "gap", worlds: [], limits: [] });
    expect(ladder.rows.find((row) => row.id === "path.leak")).toMatchObject({ kind: "proposal", layer: "path", needs: ["routing"], entries: ["path.bgp-leak"] });
  });

  it("counts a case only on the layer of its world, and a case with no bar as a gap", () => {
    const later = coverage({ catalog: STANDARD_CATALOG, worlds: [...WORLDS, { ...IPV6_WORLD, layer: "E3" }] });
    expect(cellOf(later, "ipv6.broken", "E3")?.state).toBe("covered");
    expect(cellOf(later, "ipv6.broken", "E1")?.state).toBe("gap");
    const noBar = coverage({ catalog: STANDARD_CATALOG, worlds: [...WORLDS, { ...IPV6_WORLD, bars: {} }] });
    expect(cellOf(noBar, "ipv6.broken", "E1")?.state).toBe("no-bar");
    expect(noBar.ladder.classes.gaps).toBe(TODAY.ladder.classes.gaps);
    expect(later.ladder.classes.gaps).toBe(TODAY.ladder.classes.gaps - 1);
  });

  it("makes a cell impossible only when the class needs a trait that the layer cannot have", () => {
    const needs = { ...STANDARD_CLASS_NEEDS, "wifi.weak": ["wifi", "nic"] as const };
    const classes = GRAMMAR_CLASSES.map((each) => (each.id === "path.leak" ? { ...each, needs: ["forwarding" as const] } : each));
    const result = coverage({ catalog: STANDARD_CATALOG, worlds: E1_WORLDS, needs, atlas: FAULT_ATLAS, classes });
    expect(cellOf(result, "wifi.weak", "E4")).toEqual({ layer: "E4", state: "impossible", worlds: [], limits: [LAYER_LIMITS.E4[0]] });
    expect(LAB_LAYERS.filter((layer) => cellOf(result, "wifi.weak", layer)?.state === "impossible")).toEqual(["E4"]);
    expect(LAB_LAYERS.filter((layer) => cellOf(result, "path.leak", layer)?.state === "impossible")).toEqual(["E3", "E5"]);
    expect(result.ladder.total.impossible).toBe(E1.ladder.total.impossible + 3);
    expect(result.ladder.total.gaps).toBe(E1.ladder.total.gaps - 3);
    for (const row of result.ladder.rows) expect(row.cells[0]?.state, row.id).not.toBe("impossible");
  });

  it("tells a world with a trait that its layer cannot have, and a world on no layer of the ladder", () => {
    const nic = coverage({ catalog: STANDARD_CATALOG, worlds: [{ ...IPV6_WORLD, layer: "E4", traits: ["ipv6", "nic"] }] });
    expect(nic.problems).toEqual(["The world ipv6 has a physical NIC or its firmware, and its layer E4 cannot have it: A physical NIC."]);
    const none = coverage({ catalog: STANDARD_CATALOG, worlds: [{ ...IPV6_WORLD, layer: "E9" as LabLayer }] });
    expect(none.problems).toEqual(["The world ipv6 has the layer E9, and the ladder has no such layer."]);
  });
});

describe("the gate of the coverage", () => {
  it("has the counts of the query in bars/coverage.json. To change them, change the file and tell the reason in its note", () => {
    const gate = JSON.parse(readFileSync(GATE_FILE, "utf8")) as CoverageGate;
    expect(gate.note.length).toBeGreaterThan(0);
    const { note: _, ...counts } = gate;
    expect(gateCounts(TODAY.ladder)).toEqual(counts);
  });
});

describe("coverageMarkdown", () => {
  const lines = coverageMarkdown(TODAY).split("\n");
  const table = lines.filter((line) => line.startsWith("|"));

  it("gives the line of the counts first, with the gaps of the classes and of the proposed classes", () => {
    expect(lines[0]).toBe(
      "- **619 gaps** in 658 cells: 94 classes on 7 layers. The classes of the catalog have 109 gaps, and the proposed classes have 510 gaps. 38 cells covered, and 1 cell impossible. The work ends only at zero gaps.",
    );
  });

  it("gives a line for each row of the ladder, with a column for each layer", () => {
    expect(table).toHaveLength(2 + 21 + 2 + 73);
    for (const line of table) expect(line.split("|").length - 2, line).toBe(2 + LAB_LAYERS.length);
    expect(table[0]).toBe("| Class | Layer | E0 | E1 | E2 | E3 | E4 | E5 | E6 |");
  });

  it("gives the mark of the state of each cell, and the cases of a covered cell", () => {
    for (const row of TODAY.ladder.rows) {
      const line = table.find((each) => each.startsWith(`| \`${row.id}\` |`));
      expect(line, row.id).toBeDefined();
      const cells = line!.split("|").slice(3, -1).map((each) => each.trim());
      row.cells.forEach((cell, at) => expect(cells[at]?.startsWith(STATE_KEYS[cell.state].mark), `${row.id} ${cell.layer}`).toBe(true));
    }
    expect(table).toContain("| `ipv6.broken` | `ip` | ✓ 80 cases of `sim` | ○ | ○ | ○ | ○ | ○ | ○ |");
    expect(table).toContain("| `path.loss` | `path` | ✓ 80 cases of `sim` | ✓ `path.loss`, `loss.last-link`, `loss.first-link` | ○ | ○ | ○ | ○ | ○ |");
    expect(table).toContain("| `path.mtu` | `path` | ✓ 80 cases of `sim` | ✓ `path.mtu` | ○ | ○ | ○ | ○ | ○ |");
    expect(table).toContain("| `link.duplex` | `link` | ◌ | ◌ | ◌ | ◌ | ⊘ [1] | ◌ | ◌ |");
    expect(lines).toContain(`  1. E4 cannot prove "A physical NIC". Thus it cannot have a physical NIC or its firmware. Source: ${LAYER_LIMITS.E4[0]!.source}.`);
  });

  it("gives the reason and the source of each impossible cell in a numbered list", () => {
    const result = coverage({ catalog: STANDARD_CATALOG, worlds: E1_WORLDS, needs: { ...STANDARD_CLASS_NEEDS, "wifi.weak": ["wifi", "nic"] } });
    const text = coverageMarkdown(result).split("\n");
    expect(text).toContain("| `wifi.weak` | `wifi` | ○ | ○ | ○ | ○ | ⊘ [1] | ○ | ○ |");
    expect(text).toContain(`  1. E4 cannot prove "A physical NIC". Thus it cannot have a physical NIC or its firmware. Source: ${LAYER_LIMITS.E4[0]!.source}.`);
  });
});

describe("the files of the roadmap and of the site", () => {
  it("are the rendering of the query. To correct them, start pnpm --filter @netdiag/lab roadmap", () => {
    const text = readFileSync(ROADMAP_FILE, "utf8");
    expect(markedPart(text)).toBe(roadmapPart(TODAY));
    expect(TODAY.atlas).toBeDefined();
    expect(markedPart(text, ATLAS_START, ATLAS_END)).toBe(atlasPart(TODAY.atlas!));
    expect(markedPart(text, GRAMMAR_START, GRAMMAR_END)).toBe(grammarPart());
    expect(withRoadmapParts(text, TODAY)).toBe(text);
    expect(readFileSync(SITE_FILE, "utf8")).toBe(siteLadderText(TODAY));
  });

  it("are current for the command with --check", () => {
    const main = fileURLToPath(new URL("./coverage-main.ts", import.meta.url));
    const run = spawnSync(process.execPath, [main, "--check"], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("The coverage files are current.\n");
    expect(run.status).toBe(0);
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
