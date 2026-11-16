import { CYMRU_ZONES, LAYERS, RDAP_BOOTSTRAP, RDAP_REGISTRIES, type Fact, type Grant, type VisitInput, type VisitStep } from "@mark1russell7/netdiag";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { Visit } from "../run.ts";

// The protocol between the host of the kernel lab and its agent in the client container. The host gives the plan of a
// visit as arguments. The agent writes one JSON line for each step of the visit, then a line `done`, or a line `fail`.

/** The plan of the visit of one case. */
export interface AgentPlan {
  readonly target: string;
  readonly port: number;
  readonly references: readonly string[];
  /** The address of the DNS resolver of the lab. */
  readonly resolver: string;
  readonly resolverPort: number;
  /** The address of the default gateway of the client. The visit reads the link to it, and pings it. */
  readonly gateway?: string | undefined;
  /** The CIDR ranges of the scope: the addresses of the lab only. */
  readonly grants: readonly string[];
  readonly pingCount: number;
  readonly mtrCycles: number;
  /**
   * `true` looks up the owner and the origin AS of each hop of `mtr`, as `--owners` of `netdiag check` does. The agent
   * refuses each lookup that leaves the lab. The scope grants the hosts of the lookups by name.
   */
  readonly owners: boolean;
  /** The path of the PEM file of the lab root in the client container. */
  readonly root: string;
  readonly dnsTimeoutMs: number;
  readonly httpTimeoutMs: number;
}

/** One line of the agent. `t` is a time on the monotonic clock of the agent, in milliseconds. */
export type AgentLine =
  | { readonly ev: "fact"; readonly t: number; readonly role: VisitStep["role"]; readonly host: string; readonly fact: Fact }
  | { readonly ev: "problem"; readonly t: number; readonly role: VisitStep["role"]; readonly host: string; readonly problem: string }
  | { readonly ev: "done"; readonly t: number }
  | { readonly ev: "fail"; readonly t: number; readonly why: string };

/** This function gives the arguments of the agent for a plan. */
export function agentArgs(plan: AgentPlan): string[] {
  return [
    "--target",
    plan.target,
    "--port",
    String(plan.port),
    ...plan.references.flatMap((reference) => ["--reference", reference]),
    "--resolver",
    plan.resolver,
    "--resolver-port",
    String(plan.resolverPort),
    ...(plan.gateway === undefined ? [] : ["--gateway", plan.gateway]),
    ...plan.grants.flatMap((cidr) => ["--grant", cidr]),
    "--ping",
    String(plan.pingCount),
    "--mtr",
    String(plan.mtrCycles),
    ...(plan.owners ? ["--owners"] : []),
    "--root",
    plan.root,
    "--dns-timeout",
    String(plan.dnsTimeoutMs),
    "--http-timeout",
    String(plan.httpTimeoutMs),
  ];
}

function count(text: string | undefined, what: string): number {
  const value = Number(text);
  if (text === undefined || !Number.isInteger(value) || value < 0) throw new RangeError(`The option ${what} is not an integer of 0 or more: "${text ?? ""}".`);
  return value;
}

function required(text: string | undefined, what: string): string {
  if (text === undefined || text.length === 0) throw new RangeError(`The agent has no option ${what}.`);
  return text;
}

/** This function reads the arguments of the agent. It throws a `RangeError` for an argument that is not valid. */
export function parseAgentArgs(args: readonly string[]): AgentPlan {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    options: {
      target: { type: "string" },
      port: { type: "string" },
      reference: { type: "string", multiple: true },
      resolver: { type: "string" },
      "resolver-port": { type: "string" },
      gateway: { type: "string" },
      grant: { type: "string", multiple: true },
      ping: { type: "string" },
      mtr: { type: "string" },
      owners: { type: "boolean" },
      root: { type: "string" },
      "dns-timeout": { type: "string" },
      "http-timeout": { type: "string" },
    },
  });
  const grants = values.grant ?? [];
  if (grants.length === 0) throw new RangeError("The agent has no option --grant. Its scope is empty.");
  return {
    target: required(values.target, "--target"),
    port: count(values.port, "--port"),
    references: values.reference ?? [],
    resolver: required(values.resolver, "--resolver"),
    resolverPort: count(values["resolver-port"], "--resolver-port"),
    ...(values.gateway === undefined ? {} : { gateway: required(values.gateway, "--gateway") }),
    grants,
    pingCount: count(values.ping, "--ping"),
    mtrCycles: count(values.mtr, "--mtr"),
    owners: values.owners === true,
    root: required(values.root, "--root"),
    dnsTimeoutMs: count(values["dns-timeout"], "--dns-timeout"),
    httpTimeoutMs: count(values["http-timeout"], "--http-timeout"),
  };
}

/**
 * This function gives the hosts of the lookups of the owners and of the origins, as grants by name. `planCheck` of
 * the CLI grants the same hosts for `--owners`. Without them, the scope refuses the probes of the lookups.
 */
export function lookupGrants(): Grant[] {
  const registries = [new URL(RDAP_BOOTSTRAP.ipv4).hostname, ...RDAP_REGISTRIES];
  return [
    ...registries.map((host): Grant => ({ kind: "host", host, basis: "named", note: "a registry of RDAP for the lookups of the owners" })),
    ...Object.values(CYMRU_ZONES).map((host): Grant => ({ kind: "host", host, basis: "named", note: "a DNS zone of Team Cymru for the lookups of the origins" })),
  ];
}

/**
 * This function gives the input of the visit of a plan. Each range of the plan is a range that the lab owns. A plan
 * with `owners` also grants the hosts of `lookupGrants`.
 */
export function visitInputOf(plan: AgentPlan): VisitInput {
  const ranges: Grant[] = plan.grants.map((cidr) => ({ kind: "range", cidr, basis: "owned", note: "a host of the kernel lab" }));
  const grants = plan.owners ? [...ranges, ...lookupGrants()] : ranges;
  return {
    target: { host: plan.target, port: plan.port },
    references: plan.references.map((host) => ({ host, port: plan.port })),
    resolver: { address: plan.resolver, port: plan.resolverPort },
    ...(plan.gateway === undefined ? {} : { gateway: plan.gateway }),
    grants,
  };
}

/** This function gives the line of the agent for a step of the visit. */
export function stepLine(step: VisitStep, t: number): AgentLine {
  return step.kind === "fact"
    ? { ev: "fact", t, role: step.role, host: step.host, fact: step.fact }
    : { ev: "problem", t, role: step.role, host: step.host, problem: step.problem };
}

const ROLE = z.enum(["target", "reference", "gateway", "local"]);

const FACT_LINE = z.object({
  ev: z.literal("fact"),
  role: ROLE,
  host: z.string(),
  fact: z.object({
    id: z.string(),
    kind: z.string(),
    layer: z.enum(LAYERS),
    subject: z.object({ host: z.string(), kind: z.enum(["name", "ipv4", "ipv6"]), port: z.number().int().optional() }),
    time: z.object({ start: z.number(), end: z.number() }),
    source: z.object({ probe: z.string(), version: z.string(), tool: z.string().optional() }),
    value: z.unknown(),
  }),
});

const PROBLEM_LINE = z.object({ ev: z.literal("problem"), role: ROLE, host: z.string(), problem: z.string() });
const FAIL_LINE = z.object({ ev: z.literal("fail"), why: z.string() });

/**
 * This function reads the lines of the agent into the visit of a case.
 *
 * - A fact of the role `target` is a fact of the target. Each other fact is a fact of a reference host.
 * - The ICMP echo facts of `gateway` give the feature `gateway.reply`, not `icmp.reply`.
 * - A line `fail` gives no visit. A missing line `done` and a line that is not valid give a problem.
 * - `ended` is the reason that the wait for the last line stopped, when it did not get one.
 * - `gateway` is the address of the gateway of the plan.
 * - `steps` keeps each fact and each problem with its role and its host. `reportOf` of the CLI reads them.
 *
 * The readers check each value of a fact against its kind.
 */
export function visitOf(lines: readonly { readonly ev: string }[], ended?: string, gateway?: string): Visit {
  const facts: Fact[] = [];
  const primary = new Set<string>();
  const problems: string[] = [];
  const steps: VisitStep[] = [];
  let done = false;
  for (const line of lines) {
    switch (line.ev) {
      case "fact": {
        const parsed = FACT_LINE.safeParse(line);
        if (!parsed.success) {
          problems.push(`The agent wrote a fact line that is not valid: ${z.prettifyError(parsed.error)}`);
          break;
        }
        const fact: Fact = parsed.data.fact;
        facts.push(fact);
        steps.push({ kind: "fact", role: parsed.data.role, host: parsed.data.host, fact });
        if (parsed.data.role === "target") primary.add(fact.id);
        break;
      }
      case "problem": {
        const parsed = PROBLEM_LINE.safeParse(line);
        if (!parsed.success) {
          problems.push("The agent wrote a problem line that is not valid.");
          break;
        }
        problems.push(parsed.data.problem);
        steps.push({ kind: "problem", role: parsed.data.role, host: parsed.data.host, problem: parsed.data.problem });
        break;
      }
      case "fail": {
        const parsed = FAIL_LINE.safeParse(line);
        return { status: "no-visit", reason: `The agent failed: ${parsed.success ? parsed.data.why : "it gave no reason."}` };
      }
      case "done":
        done = true;
        break;
      default:
        problems.push(`The agent wrote a line of the unknown kind "${line.ev}".`);
    }
  }
  if (!done) problems.push(`The agent did not end: ${ended ?? "it wrote no line done."}`);
  return { status: "visited", facts, read: { primary: (fact) => primary.has(fact.id), gateway }, problems, steps };
}
