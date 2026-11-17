import { LAYERS, layerRank, type Catalog, type LabBars, type Layer } from "@mark1russell7/netdiag";
import { countOf } from "@mark1russell7/text";
import { ATLAS_WORLDS, ATLAS_WORLD_NAMES, type AtlasEntry, type AtlasWorld } from "./atlas.ts";

// The coverage of the fault classes (ND-17, step 1). The query joins the classes of a catalog with the cases of each
// world. It gives the gaps as data: a class with no case, a class with a case and no bar, and a layer with no case.
// A gap is not a pass. The query also joins the fault atlas (`atlas.ts`) with the rows: a fault with no class is a
// gap of the catalog, and a class with no case is a gap of the labs. This module imports no `node:` module. The
// module `worlds.ts` gives the worlds of the lab.

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
  /** The join of the fault atlas with the rows. It is absent when the input has no atlas. */
  readonly atlas: AtlasCoverage | undefined;
  /** The problems of the data: for example a case with a truth that is not in the catalog. */
  readonly problems: readonly string[];
}

/** The input of the coverage query. */
export interface CoverageInput {
  readonly catalog: Catalog;
  readonly worlds: readonly CoverageWorld[];
  /** The place of each class. The default is `STANDARD_CLASS_PLACES`. */
  readonly places?: Readonly<Record<string, ClassPlace>> | undefined;
  /** The entries of the fault atlas, for example `FAULT_ATLAS`. With no atlas, the result has no atlas part. */
  readonly atlas?: readonly AtlasEntry[] | undefined;
}

const CONTROL = "none";

/** This function gives the state of a class from its cells. A cell with a bar gives covered. Else a cell with a case gives no-bar. */
function stateOf(cells: readonly WorldCell[]): ClassState {
  return cells.some((cell) => cell.bar) ? "covered" : cells.some((cell) => cell.cases.length > 0) ? "no-bar" : "no-case";
}

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
    return { hypothesis: id, layer: place?.layer, needs, worlds: cells, state: stateOf(cells) };
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
    atlas: input.atlas === undefined ? undefined : atlasCoverage(input.atlas, { catalog, worlds, places, rows, problems }),
    problems,
  };
}

/**
 * The state of an entry of the fault atlas.
 *
 * - `covered`, `no-bar` and `no-case`: the state of the class of the entry in the worlds with the traits of the entry.
 * - `no-class`: the catalog has no class for the fault. This is a gap of the catalog.
 */
export type AtlasState = ClassState | "no-class";

/** An entry of the fault atlas, joined with the rows of the coverage. */
export interface AtlasRow {
  readonly id: string;
  readonly layer: Layer;
  readonly hypothesis: string | null;
  readonly proposal: string | undefined;
  /** The traits of the entry and of its class. */
  readonly needs: readonly WorldTrait[];
  readonly world: AtlasWorld;
  readonly state: AtlasState;
}

/** The counts of the entries of a part of the atlas, by state. */
export interface AtlasCounts {
  readonly entries: number;
  readonly covered: number;
  readonly noBar: number;
  readonly noCase: number;
  readonly noClass: number;
}

/** The counts of the entries of one layer. */
export interface AtlasLayerCounts extends AtlasCounts {
  readonly layer: Layer;
}

/** The counts of the entries of one world of the atlas. */
export interface AtlasWorldCounts extends AtlasCounts {
  readonly world: AtlasWorld;
}

/** A class that the atlas proposes for the catalog, with the entries that propose it. */
export interface AtlasProposal {
  readonly proposal: string;
  /** The layer of the first entry that proposes the class. */
  readonly layer: Layer;
  readonly entries: readonly string[];
  /** The worlds of the entries, in the order of `ATLAS_WORLDS`. */
  readonly worlds: readonly AtlasWorld[];
}

/** The join of the fault atlas with the rows of the coverage. */
export interface AtlasCoverage {
  /** One row for each entry, in the order of the layers, then in the order of the atlas. */
  readonly rows: readonly AtlasRow[];
  /** The counts of each layer of `LAYERS`, in its order. */
  readonly layers: readonly AtlasLayerCounts[];
  /** The counts of each world of `ATLAS_WORLDS`, in its order. */
  readonly worlds: readonly AtlasWorldCounts[];
  readonly total: AtlasCounts;
  /** The classes that the entries with no class propose, in the order of the rows. */
  readonly proposals: readonly AtlasProposal[];
}

/** The parts of the coverage that the join of the atlas reads. The join adds its problems to `problems`. */
interface AtlasContext {
  readonly catalog: Catalog;
  readonly worlds: readonly CoverageWorld[];
  readonly places: Readonly<Record<string, ClassPlace>>;
  readonly rows: readonly CoverageRow[];
  readonly problems: string[];
}

/** This function tells the problems of the entries of an atlas: for example a class that is not in the catalog. */
function atlasProblems(atlas: readonly AtlasEntry[], context: AtlasContext): void {
  const { catalog, places, rows, problems } = context;
  const hypotheses = new Set(catalog.hypotheses.map((each) => each.id));
  const faults = new Set(rows.map((row) => row.hypothesis));
  const seen = new Set<string>();
  for (const entry of atlas) {
    if (seen.has(entry.id)) problems.push(`The atlas has the entry ${entry.id} more than once.`);
    seen.add(entry.id);
    if (hypotheses.has(entry.id)) problems.push(`The atlas entry ${entry.id} has the id of a hypothesis of the catalog.`);
    if (entry.signs.length === 0) problems.push(`The atlas entry ${entry.id} has no sign.`);
    if (entry.sources.length === 0) problems.push(`The atlas entry ${entry.id} has no source.`);
    if (entry.hypothesis === null) {
      if (entry.proposal === undefined) problems.push(`The atlas entry ${entry.id} has no class and no proposal.`);
      else if (hypotheses.has(entry.proposal)) problems.push(`The atlas entry ${entry.id} proposes ${entry.proposal}, and the catalog has it. Name it as the class of the entry.`);
      continue;
    }
    if (entry.proposal !== undefined) problems.push(`The atlas entry ${entry.id} has a class and a proposal.`);
    if (!faults.has(entry.hypothesis)) problems.push(`The atlas entry ${entry.id} names ${entry.hypothesis}, and the catalog has no such fault class.`);
    const layer = places[entry.hypothesis]?.layer;
    if (layer !== undefined && layer !== entry.layer) problems.push(`The atlas entry ${entry.id} has the layer ${entry.layer}, and its class ${entry.hypothesis} has the layer ${layer}.`);
  }
  const named = new Set(atlas.map((entry) => entry.hypothesis));
  for (const row of rows) if (!named.has(row.hypothesis)) problems.push(`The class ${row.hypothesis} has no entry in the atlas.`);
}

/** This function counts the rows of the atlas by state. */
function countsOf(rows: readonly AtlasRow[]): AtlasCounts {
  const of = (state: AtlasState): number => rows.filter((row) => row.state === state).length;
  return { entries: rows.length, covered: of("covered"), noBar: of("no-bar"), noCase: of("no-case"), noClass: of("no-class") };
}

/**
 * This function joins the entries of the fault atlas with the rows of the coverage. An entry with no class is a gap of
 * the catalog. An entry of a class with no case, in the worlds with its traits, is a gap of the labs.
 */
function atlasCoverage(atlas: readonly AtlasEntry[], context: AtlasContext): AtlasCoverage {
  atlasProblems(atlas, context);
  const { worlds, places } = context;
  const faults = new Set(context.rows.map((row) => row.hypothesis));
  const rows: AtlasRow[] = atlas
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => layerRank(a.entry.layer) - layerRank(b.entry.layer) || a.order - b.order)
    .map(({ entry }) => {
      const hypothesis = entry.hypothesis;
      const needs = [...new Set([...(hypothesis === null ? [] : (places[hypothesis]?.needs ?? [])), ...(entry.needs ?? [])])];
      const state: AtlasState = hypothesis === null || !faults.has(hypothesis) ? "no-class" : stateOf(worlds.map((world) => cellOf(world, hypothesis, needs)));
      return { id: entry.id, layer: entry.layer, hypothesis, proposal: entry.proposal, needs, world: entry.world, state };
    });
  const proposals = new Map<string, AtlasRow[]>();
  for (const row of rows) {
    if (row.state !== "no-class" || row.proposal === undefined) continue;
    proposals.set(row.proposal, [...(proposals.get(row.proposal) ?? []), row]);
  }
  return {
    rows,
    layers: LAYERS.map((layer) => ({ layer, ...countsOf(rows.filter((row) => row.layer === layer)) })),
    worlds: ATLAS_WORLDS.map((world) => ({ world, ...countsOf(rows.filter((row) => row.world === world)) })),
    total: countsOf(rows),
    proposals: [...proposals].map(([proposal, entries]) => ({
      proposal,
      layer: entries[0]?.layer ?? "link",
      entries: entries.map((row) => row.id),
      worlds: ATLAS_WORLDS.filter((world) => entries.some((row) => row.world === world)),
    })),
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

/** This function gives one line of a table of counts of the atlas. */
function countsLine(head: string, counts: AtlasCounts): string {
  return `| ${head} | ${counts.entries} | ${counts.covered} | ${counts.noBar} | ${counts.noCase} | ${counts.noClass} |`;
}

const COUNTS_HEAD = "| Entries | Covered | Gap: no bar | Gap: no case | Gap: no class |";
const COUNTS_RULE = "| --- | --- | --- | --- | --- | --- |";

/**
 * This function gives the join of the atlas as Markdown. It gives the counts by layer and by world, and the gaps of the
 * labs. It also gives the classes that the atlas proposes for the catalog.
 */
export function atlasMarkdown(atlas: AtlasCoverage): string {
  const world = (id: AtlasWorld): string => ATLAS_WORLD_NAMES[id];
  const lines = [`| Layer ${COUNTS_HEAD}`, COUNTS_RULE];
  for (const each of atlas.layers) lines.push(countsLine(code(each.layer), each));
  lines.push(countsLine("All", atlas.total), "", `| World ${COUNTS_HEAD}`, COUNTS_RULE);
  for (const each of atlas.worlds) lines.push(countsLine(world(each.world), each));
  const { total } = atlas;
  lines.push(
    "",
    `- The atlas has ${countOf(total.entries, "entry", "entries")}. ${total.entries - total.noClass} name a class of the catalog, and ${total.noClass} have no class.`,
  );
  const gaps = (state: AtlasState): string =>
    atlas.rows
      .filter((row) => row.state === state)
      .map((row) => `${code(row.id)} (${code(row.hypothesis ?? "")}, ${world(row.world)})`)
      .join(", ");
  if (total.noCase > 0) lines.push(`- The gaps of the labs, an entry of a class with no case: ${gaps("no-case")}.`);
  if (total.noBar > 0) lines.push(`- The gaps of the bars, an entry of a class with a case and no bar: ${gaps("no-bar")}.`);
  if (atlas.proposals.length > 0) {
    lines.push(`- The gaps of the catalog. The atlas proposes ${countOf(atlas.proposals.length, "class", "classes")}:`);
    for (const each of atlas.proposals) lines.push(`  - ${code(each.proposal)} (${code(each.layer)}, ${each.worlds.map(world).join(", ")}): ${codes(each.entries)}.`);
  }
  return `${lines.join("\n")}\n`;
}

/** The line before the part of the atlas in a file that `coverage-main.ts` writes. */
export const ATLAS_START = "<!-- atlas:start. The command `pnpm --filter @netdiag/lab roadmap` writes this part. Do not edit it. -->";
/** The line after the part of the atlas in a file that `coverage-main.ts` writes. */
export const ATLAS_END = "<!-- atlas:end -->";

/** This function gives the part of the roadmap between the marker lines of the atlas, with a blank line before and after it. */
export function atlasPart(atlas: AtlasCoverage): string {
  return `\n${atlasMarkdown(atlas)}\n`;
}

/**
 * This function puts the table of the coverage, and the tables of the atlas when the result has an atlas, between
 * their marker lines. It gives `undefined` when the file has no pair of marker lines for a part.
 */
export function withRoadmapParts(text: string, result: Coverage): string | undefined {
  const next = withMarkedPart(text, roadmapPart(result));
  if (next === undefined || result.atlas === undefined) return next;
  return withMarkedPart(next, atlasPart(result.atlas), ATLAS_START, ATLAS_END);
}
