import type { Clock } from "@mark1russell7/algebra/clock";
import { factsOf, type Fact } from "./fact.ts";
import { DNS_ANSWER, HTTP_RESPONSE, TCP_CONNECT, TLS_HANDSHAKE, type RecordType } from "./kinds.ts";
import { LINK_SUBJECT, linkProbe, type InterfaceTable } from "./probes/link.ts";
import { DNS_PROBE, httpProbe, type TlsProbeOptions } from "./probes/native.ts";
import type { Probe } from "./probe.ts";
import { createRunner, type ProbeOutcome } from "./run.ts";
import { decideScope, resolvedGrant, scopeOf, type Grant } from "./scope.ts";
import { hostKind, target } from "./target.ts";
import type { ToolHost } from "./tools/host.ts";
import { mtrProbe } from "./tools/mtr.ts";
import { mtuProbe } from "./tools/mtu.ts";
import { DEFAULT_PING_COUNT, pingProbe } from "./tools/ping.ts";

// A visit is the standard set of probes of one target. The lab agent (ND-7) and the command-line tool (ND-8) use it.

/** A host of a visit: a DNS name or an IP address, and the port of its web service. */
export interface VisitHost {
  readonly host: string;
  /** The port of the HTTP request. The default is the port of the scheme. */
  readonly port?: number | undefined;
}

/** The DNS resolver of the names of a visit. */
export interface VisitResolver {
  readonly address: string;
  /** The default is 53. */
  readonly port?: number | undefined;
}

/**
 * The role of a host in a visit. The caller gives the role, and the caller decides which facts are about the target.
 *
 * - `target`: the host that the user diagnoses.
 * - `reference`: a host that works, for a comparison.
 * - `gateway`: the default gateway of this computer.
 * - `local`: this computer, for example the state of its link.
 */
export type VisitRole = "target" | "reference" | "gateway" | "local";

/** One step of a visit: a fact, or a problem of a probe that did not end. `host` is the host of the role. */
export type VisitStep =
  | { readonly kind: "fact"; readonly role: VisitRole; readonly host: string; readonly fact: Fact }
  | { readonly kind: "problem"; readonly role: VisitRole; readonly host: string; readonly problem: string };

/** The hosts of a visit, and the grants of its scope. */
export interface VisitInput {
  readonly target: VisitHost;
  readonly references?: readonly VisitHost[] | undefined;
  /** The address of the default gateway, when the caller knows it. The visit sends it ICMP echo requests only. */
  readonly gateway?: string | undefined;
  /** A name of the visit needs a resolver. Without it, the visit gives a problem for each name. */
  readonly resolver?: VisitResolver | undefined;
  /** The grants of the scope. Each probe sends packets only to a peer in the scope. */
  readonly grants: readonly Grant[];
}

/**
 * When a visit searches the MTU of the path to an address.
 *
 * - `auto`: after a TLS handshake or an HTTP response that timed out after a TCP connect. A path that drops large
 *   packets with no message gives this sign: the small packets of the connect pass, and the large packets do not.
 * - `always`: after the HTTP request to each address.
 * - `never`: the visit does not search.
 */
export type MtuSearch = "auto" | "always" | "never";

/** The values of `MtuSearch`. */
export const MTU_SEARCHES: readonly MtuSearch[] = ["auto", "always", "never"];

/** The options of a visit. */
export interface VisitOptions {
  readonly clock: Clock;
  /** The host of the outside tools. Without a host, the visit starts no `ping` and no `mtr`. */
  readonly tools?: ToolHost | undefined;
  /** The source of the interfaces of the link probe. The default is `os.networkInterfaces()`. A test gives a table. */
  readonly interfaces?: (() => InterfaceTable) | undefined;
  /** The number of echo requests to each address. The default is `DEFAULT_PING_COUNT`. 0 sends none. The option `mtu` controls the MTU search. */
  readonly pingCount?: number | undefined;
  /** The number of cycles of `mtr` to each address. The default 0 starts no `mtr`. */
  readonly mtrCycles?: number | undefined;
  /** When the visit searches the MTU of the path to an address. The default is `auto`. The search needs `tools`. */
  readonly mtu?: MtuSearch | undefined;
  /** The default is `https`. */
  readonly scheme?: "http" | "https" | undefined;
  /** The path of the HTTP request. The default is `/`. */
  readonly path?: string | undefined;
  /** The trust stores of the TLS handshake, for example the root of a lab in `publicRoots`. */
  readonly tls?: TlsProbeOptions | undefined;
  /** The time limit of each DNS query, in milliseconds. The default is the default of the DNS probe. */
  readonly dnsTimeoutMs?: number | undefined;
  /** The time limit of each HTTP request, in milliseconds. The default is the default of the HTTP probe. */
  readonly httpTimeoutMs?: number | undefined;
  /** The wall-clock time of the start of the runner, as an ISO 8601 text. */
  readonly wall?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** The record types of the DNS queries of a visit, in their order. */
export const VISIT_RECORDS: readonly RecordType[] = ["A", "AAAA"];

/** This function gives the outcome of a probe run in plain words. */
export function describeOutcome(outcome: ProbeOutcome<unknown>): string {
  switch (outcome.status) {
    case "done":
      return "done";
    case "failed":
      return `failed at the stage ${outcome.stage}: ${outcome.error}`;
    default:
      return `${outcome.status}: ${outcome.reason}`;
  }
}

/**
 * This function tells if the facts of an HTTP request show a path that drops large packets. The sign is a TCP connect
 * that connected, then a TLS handshake or an HTTP response that timed out.
 */
export function largePacketsLost(facts: readonly Fact[]): boolean {
  const connected = factsOf(TCP_CONNECT, facts).some((fact) => fact.value.outcome === "connected");
  const handshake = factsOf(TLS_HANDSHAKE, facts).some((fact) => fact.value.outcome === "timeout");
  const response = factsOf(HTTP_RESPONSE, facts).some((fact) => fact.value.outcome === "timeout");
  return connected && (handshake || response);
}

function stepsOf(role: VisitRole, host: string, what: string, outcome: ProbeOutcome<unknown>): VisitStep[] {
  if (outcome.status !== "done") return [{ kind: "problem", role, host, problem: `The ${what} did not end: ${describeOutcome(outcome)}.` }];
  return outcome.facts.map((fact) => ({ kind: "fact", role, host, fact }));
}

/**
 * This function starts the probes of a visit, and gives each fact and each problem when it occurs.
 *
 * - First, it reads the state of the link of this computer, to the gateway when the input has it. This read sends no packet.
 * - For each name, it asks the resolver for the A records and then the AAAA records.
 * - When a host grant puts a name in the scope, the addresses of its answers go into the scope.
 * - For each address, it starts `ping`, then `mtr`, then one HTTP request. A probe of an address out of the scope gives a problem.
 * - After the HTTP request, it searches the MTU of the path to the address when the option `mtu` tells it to.
 * - For the gateway, it starts `ping` only.
 *
 * The function marks no fact as a fact of the target. The roles of the steps let the caller decide. It throws a
 * `RangeError` before the first probe for a grant with a problem.
 */
export async function* visitTarget(input: VisitInput, options: VisitOptions): AsyncGenerator<VisitStep, void, undefined> {
  const scope = scopeOf(input.grants);
  if (scope.tag === "err") throw new RangeError(`The grants of the visit have problems: ${scope.error.join(" ")}`);
  const runner = createRunner({ scope: scope.value, clock: options.clock, wall: options.wall });
  const run = <I, R>(probe: Probe<I, R>, probeInput: I): Promise<ProbeOutcome<R>> => runner.run(probe, probeInput, options.signal);
  const pingCount = options.pingCount ?? DEFAULT_PING_COUNT;
  const mtrCycles = options.mtrCycles ?? 0;
  const ping = options.tools === undefined || pingCount === 0 ? undefined : pingProbe(options.tools);
  const mtr = options.tools === undefined || mtrCycles === 0 ? undefined : mtrProbe(options.tools);
  const mtuSearch = options.mtu ?? "auto";
  const mtu = options.tools === undefined || mtuSearch === "never" ? undefined : mtuProbe(options.tools);
  const http = httpProbe(options.tls);
  const scheme = options.scheme ?? "https";
  const link = linkProbe(options.interfaces);
  yield* stepsOf("local", input.gateway ?? LINK_SUBJECT, "read of the link", await run(link, { gateway: input.gateway }));
  const hosts: readonly { readonly role: VisitRole; readonly host: VisitHost }[] = [
    { role: "target", host: input.target },
    ...(input.references ?? []).map((host) => ({ role: "reference" as const, host })),
  ];
  for (const { role, host } of hosts) {
    const name = hostKind(host.host) === "name" ? host.host : undefined;
    const addresses: string[] = [];
    if (name === undefined) addresses.push(host.host);
    else if (input.resolver === undefined) {
      yield { kind: "problem", role, host: host.host, problem: `The visit has no DNS resolver for the name ${name}.` };
      continue;
    } else {
      const granted = decideScope(runner.scope(), target(name));
      for (const record of VISIT_RECORDS) {
        const query = { name, record, resolver: input.resolver.address, port: input.resolver.port, timeoutMs: options.dnsTimeoutMs };
        const outcome = await run(DNS_PROBE, query);
        yield* stepsOf(role, host.host, `DNS query ${record} of ${name}`, outcome);
        if (outcome.status !== "done") continue;
        for (const fact of factsOf(DNS_ANSWER, outcome.facts)) {
          const fresh = fact.value.addresses.filter((address) => !addresses.includes(address));
          addresses.push(...fresh);
          if (granted.allowed && granted.grant.kind === "host" && fresh.length > 0) runner.grant(fresh.map((address) => resolvedGrant(name, address, fact.id)));
        }
      }
    }
    for (const address of addresses) {
      if (ping !== undefined) yield* stepsOf(role, host.host, `ping of ${address}`, await run(ping, { address, count: pingCount }));
      if (mtr !== undefined) yield* stepsOf(role, host.host, `mtr of ${address}`, await run(mtr, { address, cycles: mtrCycles }));
      const request = { address, scheme, port: host.port, host: name, path: options.path, timeoutMs: options.httpTimeoutMs };
      const answer = await run(http, request);
      yield* stepsOf(role, host.host, `HTTP request to ${address}`, answer);
      const lost = answer.status === "done" && largePacketsLost(answer.facts);
      if (mtu !== undefined && (mtuSearch === "always" || lost)) {
        yield* stepsOf(role, host.host, `MTU search of ${address}`, await run(mtu, { address }));
      }
    }
  }
  if (input.gateway !== undefined && ping !== undefined) {
    yield* stepsOf("gateway", input.gateway, `ping of ${input.gateway}`, await run(ping, { address: input.gateway, count: pingCount }));
  }
}
