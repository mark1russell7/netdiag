import { LAYER_FACTS, type Layer as LabLayer, type LayerState } from "@mark1russell7/harness/layers";
import type { WorldTrait } from "./coverage.ts";

// The ladder of the lab (ND-17): the layers E0 to E6 of the plan S7 of metrograph-labs/systems, in `docs/S7.md`.
// The ids and the facts of the layers come from the entry `layers` of the harness. A test of the harness holds each
// text equal to the table of S7. The limits of each layer come from the column "What it cannot prove" of S7.

export { LAYERS as LAB_LAYERS, LAYER_FACTS, type Layer as LabLayer, type LayerFacts, type LayerState } from "@mark1russell7/harness/layers";

/** The address of the table of the layers in the plan S7. */
export const S7_LAYERS_URL = "https://github.com/metrograph-labs/systems/blob/main/docs/S7.md#the-layers";

/** The text of each state of a layer, for the site and the table of the coverage. The text of `waiting` names no person. */
export const LAYER_STATE_TEXT: Readonly<Record<LayerState, string>> = {
  today: "Today",
  new: "New",
  later: "Later",
  waiting: "Waits on the owner",
};

/** A trait that a layer cannot ever have, with its reason and its source. */
export interface LayerLimit {
  readonly layer: LabLayer;
  readonly trait: WorldTrait;
  /** The item of the column "What it cannot prove" of the layer. */
  readonly reason: string;
  /** The row and the column of the table of S7. */
  readonly source: string;
}

/** This function gives the limit of a layer for an item of its column "What it cannot prove". */
function limit(layer: LabLayer, item: number, trait: WorldTrait): LayerLimit {
  const reason = LAYER_FACTS[layer].cannot[item];
  if (reason === undefined) throw new Error(`The layer ${layer} has no item ${String(item)} in its column "What it cannot prove".`);
  return { layer, trait, reason, source: `S7, the table "The layers", row ${layer}, column "What it cannot prove"` };
}

/**
 * The traits that each layer cannot ever have. Each limit is an item of the column "What it cannot prove" of S7.
 *
 * - E0 has no limit. netdiag makes each fault of a class in fake ports, and no class needs real time.
 * - E1 to E3 have no limit for Wi-Fi. A runner kernel can possibly load `mac80211_hwsim`, and nobody verified that it cannot.
 * - E6 has no limit: its column is "Nothing that this plan covers".
 */
export const LAYER_LIMITS: Readonly<Record<LabLayer, readonly LayerLimit[]>> = {
  E0: [],
  E1: [limit("E1", 0, "kernel"), limit("E1", 1, "clock"), limit("E1", 2, "power"), limit("E1", 3, "power")],
  E2: [limit("E2", 0, "kernel"), limit("E2", 1, "power")],
  E3: [limit("E3", 0, "kernel"), limit("E3", 0, "forwarding")],
  E4: [limit("E4", 0, "nic"), limit("E4", 1, "zones")],
  E5: [limit("E5", 0, "forwarding")],
  E6: [],
};
