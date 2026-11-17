import { STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { random } from "@mark1russell7/rigor-generators";
import { enumerateSpace, type SpaceParam, type StageOption, type StrategySpace } from "@mark1russell7/strategy-space";
import { faultsOf, faultValues, GRAMMAR_ENGINE, GRAMMAR_OPTIONS, NO_FAULT, optionClasses, optionId, optionParams, PAIR_RULES, termClasses, termNeeds, type FaultTerm } from "../grammar.ts";
import { HTTP_TIMEOUT_MS, type CaseBase } from "../run.ts";
import { baseRtt, type Medium } from "./network.ts";

// The cases of the simulated world (ND-17, the layer E0). For each class of the catalog and for the class `none`, a
// seed draws terms from the fault grammar with `enumerateSpace` of strategy-space. A term of the case has its class as
// its only class. The bands below keep each fault in the range that a visit can detect. Each band tells its reason.

/** The number of cases of each class in one plan. */
export const CASES_PER_CLASS = 12;

/** The number of pings of a visit of the simulated world. A loss estimate needs `LOSS_MIN_SENT` requests. */
export const SIM_PING_COUNT = 20;

/** One case of the simulated world: a term of the grammar, the medium of the client, and if the world has IPv6. */
export interface SimCase extends CaseBase {
  readonly term: FaultTerm;
  readonly medium: Medium;
  readonly ipv6: boolean;
  /** The seed of the random source of the network of the case. */
  readonly seed: string;
}

/** A band: a narrower range of a real param of an option, and its reason. */
export interface SimBand {
  readonly option: string;
  readonly param: string;
  readonly min: number;
  readonly max: number;
  readonly reason: string;
}

/** The share of loss of one direction that 20 pings detect in 95 of 100 visits, and that leaves 1 reply in 95 of 100. */
const LOSS_LOW = 1 - 0.05 ** (1 / SIM_PING_COUNT);
const LOSS_HIGH = 0.05 ** (1 / SIM_PING_COUNT);

/** The bands of the simulated world. A fault out of its band is not in the cases. It is a limit of the visit, not a miss. */
export const SIM_BANDS: readonly SimBand[] = [
  {
    option: "path/loss",
    param: "share",
    min: 1 - Math.sqrt(1 - LOSS_LOW),
    max: LOSS_HIGH,
    reason: `A visit sends ${SIM_PING_COUNT} pings. A smaller loss gives no lost ping in 1 of 20 visits, and a larger loss gives no reply.`,
  },
  {
    option: "wifi/loss",
    param: "share",
    min: 1 - Math.sqrt(1 - LOSS_LOW),
    max: LOSS_HIGH,
    reason: `The radio loses frames in both directions. A visit sends ${SIM_PING_COUNT} pings, so the limits of path/loss apply to the loss of a round trip.`,
  },
  {
    option: "dns/refuse",
    param: "share",
    min: 0.975,
    max: 1,
    reason: "The visit asks for A and for AAAA. A good answer to one query gives a good name. Both fail in 95 of 100 visits only from 0.975.",
  },
  { option: "tcp/refuse", param: "share", min: 0.95, max: 1, reason: "The visit makes one connection to each address. A smaller share leaves the connection good in 1 of 20 visits." },
  { option: "http/refuse", param: "share", min: 0.95, max: 1, reason: "The visit sends one request to each address. A smaller share gives a good response in 1 of 20 visits." },
  {
    option: "http/delay",
    param: "delay-ms",
    min: Math.ceil(20 * 1.25 * baseRtt("target", "wifi")),
    max: 0.9 * HTTP_TIMEOUT_MS,
    reason: "The bin high of http.ttfb starts at 20 round trips. A delay longer than the time limit gives a timeout, not a slow server.",
  },
];

/**
 * This function tells if the loss of a term of `path/loss` or `wifi/loss` is in its band. A loss in both directions
 * gives the loss `1 - (1 - share)^2` to a ping. The radio loses frames in both directions.
 */
function lossInBand(term: FaultTerm): boolean {
  for (const choice of faultsOf(term)) {
    if (choice.option !== "path/loss" && choice.option !== "wifi/loss") continue;
    const values = faultValues(choice);
    const share = Number(values["share"]);
    const both = choice.option === "wifi/loss" || values["direction"] === "both";
    const loss = both ? 1 - (1 - share) ** 2 : share;
    if (loss < LOSS_LOW || loss > LOSS_HIGH) return false;
  }
  return true;
}

/** This function gives a param with the range of its band, or the param itself. */
function banded(option: string, param: SpaceParam): SpaceParam {
  const band = SIM_BANDS.find((each) => each.option === option && each.param === param.name);
  if (band === undefined || param.kind !== "real") return param;
  const fallback = Math.min(band.max, Math.max(band.min, Number(param.default)));
  return { ...param, min: band.min, max: band.max, default: fallback };
}

/** This function gives the options of the grammar that can give a class, with the ranges of their bands. */
function classOptions(label: string): readonly StageOption[] {
  return GRAMMAR_OPTIONS.filter((option) => optionClasses(option).includes(label)).map((option) => {
    const id = optionId(option);
    return { id, params: optionParams(option).map((param) => banded(id, param)) };
  });
}

/** This function gives the space of the terms of one class. A class of a rule of two faults has two stages. */
export function classSpace(label: string): StrategySpace {
  const pair = PAIR_RULES.find((rule) => rule.label === label);
  const stage = (name: string, ids: readonly string[]): StrategySpace["stages"][number] => {
    const options = GRAMMAR_OPTIONS.filter((option) => ids.includes(optionId(option))).map((option) => ({ id: optionId(option), params: optionParams(option) }));
    return { name, options };
  };
  if (pair !== undefined) {
    const [first, second] = pair.faults;
    return { schema: "strategy-space/1", engine: GRAMMAR_ENGINE, version: "1", stages: [stage("fault", [first.option]), stage("second", [second.option])] };
  }
  return { schema: "strategy-space/1", engine: GRAMMAR_ENGINE, version: "1", stages: [{ name: "fault", options: classOptions(label) }] };
}

/** The terms of the class `none`: no fault, and each fault of the grammar that is no fault alone. */
function noneSpace(): StrategySpace {
  const options = GRAMMAR_OPTIONS.filter((option) => option.labels.some((rule) => rule.label === NO_FAULT)).map((option) => ({ id: optionId(option), params: optionParams(option) }));
  return { schema: "strategy-space/1", engine: GRAMMAR_ENGINE, version: "1", stages: [{ name: "fault", optional: true, omitUnused: true, options }] };
}

/** This function tells if a term belongs to the cases of a class: its only class is the class, and it is in its bands. */
function fits(term: FaultTerm, label: string): boolean {
  const classes = termClasses(term);
  return classes.length === 1 && classes[0] === label && lossInBand(term);
}

/** This function tells if a fault of the grammar, or a rule of two faults, gives a class. */
function madeByGrammar(label: string): boolean {
  return PAIR_RULES.some((rule) => rule.label === label) || GRAMMAR_OPTIONS.some((option) => optionClasses(option).includes(label));
}

/** The classes of the plan: each class of the catalog that a fault gives, then `none`. No fault gives the class `unknown`. */
export const SIM_CLASSES: readonly string[] = [...new Set([...STANDARD_CATALOG.hypotheses.map((hypothesis) => hypothesis.id).filter(madeByGrammar), NO_FAULT])];

/** This function gives a whole seed for `enumerateSpace` from a name. */
function seedOf(name: string): number {
  return random(name).int(0, 2 ** 31 - 2);
}

/** This function gives the terms of one class for one seed. It throws when the space has too few terms that fit. */
export function classTerms(label: string, seed: number, n: number = CASES_PER_CLASS): readonly FaultTerm[] {
  const space = label === NO_FAULT ? noneSpace() : classSpace(label);
  const draws = enumerateSpace(space, { mode: "sample", n: 20 * n, seed: seedOf(`sim:${seed}:${label}`) });
  const terms = draws.filter((term) => fits(term, label)).slice(0, n);
  if (terms.length < n) throw new RangeError(`The space of ${label} gave ${terms.length} terms that fit, and the plan needs ${n}.`);
  return terms;
}

/** This function gives the plan of one seed: the cases of each class, with a medium and IPv6 that each term needs. */
export function simCases(seed: number, n: number = CASES_PER_CLASS): readonly SimCase[] {
  const cases: SimCase[] = [];
  for (const label of SIM_CLASSES) {
    const draw = random(`sim:${seed}:${label}:world`);
    classTerms(label, seed, n).forEach((term, index) => {
      const needs = termNeeds(term);
      const medium: Medium = needs.includes("wifi") || draw.chance(0.5) ? "wifi" : "wired";
      const ipv6 = needs.includes("ipv6") || draw.chance(0.5);
      const id = `${label}#${index + 1}`;
      cases.push({ id, truth: label, signs: [], term, medium, ipv6, seed: `sim:${seed}:${id}` });
    });
  }
  return cases;
}
