import { existsSync, readFileSync } from "node:fs";
import type { LabBars } from "@mark1russell7/netdiag";
import { LOOPBACK_CASES } from "./cases.ts";
import type { CoverageWorld } from "./coverage.ts";
import { KERNEL_CASES } from "./kernel/cases.ts";
import { WHERE_CASES } from "./kernel/where.ts";

// The worlds of the lab, as data for the coverage query (ND-17). A new world, for example a world of containerlab
// on the layer E3, is one more entry of `labWorlds`. Each world of today is on the layer E1: processes and containers
// on one kernel.

/** The folder of the files of the bars. */
export const BARS_FOLDER: URL = new URL("../bars/", import.meta.url);

/** The file of the roadmap, with the table of the coverage. */
export const ROADMAP_FILE: URL = new URL("../../../docs/ROADMAP.md", import.meta.url);

/** The file of the gate of the coverage: the counts of the cells of the ladder. */
export const GATE_FILE: URL = new URL("../bars/coverage.json", import.meta.url);

/** The file of the ladder for the site. The site reads this file, because the harness of the query imports `node:` modules. */
export const SITE_FILE: URL = new URL("../../site/src/coverage.json", import.meta.url);

/** This function reads a file of bars of `bars/`. A world with no file has no bar, so the function then gives no bar. */
export function readBars(name: string, folder: URL = BARS_FOLDER): LabBars {
  const file = new URL(`${name}.json`, folder);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as LabBars) : {};
}

/**
 * This function gives the worlds of the lab of today: the loopback lab, the kernel lab, and the where cases of the
 * kernel lab. `bars` gives the bars of each world from the name of its file. The default reads `bars/`.
 */
export function labWorlds(bars: (name: string) => LabBars = readBars): readonly CoverageWorld[] {
  return [
    { id: "loopback", name: "Loopback", layer: "E1", scores: "class", traits: [], cases: LOOPBACK_CASES, bars: bars("loopback") },
    { id: "kernel", name: "Kernel", layer: "E1", scores: "class", traits: [], cases: KERNEL_CASES, bars: bars("kernel") },
    { id: "where", name: "Kernel, where cases", layer: "E1", scores: "loss-start", traits: [], cases: WHERE_CASES, bars: bars("where") },
  ];
}
