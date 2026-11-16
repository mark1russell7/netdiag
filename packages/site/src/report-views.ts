/**
 * The views of a check report: the evidence of each layer, the probability of each part of the network, and the time
 * of each fact. Each function is pure, so a test examines it with no page.
 *
 * @packageDocumentation
 */
import { LAYERS, type Layer } from "@mark1russell7/netdiag/core";
import { PARTS, type Cause, type Evidence, type Part } from "@mark1russell7/netdiag/diagnosis";
import { subjectText, type CheckReport } from "@mark1russell7/netdiag-cli/report";
import { CATALOG } from "./model.ts";

/**
 * The tone of an observation.
 *
 * - `usual`: a network with no fault gives the value half of the time or more.
 * - `unusual`: a network with no fault gives the value less than half of the time.
 * - `unknown`: the catalog of the site does not have the feature or the value, for example in a report of a later version.
 */
export type Tone = "usual" | "unusual" | "unknown";

/** This function gives the tone of a value of a feature, from the healthy distribution of the feature. */
export function toneOf(feature: string, value: string): Tone {
  const healthy = CATALOG.features.get(feature)?.healthy[value];
  if (healthy === undefined) return "unknown";
  return healthy >= 0.5 ? "usual" : "unusual";
}

/** An observation of a layer: the evidence, its tone, and if the diagnosis used it. */
export interface FlowItem {
  readonly evidence: Evidence;
  readonly tone: Tone;
  /** The reason that the diagnosis did not use the evidence, or `undefined` when it used it. */
  readonly ignored?: string | undefined;
}

/**
 * The state of a layer.
 *
 * - `unusual`: one observation or more is unusual.
 * - `usual`: each observation is usual or unknown.
 * - `none`: the check gave no observation of the layer.
 */
export type LayerState = "unusual" | "usual" | "none";

/** A layer of the flow, with the observations of the target and of the other hosts. */
export interface FlowLayer {
  readonly layer: Layer;
  readonly state: LayerState;
  readonly target: readonly FlowItem[];
  readonly others: readonly FlowItem[];
  /** The number of facts of the layer in the report. */
  readonly facts: number;
}

/** This function gives the layer of an evidence: the layer of its feature, else the layer of its first fact. */
function layerOf(evidence: Evidence, factLayers: ReadonlyMap<string, Layer>): Layer | undefined {
  const feature = CATALOG.features.get(evidence.feature);
  if (feature !== undefined) return feature.layer;
  const first = evidence.facts?.[0];
  return first === undefined ? undefined : factLayers.get(first);
}

/** This function gives each layer of `LAYERS` with the observations of the report, in the order of the layers. */
export function flowOf(report: CheckReport): readonly FlowLayer[] {
  const factLayers = new Map(report.facts.map((item) => [item.fact.id, item.fact.layer] as const));
  const items: { readonly layer: Layer | undefined; readonly item: FlowItem }[] = [
    ...report.evidence.map((evidence) => ({ layer: layerOf(evidence, factLayers), item: { evidence, tone: toneOf(evidence.feature, evidence.value) } })),
    ...report.ignored.map(({ evidence, reason }) => ({ layer: layerOf(evidence, factLayers), item: { evidence, tone: toneOf(evidence.feature, evidence.value), ignored: reason } })),
  ];
  return LAYERS.map((layer) => {
    const here = items.filter((each) => each.layer === layer).map((each) => each.item);
    const state: LayerState = here.length === 0 ? "none" : here.some((item) => item.tone === "unusual") ? "unusual" : "usual";
    return {
      layer,
      state,
      target: here.filter((item) => item.evidence.primary),
      others: here.filter((item) => !item.evidence.primary),
      facts: report.facts.filter((item) => item.fact.layer === layer).length,
    };
  });
}

/**
 * A ring of the network: a part of the model, or a group of causes with no part.
 *
 * - `none`: the cause that the network has no fault.
 * - `unknown`: the cause that the catalog does not know the fault.
 * - `other`: the faults with no part.
 */
export type RingId = Part | "none" | "unknown" | "other";

/** A ring with the sum of the probabilities of its causes, and its most probable cause. */
export interface Ring {
  readonly ring: RingId;
  readonly probability: number;
  readonly top?: Cause | undefined;
}

/** This function gives the ring of a cause. */
function ringOf(cause: Cause): RingId {
  if (cause.kind !== "fault") return cause.kind;
  return cause.part ?? "other";
}

/**
 * This function gives the rings of the causes. The parts of `PARTS` come first, in the order from the computer to the
 * service, then `other`, `unknown` and `none`. The function gives a part with no cause, but not an empty group.
 */
export function ringsOf(causes: readonly Cause[]): readonly Ring[] {
  const order: readonly RingId[] = [...PARTS, "other", "unknown", "none"];
  return order.flatMap((ring) => {
    const here = causes.filter((cause) => ringOf(cause) === ring);
    if (here.length === 0 && !(PARTS as readonly string[]).includes(ring)) return [];
    const top = here.reduce<Cause | undefined>((best, cause) => (best === undefined || cause.probability > best.probability ? cause : best), undefined);
    return [{ ring, probability: here.reduce((sum, cause) => sum + cause.probability, 0), top }];
  });
}

/** A fact on the timeline. The times are in milliseconds from the start of the first fact. */
export interface TimeBar {
  readonly id: string;
  readonly kind: string;
  readonly layer: Layer;
  readonly lane: number;
  readonly start: number;
  readonly end: number;
}

/** The timeline of a report: a lane for each role and host, in the order of their first fact. */
export interface Timeline {
  readonly lanes: readonly string[];
  readonly bars: readonly TimeBar[];
  /** The time from the start of the first fact to the end of the last fact, in milliseconds. */
  readonly span: number;
}

/** This function gives the facts of a report on a timeline, from the time of each fact. */
export function timelineOf(report: CheckReport): Timeline {
  const origin = Math.min(...report.facts.map((item) => item.fact.time.start));
  const lanes: string[] = [];
  const bars = report.facts.map(({ role, host, fact }) => {
    const name = subjectText(role, host);
    if (!lanes.includes(name)) lanes.push(name);
    return { id: fact.id, kind: fact.kind, layer: fact.layer, lane: lanes.indexOf(name), start: fact.time.start - origin, end: fact.time.end - origin };
  });
  return { lanes, bars, span: bars.reduce((span, bar) => Math.max(span, bar.end), 0) };
}
