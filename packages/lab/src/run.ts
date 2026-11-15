import { realClock, type Clock } from "@mark1russell7/algebra/clock";
import {
  DNS_ANSWER,
  DNS_PROBE,
  STANDARD_CATALOG,
  createRunner,
  diagnose,
  factsOf,
  httpProbe,
  labRecordOf,
  readEvidence,
  scopeOf,
  type Catalog,
  type Evidence,
  type Fact,
  type Grant,
  type LabRecord,
  type ProbeOutcome,
} from "@mark1russell7/netdiag";
import { REFERENCE_NAME, TARGET_NAME, type LabCase, type LabHosts, type Sign } from "./cases.ts";
import { startWorld, type LabTrust, type World } from "./world.ts";

/** The time limit of a DNS query of the lab, in milliseconds. */
export const DNS_TIMEOUT_MS = 2000;
/** The time limit of an HTTP request of the lab, in milliseconds. */
export const HTTP_TIMEOUT_MS = 5000;

/**
 * The result of one run of a case.
 *
 * - `read`: the world showed each sign of the fault, and the record has the diagnosis.
 * - `no-read`: the world did not start, a probe did not end, or a sign is missing. The reason tells which.
 *
 * `evidence` has the evidence of the run as `feature=value`, with `@target` or `@reference`.
 */
export type CaseRun =
  | { readonly status: "read"; readonly case: string; readonly round: number; readonly record: LabRecord; readonly evidence: readonly string[] }
  | { readonly status: "no-read"; readonly case: string; readonly round: number; readonly reason: string; readonly evidence: readonly string[] };

/** The options of a lab run. */
export interface RunOptions {
  readonly hosts: LabHosts;
  readonly trust: LabTrust;
  /** The default is the standard catalog. */
  readonly catalog?: Catalog | undefined;
  /** The default is the real clock. */
  readonly clock?: Clock | undefined;
}

function describe(outcome: ProbeOutcome<unknown>): string {
  switch (outcome.status) {
    case "done":
      return "done";
    case "failed":
      return `failed at the stage ${outcome.stage}: ${outcome.error}`;
    default:
      return `${outcome.status}: ${outcome.reason}`;
  }
}

function labelOf(evidence: Evidence): string {
  return `${evidence.feature}=${evidence.value}@${evidence.primary ? "target" : "reference"}`;
}

function signLabel(sign: Sign): string {
  return `${sign.feature}=${sign.value}@${sign.primary ? "target" : "reference"}`;
}

/** This function gives the signs of a case that the evidence does not show. */
export function missingSigns(signs: readonly Sign[], evidence: readonly Evidence[]): Sign[] {
  return signs.filter((sign) => !evidence.some((item) => item.feature === sign.feature && item.primary === sign.primary && item.value === sign.value));
}

/**
 * This function starts the probes of one name. The DNS probe asks the lab resolver. The HTTP probe then connects to
 * the first address of the answer. The function gives the facts, and a problem for each probe that did not end.
 */
async function visit(world: World, options: RunOptions, runner: ReturnType<typeof createRunner>, name: string, port: number): Promise<{ facts: Fact[]; problems: string[] }> {
  const facts: Fact[] = [];
  const problems: string[] = [];
  const keep = (outcome: ProbeOutcome<unknown>, what: string): readonly Fact[] => {
    if (outcome.status !== "done") {
      problems.push(`The ${what} of ${name} did not end: ${describe(outcome)}.`);
      return [];
    }
    facts.push(...outcome.facts);
    return outcome.facts;
  };
  const dns = keep(await runner.run(DNS_PROBE, { name, resolver: world.resolver.host, port: world.resolver.port, timeoutMs: DNS_TIMEOUT_MS }), "DNS probe");
  const address = factsOf(DNS_ANSWER, dns).find((fact) => fact.value.outcome === "ok")?.value.addresses[0];
  if (address === undefined) return { facts, problems };
  const probe = httpProbe({ publicRoots: [options.trust.lab.cert], roots: [options.trust.proxy.cert] });
  keep(await runner.run(probe, { address, scheme: "https", port, host: name, timeoutMs: HTTP_TIMEOUT_MS }), "HTTP probe");
  return { facts, problems };
}

/**
 * This function starts the world of a case, examines the target and the reference host, and stops the world. The
 * scope of the runner has the ranges of the lab hosts only.
 */
export async function runCase(labCase: LabCase, round: number, options: RunOptions): Promise<CaseRun> {
  const catalog = options.catalog ?? STANDARD_CATALOG;
  const noRead = (reason: string, evidence: readonly string[] = []): CaseRun => ({ status: "no-read", case: labCase.id, round, reason, evidence });
  const grants: Grant[] = options.hosts.ranges.map((cidr) => ({ kind: "range", cidr, basis: "owned", note: "a host of the lab" }));
  const scope = scopeOf(grants);
  if (scope.tag === "err") return noRead(`The scope of the lab has problems: ${scope.error.join(" ")}`);
  let world: World;
  try {
    world = await startWorld(options.hosts, labCase, options.trust);
  } catch (thrown) {
    return noRead(`The world did not start: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  }
  try {
    const runner = createRunner({ scope: scope.value, clock: options.clock ?? realClock });
    const target = await visit(world, options, runner, TARGET_NAME, world.targetPort);
    const reference = await visit(world, options, runner, REFERENCE_NAME, world.referencePort);
    const primary = new Set(target.facts.map((fact) => fact.id));
    const reading = readEvidence(runner.facts(), { primary: (fact) => primary.has(fact.id) });
    const evidence = reading.evidence.map(labelOf);
    const problems = [...target.problems, ...reference.problems];
    const missing = missingSigns(labCase.signs, reading.evidence);
    if (missing.length > 0) problems.push(`The world did not show the signs ${missing.map(signLabel).join(", ")}.`);
    if (problems.length > 0) return noRead(problems.join(" "), evidence);
    const record = labRecordOf(catalog, `${labCase.id}#${round}`, labCase.truth, diagnose(catalog, reading.evidence));
    if (record.tag === "err") return noRead(record.error, evidence);
    return { status: "read", case: labCase.id, round, record: record.value, evidence };
  } finally {
    await world.close();
  }
}

/** This function gives the cases in the order of a round: round `r` starts at case `r`, so no case is always first. */
export function roundOrder<T>(cases: readonly T[], round: number): T[] {
  if (cases.length === 0) return [];
  const start = round % cases.length;
  return [...cases.slice(start), ...cases.slice(0, start)];
}

/** This function starts each case once in each round. It gives the results in the order of their start. */
export async function runLab(cases: readonly LabCase[], rounds: number, options: RunOptions, onRun?: (run: CaseRun) => void): Promise<CaseRun[]> {
  if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError(`The number of rounds ${rounds} is not a positive integer.`);
  const runs: CaseRun[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const labCase of roundOrder(cases, round)) {
      const run = await runCase(labCase, round, options);
      runs.push(run);
      onRun?.(run);
    }
  }
  return runs;
}
