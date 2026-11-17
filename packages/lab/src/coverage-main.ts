// The command of the coverage table (ND-17, step 1). It writes the table of the coverage of the fault classes into
// docs/ROADMAP.md, between the two marker lines.
//
//   pnpm --filter @netdiag/lab roadmap            (node packages/lab/src/coverage-main.ts)
//   pnpm --filter @netdiag/lab roadmap --check
//
// With --check, the command writes nothing. The exit code is 1 when the table in the file is not current.
// The exit code is 2 when the file has no pair of marker lines, or when the data of the coverage has problems.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { coverage, roadmapPart, withMarkedPart } from "./coverage.ts";
import { ROADMAP_FILE, labWorlds } from "./worlds.ts";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

const result = coverage({ catalog: STANDARD_CATALOG, worlds: labWorlds() });
for (const problem of result.problems) process.stderr.write(`${problem}\n`);
const text = readFileSync(ROADMAP_FILE, "utf8");
const next = withMarkedPart(text, roadmapPart(result));
if (next === undefined) {
  process.stderr.write("docs/ROADMAP.md has no pair of marker lines of the coverage.\n");
  process.exit(2);
}
if (values.check) {
  process.stdout.write(next === text ? "The table of the coverage is current.\n" : "The table of the coverage is not current. Start the command with no option.\n");
  process.exit(next === text ? 0 : 1);
}
if (next !== text) writeFileSync(ROADMAP_FILE, next);
process.stdout.write(`${next === text ? "The table of the coverage is current." : "The command wrote the table of the coverage."}\n`);
process.exit(result.problems.length > 0 ? 2 : 0);
