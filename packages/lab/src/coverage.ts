import { LAYERS, layerRank, type Catalog, type LabBars, type Layer } from "@mark1russell7/netdiag";
import { countOf } from "@mark1russell7/text";

// The coverage of the fault classes (ND-17, step 1). The query joins the classes of a catalog with the cases of each
// world. It gives the gaps as data: a class with no case, a class with a case and no bar, and a layer with no case.
// A gap is not a pass. This module imports no `node:` module. The module `worlds.ts` gives the worlds of the lab.

/**
 * A trait of the networks of a world. A case of some classes needs a trait.
 *
 * - `ipv6`: the networks of the world have IPv6.
 * - `wifi`: the client has a Wi-Fi link.
 * - `link`: a case can take the link of the client down.
 */
export type WorldTrait = "ipv6" | "wifi" | "link";

/** The name of each trait, for a sentence of the table. */
export const TRAIT_NAMES: Readonly<Record<WorldTrait, string>> = {
  ipv6: "IPv6",
  wifi: "a Wi-Fi link",
  link: "a link that a case can take down",
};

/** The layer of a fault class, and the traits that a world needs for a case of the class. */
export interface ClassPlace {
  readonly layer: Layer;
  readonly needs?: readonly WorldTrait[] | undefined;
}

/**
 * The place of each fault class of the standard catalog. The layer is the layer where the fault starts.
 *
 * The catalog gives the part of each fault, not its layer. Thus the lab keeps the layers. A test holds one place for
 * each class of the catalog.
 */
export const STANDARD_CLASS_PLACES: Readonly<Record<string, ClassPlace>> = {
  "interface.down": { layer: "link", needs: ["link"] },
  "wifi.weak": { layer: "wifi", needs: ["wifi"] },
  "ipv6.broken": { layer: "ip", needs: ["ipv6"] },
  "filter.icmp": { layer: "ip" },
  "host.down": { layer: "ip" },
  "gateway.down": { layer: "route" },
  "path.loss": { layer: "path" },
  "path.mtu": { layer: "path" },
  "resolver.down": { layer: "dns" },
  "resolver.failing": { layer: "dns" },
  "name.missing": { layer: "dns" },
  "port.closed": { layer: "tcp" },
  "filter.drop": { layer: "tcp" },
  "filter.reset": { layer: "tcp" },
  "tls.proxy": { layer: "tls" },
  "tls.cert-invalid": { layer: "tls" },
  "tls.mismatch": { layer: "tls" },
  "captive.portal": { layer: "http" },
  "server.slow": { layer: "http" },
  "server.error": { layer: "http" },
};

/** A case of a world, as the coverage reads it: its id and the id of its true hypothesis. */
export interface CoverageCase {
  readonly id: string;
  readonly truth: string;
}

/**
 * The thing that the gate of a world holds.
 *
 * - `class`: the recall of each class. The key of each bar is the id of a class.
 * - `loss-start`: the hit rate of the start of a loss. The key of each bar is the id of a case.
 */
export type WorldScore = "class" | "loss-start";

/** A world of the lab, as data: its traits, its cases and the bars of its gate. A new world is one more entry. */
export interface CoverageWorld {
  readonly id: string;
  /** The name of the world, for the heading of its column. */
  readonly name: string;
  readonly scores: WorldScore;
  readonly traits: readonly WorldTrait[];
  readonly cases: readonly CoverageCase[];
  /** The bars of the gate of the world. A world with no file of bars has no bar. */
  readonly bars: LabBars;
}

/** The cases of one hypothesis in one world, and if the world has a bar for the hypothesis. */
export interface WorldCell {
  readonly world: string;
  /** The ids of the cases, in the order of the world. */
  readonly cases: readonly string[];
  /** It is `true` when the world has a bar for each case. A cell with no case has no bar. */
  readonly bar: boolean;
}

/**
 * The state of a class.
 *
 * - `covered`: a world has a case of the class and a bar for it.
 * - `no-bar`: a world has a case of the class, and no world has a bar for it.
 * - `no-case`: no world has a case of the class.
 */
export type ClassState = "covered" | "no-bar" | "no-case";

/** A row of the coverage: one fault class of the catalog, its layer, and its cell in each world. */
export interface CoverageRow {
  readonly hypothesis: string;
  /** The layer is absent when the places have no entry for the class. The problems then tell it. */
  readonly layer: Layer | undefined;
  readonly needs: readonly WorldTrait[];
  /** One cell for each world, in the order of the worlds. */
  readonly worlds: readonly WorldCell[];
  readonly state: ClassState;
}

/** A class with no case, and the worlds that have each trait that the class needs. */
export interface CaseGap {
  readonly hypothesis: string;
  readonly layer: Layer | undefined;
  readonly needs: readonly WorldTrait[];
  /** The ids of the worlds that have each trait of `needs`. */
  readonly able: readonly string[];
}

/** The gaps of the coverage. */
export interface CoverageGaps {
  /** The classes with no case, in the order of the rows. */
  readonly noCase: readonly CaseGap[];
  /** The classes with a case and no bar, in the order of the rows. */
  readonly noBar: readonly string[];
  /** The layers of `LAYERS` with no case of a class, in the order of `LAYERS`. */
  readonly layers: readonly Layer[];
}

/** A world of the coverage, for the headings of the table. */
export interface CoverageWorldName {
  readonly id: string;
  readonly name: string;
  readonly scores: WorldScore;
}

/** The result of the coverage query. */
export interface Coverage {
  readonly worlds: readonly CoverageWorldName[];
  /** One row for each fault class of the catalog, in the order of the layers, then in the order of the catalog. */
  readonly rows: readonly CoverageRow[];
  /** The cell of the hypothesis `none`, the control, in each world. */
  readonly controls: readonly WorldCell[];
  readonly gaps: CoverageGaps;
  /** The problems of the data: for example a case with a truth that is not in the catalog. */
  readonly problems: readonly string[];
}

/** The input of the coverage query. */
export interface CoverageInput {
  readonly catalog: Catalog;
  readonly worlds: readonly CoverageWorld[];
  /** The place of each class. The default is `STANDARD_CLASS_PLACES`. */
  readonly places?: Readonly<Record<string, ClassPlace>> | undefined;
}

const CONTROL = "none";

/** This function gives the cell of one hypothesis in one world. A world with no trait of `needs` has no case of the hypothesis. */
function cellOf(world: CoverageWorld, hypothesis: string, needs: readonly WorldTrait[]): WorldCell {
  const able = needs.every((trait) => world.traits.includes(trait));
  const cases = able ? world.cases.filter((each) => each.truth === hypothesis) : [];
  const key = (each: CoverageCase): string => (world.scores === "class" ? each.truth : each.id);
  const bar = cases.length > 0 && cases.every((each) => world.bars[key(each)] !== undefined);
  return { world: world.id, cases: cases.map((each) => each.id), bar };
}

/**
 * This function joins the fault classes of a catalog with the cases of each world. It gives a row for each class, the
 * cell of the control in each world, the gaps, and the problems of the data.
 *
 * A case for a class needs each trait of the class in its world. Else the case does not count, and a problem tells it.
 */
export function coverage(input: CoverageInput): Coverage {
  const { catalog, worlds } = input;
  const places = input.places ?? STANDARD_CLASS_PLACES;
  const problems: string[] = [];
  const hypotheses = new Set(catalog.hypotheses.map((each) => each.id));
  const faults = catalog.hypotheses.filter((each) => each.kind === "fault").map((each) => each.id);
  for (const world of worlds) {
    for (const each of world.cases) {
      if (!hypotheses.has(each.truth)) problems.push(`The case ${each.id} of the world ${world.id} has the truth ${each.truth}, and the catalog has no such hypothesis.`);
      const missing = (places[each.truth]?.needs ?? []).filter((trait) => !world.traits.includes(trait));
      if (missing.length > 0) problems.push(`The case ${each.id} of the world ${world.id} needs ${missing.map((trait) => TRAIT_NAMES[trait]).join(", ")}, and the world does not have it.`);
    }
  }
  for (const id of faults) if (places[id] === undefined) problems.push(`The class ${id} has no place, so it has no layer.`);
  for (const id of Object.keys(places)) if (!faults.includes(id)) problems.push(`The place of ${id} is not for a fault class of the catalog ${catalog.version}.`);

  const rank = (id: string): number => {
    const layer = places[id]?.layer;
    return layer === undefined ? LAYERS.length : layerRank(layer);
  };
  const ordered = faults.map((id, order) => ({ id, order })).sort((a, b) => rank(a.id) - rank(b.id) || a.order - b.order);
  const rows: CoverageRow[] = ordered.map(({ id }) => {
    const place = places[id];
    const needs = place?.needs ?? [];
    const cells = worlds.map((world) => cellOf(world, id, needs));
    const state: ClassState = cells.some((cell) => cell.bar) ? "covered" : cells.some((cell) => cell.cases.length > 0) ? "no-bar" : "no-case";
    return { hypothesis: id, layer: place?.layer, needs, worlds: cells, state };
  });
  const noCase: CaseGap[] = rows
    .filter((row) => row.state === "no-case")
    .map((row) => ({
      hypothesis: row.hypothesis,
      layer: row.layer,
      needs: row.needs,
      able: worlds.filter((world) => row.needs.every((trait) => world.traits.includes(trait))).map((world) => world.id),
    }));
  const caseLayers = new Set(rows.filter((row) => row.state !== "no-case").map((row) => row.layer));
  return {
    worlds: worlds.map(({ id, name, scores }) => ({ id, name, scores })),
    rows,
    controls: worlds.map((world) => cellOf(world, CONTROL, [])),
    gaps: {
      noCase,
      noBar: rows.filter((row) => row.state === "no-bar").map((row) => row.hypothesis),
      layers: LAYERS.filter((layer) => !caseLayers.has(layer)),
    },
    problems,
  };
}

const code = (text: string): string => `\`${text}\``;
const codes = (texts: readonly string[]): string => texts.map(code).join(", ");

/** This function gives the text of a cell: the number of cases and the bar, or a dash for no case. */
function cellText(cell: WorldCell): string {
  if (cell.cases.length === 0) return "–";
  return `${countOf(cell.cases.length, "case")}, ${cell.bar ? "a bar" : "no bar"}`;
}

/** This function gives the text of the state of a row. A gap starts with the word "Gap". */
function stateText(row: CoverageRow, gaps: CoverageGaps, worlds: readonly CoverageWorldName[]): string {
  if (row.state === "covered") return "Covered";
  if (row.state === "no-bar") return "Gap: no bar";
  const gap = gaps.noCase.find((each) => each.hypothesis === row.hypothesis);
  if (gap === undefined || gap.needs.length === 0) return "Gap: no case";
  const needs = gap.needs.map((trait) => TRAIT_NAMES[trait]).join(" and ");
  if (gap.able.length === 0) return `Gap: no case. No world has ${needs}.`;
  const names = gap.able.map((id) => worlds.find((world) => world.id === id)?.name ?? id);
  return `Gap: no case. ${names.join(", ")} ${gap.able.length === 1 ? "has" : "have"} ${needs}.`;
}

/**
 * This function gives the coverage as Markdown: a table with one row for each class, and a list of the counts and the
 * gaps. The table names each gap as a gap. A class with no case does not show as covered.
 */
export function coverageMarkdown(result: Coverage): string {
  const { worlds, rows, gaps } = result;
  const lines = [
    `| Class | Layer | ${worlds.map((world) => world.name).join(" | ")} | Coverage |`,
    `| --- | --- | ${worlds.map(() => "---").join(" | ")} | --- |`,
  ];
  for (const row of rows) {
    lines.push(`| ${code(row.hypothesis)} | ${row.layer === undefined ? "–" : code(row.layer)} | ${row.worlds.map(cellText).join(" | ")} | ${stateText(row, gaps, worlds)} |`);
  }
  const covered = rows.filter((row) => row.state === "covered").length;
  lines.push(
    "",
    `- The catalog has ${countOf(rows.length, "fault class", "fault classes")}. ${covered} are covered, ${gaps.noBar.length} have a case and no bar, and ${gaps.noCase.length} have no case.`,
  );
  if (gaps.noCase.length > 0) lines.push(`- The classes with no case: ${codes(gaps.noCase.map((gap) => gap.hypothesis))}.`);
  if (gaps.noBar.length > 0) lines.push(`- The classes with a case and no bar: ${codes(gaps.noBar)}.`);
  lines.push(gaps.layers.length > 0 ? `- The layers with no case: ${codes(gaps.layers)}.` : "- Each layer has a case.");
  const controls = result.controls.map((cell, at) => `${worlds[at]?.name ?? cell.world}: ${cellText(cell)}`);
  lines.push(`- The control ${code(CONTROL)}. ${controls.join(". ")}.`);
  for (const problem of result.problems) lines.push(`- A problem of the data: ${problem}`);
  return `${lines.join("\n")}\n`;
}

/** This function gives the part of the roadmap between the marker lines: the Markdown of the coverage, with a blank line before and after it. */
export function roadmapPart(result: Coverage): string {
  return `\n${coverageMarkdown(result)}\n`;
}

/** The line before the part of a file that `coverage-main.ts` writes. */
export const COVERAGE_START = "<!-- coverage:start. The command `pnpm --filter @netdiag/lab roadmap` writes this part. Do not edit it. -->";
/** The line after the part of a file that `coverage-main.ts` writes. */
export const COVERAGE_END = "<!-- coverage:end -->";

/** This function gives the text between the two marker lines of a file, or `undefined` when the file has no such pair. */
export function markedPart(text: string, start: string = COVERAGE_START, end: string = COVERAGE_END): string | undefined {
  const from = text.indexOf(`${start}\n`);
  const to = text.indexOf(`\n${end}`, from);
  if (from < 0 || to < 0 || text.indexOf(`${start}\n`, from + 1) >= 0) return undefined;
  return text.slice(from + start.length + 1, to + 1);
}

/** This function puts a part between the two marker lines of a file. It gives `undefined` when the file has no such pair. */
export function withMarkedPart(text: string, part: string, start: string = COVERAGE_START, end: string = COVERAGE_END): string | undefined {
  const old = markedPart(text, start, end);
  if (old === undefined) return undefined;
  const from = text.indexOf(`${start}\n`) + start.length + 1;
  return text.slice(0, from) + part + text.slice(from + old.length);
}
