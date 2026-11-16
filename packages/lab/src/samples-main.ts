// The command that makes the sample reports of the site. It starts the world of each loopback case, starts the check
// of `netdiag check` in it, and writes each report with the case.
//
//   node packages/lab/src/samples-main.ts --hosts ci --commit <sha> --out lab-out/samples.json
//
// The exit code is 0 when each case gave a report, and 2 when a world did not start or a check did not end.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { check, systemDeps, type CheckOptions } from "@mark1russell7/netdiag-cli";
import { errorMessage } from "@mark1russell7/text";
import { CI_HOSTS, LOCAL_HOSTS, LOOPBACK_CASES, REFERENCE_NAME, TARGET_NAME } from "./cases.ts";
import { SAMPLES_FORMAT, readSamples, type CheckSample, type CheckSamples } from "./samples.ts";
import { labTrust, startWorld, type World } from "./world.ts";

const { values } = parseArgs({
  options: {
    hosts: { type: "string", default: "ci" },
    commit: { type: "string", default: "local" },
    out: { type: "string", default: "lab-out/samples.json" },
  },
});

if (values.hosts !== "ci" && values.hosts !== "local") throw new Error(`The option --hosts is "ci" or "local", not "${values.hosts}".`);
const hosts = values.hosts === "ci" ? CI_HOSTS : LOCAL_HOSTS;
const trust = await labTrust();
const system = systemDeps();

/** This function gives the options of the check of a world: the options that a user types for the lab hosts. */
function optionsOf(world: World): CheckOptions {
  return {
    target: `https://${TARGET_NAME}:${world.targetPort}/`,
    reference: [`${REFERENCE_NAME}:${world.referencePort}`],
    resolver: `${world.resolver.host}:${world.resolver.port}`,
    grant: hosts.ranges,
  };
}

const samples: CheckSample[] = [];
const failures: string[] = [];
for (const labCase of LOOPBACK_CASES) {
  let world: World;
  try {
    world = await startWorld(hosts, labCase, trust);
  } catch (thrown) {
    failures.push(`${labCase.id}: the world did not start: ${errorMessage(thrown)}`);
    continue;
  }
  try {
    const report = await check(optionsOf(world), { ...system, resolvers: [], tls: { publicRoots: [trust.lab.cert], roots: [trust.proxy.cert] } });
    samples.push({ id: labCase.id, truth: labCase.truth, summary: labCase.summary, report });
    process.stdout.write(`${labCase.id}: ${report.causes[0]?.id ?? "no cause"}, next ${report.next?.id ?? "none"}\n`);
  } catch (thrown) {
    failures.push(`${labCase.id}: the check did not end: ${errorMessage(thrown)}`);
  } finally {
    await world.close();
  }
}

const file: CheckSamples = { format: SAMPLES_FORMAT, commit: values.commit, samples };
const read = readSamples(JSON.parse(JSON.stringify(file)));
if (read.tag === "err") failures.push(...read.error);
await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify(file, null, 2) + "\n");
for (const failure of failures) process.stderr.write(`${failure}\n`);
process.stdout.write(`${samples.length} of ${LOOPBACK_CASES.length} cases gave a report.\n`);
process.exitCode = failures.length > 0 ? 2 : 0;
