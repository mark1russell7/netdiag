import { realClock, type Clock } from "@mark1russell7/algebra/clock";
import {
  DNS_ANSWER,
  DNS_PROBE,
  STANDARD_CATALOG,
  createRunner,
  describeOutcome,
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
  type ReadOptions,
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

/** The part of a case that the case loop uses: its id, its true class and the signs that its world must show. */
export interface CaseBase {
  readonly id: string;
  readonly truth: string;
  readonly signs: readonly Sign[];
}

/**
 * The result of the visit of one case.
 *
 * - `visited`: the facts of the probes, the options that read them, and a problem for each probe that did not end.
 * - `no-visit`: the world of the case did not start. The reason tells why.
 */
export type Visit =
  | { readonly status: "visited"; readonly facts: readonly Fact[]; readonly read: ReadOptions; readonly problems: readonly string[] }
  | { readonly status: "no-visit"; readonly reason: string };

/** The visits of one round of a lab. A lab can keep one world for each round, and change only the fault of each case. */
export interface LabRound<C> {
  /** This method makes the world of a case, starts the probes and gives the visit. */
  visit(labCase: C): Promise<Visit>;
  /** This method stops the world of the round. */
  close(): Promise<void>;
}

/** The options of a lab run. */
export interface RunOptions {
  readonly hosts: LabHosts;
  readonly trust: LabTrust;
  /** The default is the standard catalog. */
  readonly catalog?: Catalog | undefined;
  /** The default is the real clock. */
  readonly clock?: Clock | undefined;
}

function labelOf(evidence: Evidence): string {
  return `${evidence.feature}=${evidence.value}@${evidence.primary ? "target" : "reference"}`;
}

function signLabel(sign: Sign): string {
  return `${sign.feature}=${sign.value}@${sign.primary ? "target" : "reference"}`;
}

function message(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** This function gives the signs of a case that the evidence does not show. */
export function missingSigns(signs: readonly Sign[], evidence: readonly Evidence[]): Sign[] {
  return signs.filter((sign) => !evidence.some((item) => item.feature === sign.feature && item.primary === sign.primary && item.value === sign.value));
}

/**
 * This function changes the visit of a case into a run. A run has a read only when each probe ended and the evidence
 * shows each sign of the case. The read has the diagnosis of the catalog.
 */
export function readVisit(labCase: CaseBase, round: number, visit: Visit, catalog: Catalog): CaseRun {
  const noRead = (reason: string, evidence: readonly string[] = []): CaseRun => ({ status: "no-read", case: labCase.id, round, reason, evidence });
  if (visit.status === "no-visit") return noRead(visit.reason);
  const reading = readEvidence(visit.facts, visit.read);
  const evidence = reading.evidence.map(labelOf);
  const problems = [...visit.problems];
  const missing = missingSigns(labCase.signs, reading.evidence);
  if (missing.length > 0) problems.push(`The world did not show the signs ${missing.map(signLabel).join(", ")}.`);
  if (problems.length > 0) return noRead(problems.join(" "), evidence);
  const record = labRecordOf(catalog, `${labCase.id}#${round}`, labCase.truth, diagnose(catalog, reading.evidence));
  if (record.tag === "err") return noRead(record.error, evidence);
  return { status: "read", case: labCase.id, round, record: record.value, evidence };
}

/** This function gives the cases in the order of a round: round `r` starts at case `r`, so no case is always first. */
export function roundOrder<T>(cases: readonly T[], round: number): T[] {
  if (cases.length === 0) return [];
  const start = round % cases.length;
  return [...cases.slice(start), ...cases.slice(0, start)];
}

/**
 * This function is the case loop of each lab. It starts each round, visits each case once in the order of the round,
 * and stops the round. It gives the runs in the order of their start.
 *
 * A round that does not start gives a run with no read for each of its cases. A visit that throws gives a run with no read.
 */
export async function runRounds<C extends CaseBase>(
  cases: readonly C[],
  rounds: number,
  startRound: (round: number) => Promise<LabRound<C>>,
  catalog: Catalog,
  onRun?: (run: CaseRun) => void,
): Promise<CaseRun[]> {
  if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError(`The number of rounds ${rounds} is not a positive integer.`);
  const runs: CaseRun[] = [];
  const keep = (run: CaseRun): void => {
    runs.push(run);
    onRun?.(run);
  };
  for (let round = 0; round < rounds; round++) {
    const order = roundOrder(cases, round);
    let labRound: LabRound<C>;
    try {
      labRound = await startRound(round);
    } catch (thrown) {
      for (const labCase of order) keep(readVisit(labCase, round, { status: "no-visit", reason: `The round did not start: ${message(thrown)}` }, catalog));
      continue;
    }
    try {
      for (const labCase of order) {
        let visit: Visit;
        try {
          visit = await labRound.visit(labCase);
        } catch (thrown) {
          visit = { status: "no-visit", reason: `The visit did not end: ${message(thrown)}` };
        }
        keep(readVisit(labCase, round, visit, catalog));
      }
    } finally {
      await labRound.close();
    }
  }
  return runs;
}

/**
 * This function starts the probes of one name. The DNS probe asks the lab resolver. The HTTP probe then connects to
 * the first address of the answer. The function gives the facts, and a problem for each probe that did not end.
 *
 * The loopback lab keeps this visit, not `visitTarget` of netdiag. That visit also asks AAAA and connects to each
 * address, and thus changes the facts of the loopback cases.
 */
async function visitName(world: World, options: RunOptions, runner: ReturnType<typeof createRunner>, name: string, port: number): Promise<{ facts: Fact[]; problems: string[] }> {
  const facts: Fact[] = [];
  const problems: string[] = [];
  const keep = (outcome: ProbeOutcome<unknown>, what: string): readonly Fact[] => {
    if (outcome.status !== "done") {
      problems.push(`The ${what} of ${name} did not end: ${describeOutcome(outcome)}.`);
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
 * This function starts the world of a loopback case, examines the target and the reference host, and stops the world.
 * The scope of the runner has the ranges of the lab hosts only.
 */
export async function visitLoopback(labCase: LabCase, options: RunOptions): Promise<Visit> {
  const grants: Grant[] = options.hosts.ranges.map((cidr) => ({ kind: "range", cidr, basis: "owned", note: "a host of the lab" }));
  const scope = scopeOf(grants);
  if (scope.tag === "err") return { status: "no-visit", reason: `The scope of the lab has problems: ${scope.error.join(" ")}` };
  let world: World;
  try {
    world = await startWorld(options.hosts, labCase, options.trust);
  } catch (thrown) {
    return { status: "no-visit", reason: `The world did not start: ${message(thrown)}` };
  }
  try {
    const runner = createRunner({ scope: scope.value, clock: options.clock ?? realClock });
    const target = await visitName(world, options, runner, TARGET_NAME, world.targetPort);
    const reference = await visitName(world, options, runner, REFERENCE_NAME, world.referencePort);
    const primary = new Set(target.facts.map((fact) => fact.id));
    return { status: "visited", facts: runner.facts(), read: { primary: (fact) => primary.has(fact.id) }, problems: [...target.problems, ...reference.problems] };
  } finally {
    await world.close();
  }
}

/** This function starts the world of a loopback case, examines it and stops it. */
export async function runCase(labCase: LabCase, round: number, options: RunOptions): Promise<CaseRun> {
  return readVisit(labCase, round, await visitLoopback(labCase, options), options.catalog ?? STANDARD_CATALOG);
}

/** This function starts each loopback case once in each round. Each case has its own world. */
export async function runLab(cases: readonly LabCase[], rounds: number, options: RunOptions, onRun?: (run: CaseRun) => void): Promise<CaseRun[]> {
  const loopbackRound: LabRound<LabCase> = { visit: (labCase) => visitLoopback(labCase, options), close: () => Promise.resolve() };
  return runRounds(cases, rounds, () => Promise.resolve(loopbackRound), options.catalog ?? STANDARD_CATALOG, onRun);
}
