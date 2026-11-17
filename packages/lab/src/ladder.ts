import { LAYERS as LAB_LAYERS, type Layer as LabLayer } from "@mark1russell7/harness";
import type { WorldTrait } from "./coverage.ts";

// The ladder of the lab (ND-17): the layers E0 to E6 of the plan S7 of mark1russell7/systems, in `docs/S7.md`.
// The ids of the layers come from the harness. This module keeps the facts of each layer in the shape of `LAYER_FACTS`
// of the harness, with only the fields that the lab reads. It stays until harness 0.16.10 exports LAYER_FACTS.
// The limits of each layer come from the column "What it cannot prove" of S7. This module imports no `node:` module,
// but the harness does. Thus the site reads `coverage.json`, and not this module.

export { LAB_LAYERS, type LabLayer };

/** The address of the table of the layers in the plan S7. */
export const S7_LAYERS_URL = "https://github.com/mark1russell7/systems/blob/main/docs/S7.md#the-layers";

/** The facts of one layer of the ladder, in the shape of `LAYER_FACTS` of the harness. Each text comes from the table of S7. */
export interface LayerFacts {
  /** The column "What it is". */
  readonly name: string;
  /** The column "What it proves". */
  readonly proves: string;
  /** The column "What it cannot prove", one item for each thing. An empty list stands for "Nothing that this plan covers". */
  readonly cannot: readonly string[];
  /** The column "Tools". */
  readonly tools: readonly string[];
  /** The column "State". */
  readonly state: string;
}

/**
 * The facts of each layer of the ladder, from the table of S7. This copy stays until harness 0.16.10 exports
 * `LAYER_FACTS`. The state of E6 does not name a person: it tells that E6 waits on the owner of the repository.
 */
export const LAYER_FACTS: Readonly<Record<LabLayer, LayerFacts>> = {
  E0: {
    name: "Code on a false clock",
    proves: "The logic of a state machine and each order of its events",
    cannot: ["Any real time"],
    tools: ["algebra", "the service conformance kit"],
    state: "Today",
  },
  E1: {
    name: "Processes and containers on one kernel",
    proves: "Linux TCP timers, stock servers and their clients, proxies, conntrack",
    cannot: ["A second kernel", "A separate clock", "A reboot", "A loss of power"],
    tools: ["The harness"],
    state: "Today",
  },
  E2: {
    name: "A cluster of containers on one kernel",
    proves: "The control plane, Service rules, CNI and the lifecycle of a pod",
    cannot: ["A kernel for each node", "A loss of a node with no signal"],
    tools: ["kind", "k3d"],
    state: "Today, with kind",
  },
  E3: {
    name: "A routed fabric of containers on one kernel",
    proves: "Routing protocol timers, equal-cost paths, a change of route, sites with real delay",
    cannot: ["The kernel or the forwarding hardware of a router"],
    tools: ["containerlab with FRR"],
    state: "New",
  },
  E4: {
    name: "Virtual machines, each with its own kernel",
    proves: "A chosen kernel and HZ, a clock for each node, a loss of power, a disk, a reboot",
    cannot: ["A physical NIC", "Real zones"],
    tools: ["QEMU", "k3s in a VM"],
    state: "New, the VM tier of S4",
  },
  E5: {
    name: "Images of vendor routers in virtual machines",
    proves: "The defaults and the state machines of a vendor's control plane",
    cannot: ["The forwarding chip of the router"],
    tools: ["vrnetlab"],
    state: "Later",
  },
  E6: {
    name: "Real hardware and clouds",
    proves: "A physical NIC, firmware, managed load balancers, real zones",
    cannot: [],
    tools: ["HW-1"],
    state: "Waits on the owner",
  },
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
