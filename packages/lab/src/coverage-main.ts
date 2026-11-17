// The command of the coverage tables (ND-17, step 1). It writes the table of the coverage of the fault classes and
// the tables of the fault atlas into docs/ROADMAP.md, each between its two marker lines.
//
//   pnpm --filter @netdiag/lab roadmap            (node packages/lab/src/coverage-main.ts)
//   pnpm --filter @netdiag/lab roadmap --check
//
// With --check, the command writes nothing. The exit code is 1 when a table in the file is not current.
// The exit code is 2 when the file has no pair of marker lines for a part, or when the data has problems.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { FAULT_ATLAS } from "./atlas.ts";
import { coverage, withRoadmapParts } from "./coverage.ts";
import { ROADMAP_FILE, labWorlds } from "./worlds.ts";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

const result = coverage({ catalog: STANDARD_CATALOG, worlds: labWorlds(), atlas: FAULT_ATLAS });
for (const problem of result.problems) process.stderr.write(`${problem}\n`);
const text = readFileSync(ROADMAP_FILE, "utf8");
const next = withRoadmapParts(text, result);
if (next === undefined) {
  process.stderr.write("docs/ROADMAP.md has no pair of marker lines for the coverage or for the atlas.\n");
  process.exit(2);
}
if (values.check) {
  process.stdout.write(next === text ? "The tables of the coverage are current.\n" : "The tables of the coverage are not current. Start the command with no option.\n");
  process.exit(result.problems.length > 0 ? 2 : next === text ? 0 : 1);
}
if (next !== text) writeFileSync(ROADMAP_FILE, next);
process.stdout.write(`${next === text ? "The tables of the coverage are current." : "The command wrote the tables of the coverage."}\n`);
process.exit(result.problems.length > 0 ? 2 : 0);
