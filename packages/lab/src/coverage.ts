import { LAYERS, STANDARD_FAULTS, layerRank, type Catalog, type LabBars, type Layer } from "@mark1russell7/netdiag/core";
import { countOf } from "@mark1russell7/text";
import { ATLAS_WORLDS, ATLAS_WORLD_NAMES, type AtlasEntry, type AtlasWorld } from "./atlas.ts";
import {
  GRAMMAR_CLASSES,
  GRAMMAR_END,
  GRAMMAR_OPTIONS,
  GRAMMAR_START,
  grammarNeeds,
  grammarPart,
  optionId,
  sharedNeeds,
  termClasses,
  termNeeds,
  termProblems,
  type GrammarClass,
} from "./grammar.ts";
import { LAB_LAYERS, LAYER_FACTS, LAYER_LIMITS, LAYER_STATE_TEXT, S7_LAYERS_URL, type LabLayer, type LayerFacts, type LayerLimit } from "./ladder.ts";

// The coverage of the fault classes (ND-17). The query joins the classes of a catalog with the cases of each world.
// It gives the gaps as data: a class with no case, a class with a case and no bar, and a layer with no case. A gap
// is not a pass. The query also joins the fault atlas (`atlas.ts`) with the rows: a fault with no class is a gap of
// the catalog, and a class with no case is a gap of the labs. The ladder of the query gives one cell for each class
// on each layer E0 to E6 of the lab (`ladder.ts`). The work ends only at zero gaps. This module imports no `node:`
// module itself, but the harness of `ladder.ts` does. The module `worlds.ts` gives the worlds of the lab.

/**
 * A trait of the networks of a world. A case of some classes needs a trait. A layer of the ladder cannot ever have
 * some traits (`LAYER_LIMITS`).
 *
 * - `ipv6`: the networks of the world have IPv6.
 * - `wifi`: the client has a Wi-Fi link.
 * - `link`: a case can take the link of the client down.
 * - `routing`: the routers of the world use a routing protocol between them.
 * - `kernel`: each node of the world has a kernel of its own.
 * - `clock`: each node of the world has a clock of its own.
 * - `power`: a case can cut the power of a node, or reboot it.
 * - `nic`: the world has a physical NIC and its firmware.
 * - `zones`: the world has the real zones of a cloud.
 * - `forwarding`: the routers of the world have their own forwarding hardware.
 */
export type WorldTrait = "ipv6" | "wifi" | "link" | "routing" | "kernel" | "clock" | "power" | "nic" | "zones" | "forwarding";

/** The name of each trait, for a sentence of the table. */
export const TRAIT_NAMES: Readonly<Record<WorldTrait, string>> = {
  ipv6: "IPv6",
  wifi: "a Wi-Fi link",
  link: "a link that a case can take down",
  routing: "a routing protocol between routers",
  kernel: "a kernel of its own for each node",
  clock: "a clock of its own for each node",
  power: "a loss of power or a reboot",
  nic: "a physical NIC or its firmware",
  zones: "the real zones of a cloud",
  forwarding: "the forwarding hardware of a router",
};

/**
 * The traits that a world needs for a case of each fault class of the standard catalog. The fault grammar gives them:
 * a class needs each trait that each of its terms needs. A class with no entry needs no trait.
 */
export const STANDARD_CLASS_NEEDS: Readonly<Record<string, readonly WorldTrait[]>> = grammarNeeds(STANDARD_FAULTS.map((each) => each.id));

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

/** A world of the lab, as data: its layer, its traits, its cases and the bars of its gate. A new world is one more entry. */
export interface CoverageWorld {
  readonly id: string;
  /** The name of the world, for the heading of its column. */
  readonly name: string;
  /** The layer of the ladder of the world, for example `E1` for processes and containers on one kernel. */
  readonly layer: LabLayer;
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
 * - `covered`: a world has a case of the class and a bar above 0 for it.
 * - `no-bar`: a world has a case of the class, and no world has a bar above 0 for it.
 * - `no-case`: no world has a case of the class.
 */
export type ClassState = "covered" | "no-bar" | "no-case";

/** A row of the coverage: one fault class of the catalog, its layer, and its cell in each world. */
export interface CoverageRow {
  readonly hypothesis: string;
  /** The layer is absent when the catalog gives no layer for the class. The problems then tell it. */
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
  readonly layer: LabLayer;
  readonly scores: WorldScore;
}

/**
 * The state of a cell of the ladder: one class on one layer of the lab.
 *
 * - `covered`: a world of the layer has a case of the class, and a bar above 0 for it.
 * - `no-bar`: a world of the layer has a case of the class, and no world of the layer has a bar above 0 for it.
 * - `gap`: no world of the layer has a case of the class.
 * - `impossible`: the class needs a trait that the layer cannot ever have.
 * - `no-class`: the class is a proposal of the atlas, and the catalog does not have it.
 *
 * The states `no-bar`, `gap` and `no-class` are gaps. A case with no bar is a gap, because a gate holds each gain.
 */
export type LadderState = "covered" | "no-bar" | "gap" | "impossible" | "no-class";

/** The states of the ladder, in the order of the key. */
export const LADDER_STATES: readonly LadderState[] = ["covered", "no-bar", "gap", "no-class", "impossible"];

/** The states of the ladder that are gaps. */
export const GAP_STATES: readonly LadderState[] = ["no-bar", "gap", "no-class"];

/** The mark and the name of a state of the ladder. The mark is text, because a color alone does not tell the state. */
export interface StateKey {
  readonly mark: string;
  readonly name: string;
}

/** The mark and the name of each state of the ladder. */
export const STATE_KEYS: Readonly<Record<LadderState, StateKey>> = {
  covered: { mark: "✓", name: "Covered" },
  "no-bar": { mark: "◐", name: "A gap: a case and no bar" },
  gap: { mark: "○", name: "A gap: no case" },
  "no-class": { mark: "◌", name: "A gap: no class in the catalog" },
  impossible: { mark: "⊘", name: "Impossible on the layer" },
};

/** A cell of the ladder: one class on one layer. */
export interface LadderCell {
  readonly layer: LabLayer;
  readonly state: LadderState;
  /** The cells of the worlds of the layer with a case of the class, in the order of the worlds. */
  readonly worlds: readonly WorldCell[];
  /** For an impossible cell: each limit of the layer with a trait that the class needs. Else the list is empty. */
  readonly limits: readonly LayerLimit[];
}

/** The kind of a row of the ladder: a fault class of the catalog, or a class that the grammar or the atlas proposes. */
export type LadderKind = "class" | "proposal";

/** A row of the ladder: one class, and its cell on each layer. */
export interface LadderRow {
  readonly id: string;
  readonly kind: LadderKind;
  /** The layer of netdiag of the class. It is absent when the catalog gives no layer for the class. */
  readonly layer: Layer | undefined;
  readonly needs: readonly WorldTrait[];
  /** For a proposed class: the ids of the atlas entries that propose it, or none. For a class of the catalog, the list is empty. */
  readonly entries: readonly string[];
  /** The ids of the options of the fault grammar that give the class. The list is empty when the grammar does not give the class. */
  readonly options: readonly string[];
  /** One cell for each layer of `LAB_LAYERS`, in its order. */
  readonly cells: readonly LadderCell[];
}

/** The counts of the cells of a part of the ladder, by state. */
export interface LadderCounts {
  readonly cells: number;
  readonly covered: number;
  readonly noBar: number;
  readonly gap: number;
  readonly noClass: number;
  readonly impossible: number;
  /** The cells that are gaps: `noBar`, `gap` and `noClass` together. */
  readonly gaps: number;
}

/** The ladder: each class on each layer E0 to E6 of the lab. The work ends only at zero gaps. */
export interface Ladder {
  /** The layers of the columns: `LAB_LAYERS` of the harness. */
  readonly layers: readonly LabLayer[];
  /** The rows of the classes of the catalog, in the order of `rows`, then the rows of the proposed classes. */
  readonly rows: readonly LadderRow[];
  readonly classes: LadderCounts;
  readonly proposals: LadderCounts;
  readonly total: LadderCounts;
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
  /** Each class on each layer of the lab. With an atlas, it also has a row for each proposed class. */
  readonly ladder: Ladder;
  /** The problems of the data: for example a case with a truth that is not in the catalog. */
  readonly problems: readonly string[];
}

/** The input of the coverage query. */
export interface CoverageInput {
  readonly catalog: Catalog;
  readonly worlds: readonly CoverageWorld[];
  /** The traits that a world needs for a case of each class. The default comes from the classes of the grammar. */
  readonly needs?: Readonly<Record<string, readonly WorldTrait[]>> | undefined;
  /** The classes of the fault grammar. The ladder proposes each class that the catalog does not have. The default is `GRAMMAR_CLASSES`. */
  readonly classes?: readonly GrammarClass[] | undefined;
  /** The entries of the fault atlas, for example `FAULT_ATLAS`. With no atlas, the result has no atlas part. */
  readonly atlas?: readonly AtlasEntry[] | undefined;
  /** The traits that each layer cannot ever have. The default is `LAYER_LIMITS`. */
  readonly limits?: Readonly<Record<LabLayer, readonly LayerLimit[]>> | undefined;
}

const CONTROL = "none";

/** This function gives the layer of each fault class of a catalog. */
function layersOf(catalog: Catalog): ReadonlyMap<string, Layer> {
  return new Map(catalog.hypotheses.flatMap((each) => (each.kind === "fault" && each.layer !== undefined ? [[each.id, each.layer] as const] : [])));
}

/** This function gives the state of a class from its cells. A cell with a bar gives covered. Else a cell with a case gives no-bar. */
function stateOf(cells: readonly WorldCell[]): ClassState {
  return cells.some((cell) => cell.bar) ? "covered" : cells.some((cell) => cell.cases.length > 0) ? "no-bar" : "no-case";
}

/** This function gives the cell of one hypothesis in one world. A world with no trait of `needs` has no case of the hypothesis. */
function cellOf(world: CoverageWorld, hypothesis: string, needs: readonly WorldTrait[]): WorldCell {
  const able = needs.every((trait) => world.traits.includes(trait));
  const cases = able ? world.cases.filter((each) => each.truth === hypothesis) : [];
  const key = (each: CoverageCase): string => (world.scores === "class" ? each.truth : each.id);
  // A bar of 0 holds nothing, so only a bar above 0 counts.
  const bar = cases.length > 0 && cases.every((each) => (world.bars[key(each)] ?? 0) > 0);
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
  const classes = input.classes ?? GRAMMAR_CLASSES;
  const layers = layersOf(catalog);
  const problems: string[] = [];
  const hypotheses = new Set(catalog.hypotheses.map((each) => each.id));
  const faults = catalog.hypotheses.filter((each) => each.kind === "fault").map((each) => each.id);
  const needsOf = input.needs ?? grammarNeeds(faults, classes);
  for (const world of worlds) {
    for (const each of world.cases) {
      if (!hypotheses.has(each.truth)) problems.push(`The case ${each.id} of the world ${world.id} has the truth ${each.truth}, and the catalog has no such hypothesis.`);
      const missing = (needsOf[each.truth] ?? []).filter((trait) => !world.traits.includes(trait));
      if (missing.length > 0) problems.push(`The case ${each.id} of the world ${world.id} needs ${missing.map((trait) => TRAIT_NAMES[trait]).join(", ")}, and the world does not have it.`);
    }
  }
  for (const id of faults) if (layers.get(id) === undefined) problems.push(`The class ${id} has no layer in the catalog.`);
  for (const id of Object.keys(needsOf)) if (!faults.includes(id)) problems.push(`The needs of ${id} are not for a fault class of the catalog ${catalog.version}.`);

  const rank = (id: string): number => {
    const layer = layers.get(id);
    return layer === undefined ? LAYERS.length : layerRank(layer);
  };
  const ordered = faults.map((id, order) => ({ id, order })).sort((a, b) => rank(a.id) - rank(b.id) || a.order - b.order);
  const rows: CoverageRow[] = ordered.map(({ id }) => {
    const needs = needsOf[id] ?? [];
    const cells = worlds.map((world) => cellOf(world, id, needs));
    return { hypothesis: id, layer: layers.get(id), needs, worlds: cells, state: stateOf(cells) };
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
  const atlas = input.atlas === undefined ? undefined : atlasCoverage(input.atlas, { catalog, worlds, needs: needsOf, classes, layers, rows, problems });
  const limits = input.limits ?? LAYER_LIMITS;
  ladderProblems(worlds, limits, problems);
  return {
    worlds: worlds.map(({ id, name, layer, scores }) => ({ id, name, layer, scores })),
    rows,
    controls: worlds.map((world) => cellOf(world, CONTROL, [])),
    gaps: {
      noCase,
      noBar: rows.filter((row) => row.state === "no-bar").map((row) => row.hypothesis),
      layers: LAYERS.filter((layer) => !caseLayers.has(layer)),
    },
    atlas,
    ladder: ladderOf(rows, proposalsOf(classes, faults, atlas, problems), classes, worlds, limits),
    problems,
  };
}

/** This function tells the problems of the layers of the worlds. A world must be on a layer of the ladder, with no trait that its layer cannot have. */
function ladderProblems(worlds: readonly CoverageWorld[], limits: Readonly<Record<LabLayer, readonly LayerLimit[]>>, problems: string[]): void {
  for (const world of worlds) {
    if (!LAB_LAYERS.includes(world.layer)) {
      problems.push(`The world ${world.id} has the layer ${world.layer}, and the ladder has no such layer.`);
      continue;
    }
    for (const each of limits[world.layer]) {
      if (world.traits.includes(each.trait)) problems.push(`The world ${world.id} has ${TRAIT_NAMES[each.trait]}, and its layer ${world.layer} cannot have it: ${each.reason}.`);
    }
  }
}

/** This function gives the limits of a layer that meet the needs of a class. A class with such a limit is impossible on the layer. */
function limitsOf(layer: LabLayer, needs: readonly WorldTrait[], limits: Readonly<Record<LabLayer, readonly LayerLimit[]>>): readonly LayerLimit[] {
  return limits[layer].filter((each) => needs.includes(each.trait));
}

/** This function counts the cells of some rows of the ladder by state. */
function ladderCounts(rows: readonly LadderRow[]): LadderCounts {
  const cells = rows.flatMap((row) => row.cells);
  const of = (state: LadderState): number => cells.filter((cell) => cell.state === state).length;
  const counts = { covered: of("covered"), noBar: of("no-bar"), gap: of("gap"), noClass: of("no-class"), impossible: of("impossible") };
  return { cells: cells.length, ...counts, gaps: counts.noBar + counts.gap + counts.noClass };
}

/** A class that the ladder proposes for the catalog: a class of the grammar, or a proposal of the atlas. */
interface LadderProposal {
  readonly id: string;
  readonly layer: Layer;
  readonly needs: readonly WorldTrait[];
  readonly entries: readonly string[];
  readonly options: readonly string[];
}

/**
 * This function gives the classes that the ladder proposes. They are the classes of the grammar that the catalog does
 * not have, in the order of the grammar. A proposal of the atlas that the grammar does not give comes after them, with a problem.
 * The needs of such a proposal are the traits that each of its entries needs.
 */
function proposalsOf(classes: readonly GrammarClass[], faults: readonly string[], atlas: AtlasCoverage | undefined, problems: string[]): readonly LadderProposal[] {
  const entriesOf = (id: string): readonly string[] => atlas?.proposals.find((each) => each.proposal === id)?.entries ?? [];
  const proposals: LadderProposal[] = classes
    .filter((each) => !faults.includes(each.id))
    .map((each) => ({ id: each.id, layer: each.layer, needs: each.needs, entries: entriesOf(each.id), options: each.options }));
  for (const each of atlas?.proposals ?? []) {
    // A proposal of a class of the catalog is a problem of the atlas, and the ladder has its row of the class.
    if (faults.includes(each.proposal) || proposals.some((proposal) => proposal.id === each.proposal)) continue;
    problems.push(`The atlas proposes ${each.proposal}, and the fault grammar gives no such class.`);
    const needs = sharedNeeds(atlas?.rows.filter((row) => each.entries.includes(row.id)).map((row) => row.needs) ?? []);
    proposals.push({ id: each.proposal, layer: each.layer, needs, entries: each.entries, options: [] });
  }
  return proposals;
}

/**
 * This function gives the ladder: a cell for each class on each layer of `LAB_LAYERS`. A cell is impossible when the
 * class needs a trait that the layer cannot have. Else the worlds of the layer give its state. A proposed class has no
 * case, so each cell of it that is not impossible is a gap of the catalog.
 */
function ladderOf(
  rows: readonly CoverageRow[],
  proposed: readonly LadderProposal[],
  grammar: readonly GrammarClass[],
  worlds: readonly CoverageWorld[],
  limits: Readonly<Record<LabLayer, readonly LayerLimit[]>>,
): Ladder {
  const classes: LadderRow[] = rows.map((row) => ({
    id: row.hypothesis,
    kind: "class",
    layer: row.layer,
    needs: row.needs,
    entries: [],
    options: grammar.find((each) => each.id === row.hypothesis)?.options ?? [],
    cells: LAB_LAYERS.map((layer): LadderCell => {
      const hits = limitsOf(layer, row.needs, limits);
      if (hits.length > 0) return { layer, state: "impossible", worlds: [], limits: hits };
      const cells = row.worlds.filter((cell, at) => worlds[at]?.layer === layer && cell.cases.length > 0);
      const state: LadderState = cells.some((cell) => cell.bar) ? "covered" : cells.length > 0 ? "no-bar" : "gap";
      return { layer, state, worlds: cells, limits: [] };
    }),
  }));
  const proposals: LadderRow[] = proposed.map((proposal) => ({
    id: proposal.id,
    kind: "proposal",
    layer: proposal.layer,
    needs: proposal.needs,
    entries: proposal.entries,
    options: proposal.options,
    cells: LAB_LAYERS.map((layer): LadderCell => {
      const hits = limitsOf(layer, proposal.needs, limits);
      return { layer, state: hits.length > 0 ? "impossible" : "no-class", worlds: [], limits: hits };
    }),
  }));
  return {
    layers: LAB_LAYERS,
    rows: [...classes, ...proposals],
    classes: ladderCounts(classes),
    proposals: ladderCounts(proposals),
    total: ladderCounts([...classes, ...proposals]),
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
  /** The traits of the term of the entry and of its class, in their sorted order. */
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
  readonly needs: Readonly<Record<string, readonly WorldTrait[]>>;
  readonly classes: readonly GrammarClass[];
  readonly layers: ReadonlyMap<string, Layer>;
  readonly rows: readonly CoverageRow[];
  readonly problems: string[];
}

/** This function tells the problems of the entries of an atlas: for example a class that is not in the catalog. */
function atlasProblems(atlas: readonly AtlasEntry[], context: AtlasContext): void {
  const { catalog, classes, layers, rows, problems } = context;
  const hypotheses = new Set(catalog.hypotheses.map((each) => each.id));
  const faults = new Set(rows.map((row) => row.hypothesis));
  const seen = new Set<string>();
  for (const entry of atlas) {
    if (seen.has(entry.id)) problems.push(`The atlas has the entry ${entry.id} more than once.`);
    seen.add(entry.id);
    const broken = termProblems(entry.term);
    for (const problem of broken) problems.push(`The term of the atlas entry ${entry.id} breaks the grammar: ${problem}`);
    const label = entry.hypothesis ?? entry.proposal;
    const labels = broken.length === 0 ? termClasses(entry.term) : [];
    if (broken.length === 0 && label !== undefined && !labels.includes(label)) problems.push(`The term of the atlas entry ${entry.id} gives ${labels.join(", ")}, not ${label}.`);
    const grammarLayer = classes.find((each) => each.id === label)?.layer;
    if (grammarLayer !== undefined && grammarLayer !== entry.layer) {
      problems.push(`The atlas entry ${entry.id} has the layer ${entry.layer}, and the grammar gives its class the layer ${grammarLayer}.`);
    }
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
    const layer = layers.get(entry.hypothesis);
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
  const { worlds, needs: needsOf } = context;
  const faults = new Set(context.rows.map((row) => row.hypothesis));
  const rows: AtlasRow[] = atlas
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => layerRank(a.entry.layer) - layerRank(b.entry.layer) || a.order - b.order)
    .map(({ entry }) => {
      const hypothesis = entry.hypothesis;
      const needs = [...new Set([...(hypothesis === null ? [] : (needsOf[hypothesis] ?? [])), ...(termProblems(entry.term).length === 0 ? termNeeds(entry.term) : [])])].sort();
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

/** This function gives the line of the counts of the ladder. It names the gaps first, because the work ends only at zero gaps. */
export function ladderCountsLine(ladder: Ladder): string {
  const { total, classes, proposals } = ladder;
  const rows = ladder.rows.length;
  return (
    `**${countOf(total.gaps, "gap")}** in ${countOf(total.cells, "cell")}: ${countOf(rows, "class", "classes")} on ${countOf(ladder.layers.length, "layer")}. ` +
    `The classes of the catalog have ${countOf(classes.gaps, "gap")}, and the proposed classes have ${countOf(proposals.gaps, "gap")}. ` +
    `${countOf(total.covered, "cell")} covered, and ${countOf(total.impossible, "cell")} impossible. The work ends only at zero gaps.`
  );
}

/** The most case ids that a cell of the ladder names for one world. A world with more cases gives its count of cases. */
const NAMED_CASES = 3;

/** This function gives the text of a cell of the ladder: its mark, and its case ids or the number of each limit. */
function ladderCellText(cell: LadderCell, footnote: (each: LayerLimit) => number): string {
  const { mark } = STATE_KEYS[cell.state];
  if (cell.state === "impossible") return `${mark} ${cell.limits.map((each) => `[${String(footnote(each))}]`).join(" ")}`;
  const named = cell.worlds
    .filter((each) => each.cases.length > 0)
    .map((each) => (each.cases.length > NAMED_CASES ? `${countOf(each.cases.length, "case")} of ${code(each.world)}` : codes(each.cases)));
  return named.length > 0 ? `${mark} ${named.join(", ")}` : mark;
}

/** This function gives the Markdown table of some rows of the ladder: one row for each class, and one column for each layer. */
function ladderTable(head: string, rows: readonly LadderRow[], layers: readonly LabLayer[], footnote: (each: LayerLimit) => number): string[] {
  const lines = [`| ${head} | Layer | ${layers.join(" | ")} |`, `| --- | --- | ${layers.map(() => "---").join(" | ")} |`];
  for (const row of rows) {
    const cells = row.cells.map((cell) => ladderCellText(cell, footnote));
    lines.push(`| ${code(row.id)} | ${row.layer === undefined ? "–" : code(row.layer)} | ${cells.join(" | ")} |`);
  }
  return lines;
}

/**
 * This function gives the coverage as Markdown: the line of the counts, then the ladder. The ladder has a table of the
 * classes of the catalog and a table of the proposed classes. Each table has a column for each layer E0 to E6. The
 * lists below the tables give the key of the marks, the layers, the reasons of the impossible cells, the worlds and
 * the control.
 */
export function coverageMarkdown(result: Coverage): string {
  const { worlds, ladder } = result;
  const reasons: LayerLimit[] = [];
  const footnote = (each: LayerLimit): number => {
    const at = reasons.indexOf(each);
    if (at >= 0) return at + 1;
    reasons.push(each);
    return reasons.length;
  };
  const lines = [`- ${ladderCountsLine(ladder)}`, "", ...ladderTable("Class", ladder.rows.filter((row) => row.kind === "class"), ladder.layers, footnote)];
  const proposed = ladder.rows.filter((row) => row.kind === "proposal");
  if (proposed.length > 0) lines.push("", ...ladderTable("Proposed class", proposed, ladder.layers, footnote));
  const keys = LADDER_STATES.map((state) => `${STATE_KEYS[state].mark} ${STATE_KEYS[state].name.toLowerCase()}`);
  lines.push("", `- The key: ${keys.join(". ")}. A covered cell names its cases.`);
  lines.push(`- The layers, from [the table of S7](${S7_LAYERS_URL}):`);
  for (const layer of ladder.layers) {
    const facts: LayerFacts = LAYER_FACTS[layer];
    const cannot = facts.cannot.length > 0 ? facts.cannot.map((each) => each.charAt(0).toLowerCase() + each.slice(1)).join(", ") : "nothing that the plan covers";
    lines.push(`  - ${layer}: ${facts.name}. State: ${LAYER_STATE_TEXT[facts.state]}. It cannot prove: ${cannot}.`);
  }
  if (reasons.length === 0) lines.push("- The impossible cells: none. No class needs a trait that a layer cannot have.");
  else {
    lines.push("- The reasons of the impossible cells:");
    reasons.forEach((each, at) => lines.push(`  ${String(at + 1)}. ${each.layer} cannot prove "${each.reason}". Thus it cannot have ${TRAIT_NAMES[each.trait]}. Source: ${each.source}.`));
  }
  lines.push(`- The worlds: ${worlds.map((world) => `${world.name} (${world.layer})`).join(", ")}.`);
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
 * This function puts the table of the coverage and the table of the grammar between their marker lines. It also puts
 * the tables of the atlas between their marker lines when the result has an atlas. It gives `undefined` when the file has no pair of marker lines for a part.
 */
export function withRoadmapParts(text: string, result: Coverage): string | undefined {
  const next = withMarkedPart(text, roadmapPart(result));
  const atlas = next === undefined || result.atlas === undefined ? next : withMarkedPart(next, atlasPart(result.atlas), ATLAS_START, ATLAS_END);
  return atlas === undefined ? undefined : withMarkedPart(atlas, grammarPart(), GRAMMAR_START, GRAMMAR_END);
}

/** The counts of the gate of the coverage, in the file `bars/coverage.json`. A unit test fails when the query gives other counts. */
export interface CoverageGate {
  /** The cells that are gaps, of the classes and of the proposed classes. */
  readonly gaps: number;
  readonly classGaps: number;
  readonly proposalGaps: number;
  readonly cells: number;
  readonly covered: number;
  readonly impossible: number;
  /** The reason of the last change of the counts. */
  readonly note: string;
}

/** This function gives the counts of the gate from the ladder. The file of the gate adds a note to them. */
export function gateCounts(ladder: Ladder): Omit<CoverageGate, "note"> {
  const { total, classes, proposals } = ladder;
  return { gaps: total.gaps, classGaps: classes.gaps, proposalGaps: proposals.gaps, cells: total.cells, covered: total.covered, impossible: total.impossible };
}

/** A layer of the ladder for the site: its id, its texts from S7, and the traits that it cannot have. */
export interface SiteLayer extends Pick<LayerFacts, "name" | "proves" | "cannot" | "tools" | "state"> {
  readonly id: LabLayer;
  /** The text of the state of the layer, from `LAYER_STATE_TEXT`. */
  readonly stateText: string;
  /** The traits that the layer cannot ever have. These are not the `limits` of the harness, which are resources of a load. */
  readonly limits: readonly LayerLimit[];
}

/** The ladder for the site, in the file `packages/site/src/coverage.json`. The site reads this file and does not import the query. */
export interface SiteLadder {
  readonly source: string;
  readonly counts: { readonly total: LadderCounts; readonly classes: LadderCounts; readonly proposals: LadderCounts };
  readonly layers: readonly SiteLayer[];
  readonly states: Readonly<Record<LadderState, StateKey>>;
  readonly gapStates: readonly LadderState[];
  readonly traits: Readonly<Record<WorldTrait, string>>;
  readonly worlds: readonly CoverageWorldName[];
  readonly rows: readonly LadderRow[];
  /** The summary of each option of the fault grammar that a row names, by the id of the option. */
  readonly options: Readonly<Record<string, string>>;
  readonly problems: readonly string[];
}

/** This function gives the ladder of a result for the site. */
export function siteLadder(result: Coverage, limits: Readonly<Record<LabLayer, readonly LayerLimit[]>> = LAYER_LIMITS): SiteLadder {
  const { ladder } = result;
  return {
    source: S7_LAYERS_URL,
    counts: { total: ladder.total, classes: ladder.classes, proposals: ladder.proposals },
    layers: ladder.layers.map((id) => {
      const { name, proves, cannot, tools, state } = LAYER_FACTS[id];
      return { id, name, proves, cannot, tools, state, stateText: LAYER_STATE_TEXT[state], limits: limits[id] };
    }),
    states: STATE_KEYS,
    gapStates: GAP_STATES,
    traits: TRAIT_NAMES,
    worlds: result.worlds,
    rows: ladder.rows,
    options: Object.fromEntries(
      GRAMMAR_OPTIONS.filter((option) => ladder.rows.some((row) => row.options.includes(optionId(option)))).map((option) => [optionId(option), option.summary]),
    ),
    problems: result.problems,
  };
}

/** This function gives the text of the file of the ladder for the site. */
export function siteLadderText(result: Coverage): string {
  return `${JSON.stringify(siteLadder(result), null, 2)}\n`;
}
