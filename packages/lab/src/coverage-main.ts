// The command of the coverage (ND-17). It writes the ladder of the fault classes and the tables of the fault atlas
// into docs/ROADMAP.md, each between its two marker lines. It also writes the ladder for the site into
// packages/site/src/coverage.json.
//
//   pnpm --filter @netdiag/lab roadmap            (node packages/lab/src/coverage-main.ts)
//   pnpm --filter @netdiag/lab roadmap --check
//
// With --check, the command writes nothing. The exit code is 1 when a file is not current.
// The exit code is 2 when the roadmap has no pair of marker lines for a part, or when the data has problems.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { STANDARD_CATALOG } from "@mark1russell7/netdiag";
import { FAULT_ATLAS } from "./atlas.ts";
import { coverage, siteLadderText, withRoadmapParts } from "./coverage.ts";
import { ROADMAP_FILE, SITE_FILE, labWorlds } from "./worlds.ts";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

const result = coverage({ catalog: STANDARD_CATALOG, worlds: labWorlds(), atlas: FAULT_ATLAS });
for (const problem of result.problems) process.stderr.write(`${problem}\n`);
const text = readFileSync(ROADMAP_FILE, "utf8");
const next = withRoadmapParts(text, result);
if (next === undefined) {
  process.stderr.write("docs/ROADMAP.md has no pair of marker lines for the coverage or for the atlas.\n");
  process.exit(2);
}
const site = existsSync(SITE_FILE) ? readFileSync(SITE_FILE, "utf8") : "";
const siteNext = siteLadderText(result);
const current = next === text && siteNext === site;
const code = result.problems.length > 0 ? 2 : 0;
if (values.check) {
  process.stdout.write(current ? "The coverage files are current.\n" : "The coverage files are not current. Start the command with no option.\n");
  process.exit(code === 0 && !current ? 1 : code);
}
if (next !== text) writeFileSync(ROADMAP_FILE, next);
if (siteNext !== site) writeFileSync(SITE_FILE, siteNext);
process.stdout.write(`${current ? "The coverage files are current." : "The command wrote the coverage files."}\n`);
process.exit(code);
