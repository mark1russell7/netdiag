import type { Clock } from "@mark1russell7/algebra/clock";
import { factsOf, type Fact } from "./fact.ts";
import { DNS_ANSWER, HTTP_RESPONSE, PATH_REPORT, TCP_CONNECT, TLS_HANDSHAKE, type RecordType } from "./kinds.ts";
import { originProbe, type OriginInput, type OriginRaw, type TxtResolve } from "./lookups/origin.ts";
import { MAX_OWNER_ADDRESSES, ownerProbe, type OwnerInput, type OwnerProbeOptions, type OwnerRaw, type RdapGet } from "./lookups/owner.ts";
import { LINK_SUBJECT, linkProbe, type InterfaceTable, type LinkInput, type LinkRaw } from "./probes/link.ts";
import { DNS_PROBE, httpProbe, type DnsInput, type DnsRaw, type HttpInput, type HttpRaw, type TlsProbeOptions } from "./probes/native.ts";
import type { Probe } from "./probe.ts";
import { createRunner, type ProbeOutcome } from "./run.ts";
import { decideScope, resolvedGrant, scopeOf } from "./scope.ts";
import { hostKind, target } from "./target.ts";
import type { ToolHost, ToolRaw } from "./tools/host.ts";
import { mtrProbe, type MtrInput } from "./tools/mtr.ts";
import { mtuProbe, type MtuInput, type MtuRaw } from "./tools/mtu.ts";
import { DEFAULT_PING_COUNT, pingProbe, type PingInput } from "./tools/ping.ts";
import { wifiProbe, type WifiInput, type WifiRaw } from "./tools/wifi.ts";
import type { MtuSearch, VisitHost, VisitInput, VisitRole, VisitStep } from "./visit-types.ts";

export {
  MTU_SEARCHES,
  VISIT_ROLES,
  type MtuSearch,
  type VisitHost,
  type VisitInput,
  type VisitResolver,
  type VisitRole,
  type VisitStep,
} from "./visit-types.ts";

// A visit is the standard set of probes of one target. The lab agent (ND-7) and the command-line tool (ND-8) use it.

/**
 * The probes of a visit. A simulated world gives its own probes: each has the parse of the real probe and a run of the
 * world. The visit uses the real probe for each probe that the options do not give.
 */
export interface VisitProbes {
  readonly link: Probe<LinkInput, LinkRaw>;
  readonly wifi: Probe<WifiInput, WifiRaw>;
  readonly dns: Probe<DnsInput, DnsRaw>;
  readonly ping: Probe<PingInput, ToolRaw>;
  readonly mtr: Probe<MtrInput, ToolRaw>;
  readonly mtu: Probe<MtuInput, MtuRaw>;
  readonly http: Probe<HttpInput, HttpRaw>;
  readonly owner: Probe<OwnerInput, OwnerRaw>;
  readonly origin: Probe<OriginInput, OriginRaw>;
}

/** The options of a visit. */
export interface VisitOptions {
  readonly clock: Clock;
  /**
   * The probes that replace the real probes of the visit. A probe here needs no port: for example, `ping` needs no
   * `tools`. The options `pingCount`, `mtrCycles`, `mtu` and `wifi` still start or stop each probe.
   */
  readonly probes?: Partial<VisitProbes> | undefined;
  /** The host of the outside tools. Without a host, the visit starts no `ping`, no `mtr`, no MTU search and no read of the Wi-Fi link. */
  readonly tools?: ToolHost | undefined;
  /**
   * The visit reads the Wi-Fi link of this computer with the tool of the operating system. The default is `true`. The
   * read needs `tools`. A lab with no Wi-Fi sets `false`.
   */
  readonly wifi?: boolean | undefined;
  /** The source of the interfaces of the link probe. The default is `os.networkInterfaces()`. A test gives a table. */
  readonly interfaces?: (() => InterfaceTable) | undefined;
  /** The number of echo requests to each address. The default is `DEFAULT_PING_COUNT`. 0 sends none. The option `mtu` controls the MTU search. */
  readonly pingCount?: number | undefined;
  /** The number of cycles of `mtr` to each address. The default 0 starts no `mtr`. */
  readonly mtrCycles?: number | undefined;
  /**
   * The port of the lookups of the owners of the hops in RDAP. Without it, the visit looks up no owner. The lookups
   * need `mtr`. The scope of the visit must have a host grant of each registry.
   */
  readonly owners?: RdapGet | undefined;
  /** The options of the probe of the owners. */
  readonly ownerOptions?: OwnerProbeOptions | undefined;
  /**
   * The port of the lookups of the origin AS of the hops in the DNS of Team Cymru. Without it, the visit looks up no
   * origin. The lookups need `mtr` and the resolver of the input. The scope must have a host grant of each zone of `CYMRU_ZONES`.
   */
  readonly origins?: TxtResolve | undefined;
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
  /** The count of tries of each DNS query. The default is `DNS_TRIES`. */
  readonly dnsTries?: number | undefined;
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

/** This function gives the addresses of the hops of the facts `path.report`, each one time, in the order of the hops. */
function hopAddresses(facts: readonly Fact[]): string[] {
  const addresses = factsOf(PATH_REPORT, facts).flatMap((fact) => fact.value.hops.flatMap((hop) => (hop.address === undefined ? [] : [hop.address])));
  return [...new Set(addresses)];
}

function stepsOf(role: VisitRole, host: string, what: string, outcome: ProbeOutcome<unknown>): VisitStep[] {
  if (outcome.status !== "done") return [{ kind: "problem", role, host, problem: `The ${what} did not end: ${describeOutcome(outcome)}.` }];
  return outcome.facts.map((fact) => ({ kind: "fact", role, host, fact }));
}

/**
 * This function starts the probes of a visit, and gives each fact and each problem when it occurs.
 *
 * - First, it reads the state of the link of this computer, to the gateway when the input has it. This read sends no packet.
 * - Then it reads the Wi-Fi link of this computer with `wifiProbe`, when the options have `tools`. This read also sends no packet.
 * - For each name, it asks the resolver for the A records and then the AAAA records.
 * - When a host grant puts a name in the scope, the addresses of its answers go into the scope.
 * - For each address, it starts `ping`, then `mtr`, then one HTTP request. A probe of an address out of the scope gives a problem.
 * - After `mtr`, it looks up the owner of each new hop in RDAP, when the options have `owners`. It looks up each hop one time.
 * - Then it looks up the origin AS of these hops in the DNS of Team Cymru, when the options have `origins`.
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
  const given = options.probes ?? {};
  const tools = options.tools;
  const ping = pingCount === 0 ? undefined : (given.ping ?? (tools === undefined ? undefined : pingProbe(tools)));
  const mtr = mtrCycles === 0 ? undefined : (given.mtr ?? (tools === undefined ? undefined : mtrProbe(tools)));
  const owner = mtr === undefined ? undefined : (given.owner ?? (options.owners === undefined ? undefined : ownerProbe(options.owners, options.ownerOptions)));
  const origin = mtr === undefined ? undefined : (given.origin ?? (options.origins === undefined ? undefined : originProbe(options.origins)));
  const looked = new Set<string>();
  const mtuSearch = options.mtu ?? "auto";
  const mtu = mtuSearch === "never" ? undefined : (given.mtu ?? (tools === undefined ? undefined : mtuProbe(tools)));
  const http = given.http ?? httpProbe(options.tls);
  const dns = given.dns ?? DNS_PROBE;
  const scheme = options.scheme ?? "https";
  const link = given.link ?? linkProbe(options.interfaces);
  const wifi = options.wifi === false ? undefined : (given.wifi ?? (tools === undefined ? undefined : wifiProbe(tools)));
  yield* stepsOf("local", input.gateway ?? LINK_SUBJECT, "read of the link", await run(link, { gateway: input.gateway }));
  if (wifi !== undefined) yield* stepsOf("local", LINK_SUBJECT, "read of the Wi-Fi link", await run(wifi, {}));
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
        const query = { name, record, resolver: input.resolver.address, port: input.resolver.port, timeoutMs: options.dnsTimeoutMs, tries: options.dnsTries };
        const outcome = await run(dns, query);
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
      if (mtr !== undefined) {
        const report = await run(mtr, { address, cycles: mtrCycles });
        yield* stepsOf(role, host.host, `mtr of ${address}`, report);
        const hops = report.status === "done" ? hopAddresses(report.facts).filter((hop) => !looked.has(hop)).slice(0, MAX_OWNER_ADDRESSES) : [];
        if ((owner !== undefined || origin !== undefined) && hops.length > 0) {
          for (const hop of hops) looked.add(hop);
          if (owner !== undefined) yield* stepsOf(role, host.host, `lookup of the owners of the hops to ${address}`, await run(owner, { addresses: hops }));
          if (origin !== undefined && input.resolver === undefined) {
            yield { kind: "problem", role, host: host.host, problem: `The visit has no DNS resolver for the lookups of the origin AS of the hops to ${address}.` };
          } else if (origin !== undefined && input.resolver !== undefined) {
            const query = { addresses: hops, resolver: input.resolver.address, port: input.resolver.port, timeoutMs: options.dnsTimeoutMs, tries: options.dnsTries };
            yield* stepsOf(role, host.host, `lookup of the origin AS of the hops to ${address}`, await run(origin, query));
          }
        }
      }
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
