import { getServers } from "node:dns";
import { realClock, type Clock } from "@mark1russell7/algebra/clock";
import { nodeResolveTxt, visitTarget, type RdapGet, type TlsProbeOptions, type TxtResolve, type VisitStep } from "@mark1russell7/netdiag";
import { commandHost, type ToolHost } from "@mark1russell7/netdiag/tools";
import { runCommand } from "@procedures/shell/command";
import { planCheck, type CheckOptions } from "./plan.ts";
import { systemRdap } from "./rdap.ts";
import { reportOf, type CheckReport } from "./report.ts";
import { packageVersion } from "./version.ts";

// The edge of a check: the visit sends the packets, starts the outside tools, and sends the lookups of the owners and
// the origins. A test gives a fake tool host, fake ports of RDAP and TXT, and servers on the loopback addresses.

/** The parts of the computer that a check uses. A test gives its own parts. */
export interface CheckDeps {
  readonly clock: Clock;
  /** The host of the outside tools. Without it, the check starts no `ping`. */
  readonly tools?: ToolHost | undefined;
  /** The DNS resolvers of the computer, in the form of `getServers()` of `node:dns`. */
  readonly resolvers: readonly string[];
  /** The trust stores of the TLS handshake. The default is the roots of Node.js. */
  readonly tls?: TlsProbeOptions | undefined;
  /** The port of the lookups of the owners of the hops. Without it, the option `owners` looks up no owner. */
  readonly rdap?: RdapGet | undefined;
  /** The port of the TXT queries of the origin AS of the hops. Without it, the option `owners` looks up no origin AS. */
  readonly origins?: TxtResolve | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * This function gives the parts of this computer: the monotonic clock, `runCommand` of `@procedures/shell`, the DNS
 * resolvers, the port of RDAP over `polite-crawler` and the port of TXT queries over `node:dns`.
 */
export function systemDeps(): CheckDeps {
  return {
    clock: realClock,
    tools: commandHost(runCommand, process.platform),
    resolvers: getServers(),
    rdap: systemRdap(packageVersion()),
    origins: nodeResolveTxt,
  };
}

/**
 * This function plans a check, starts its visit, and gives the report.
 *
 * It throws a `RangeError` with each problem of the options before the first probe.
 */
export async function check(options: CheckOptions, deps: CheckDeps): Promise<CheckReport> {
  const planned = planCheck(options, { resolvers: deps.resolvers });
  if (planned.tag === "err") throw new RangeError(planned.error.join("\n"));
  const plan = planned.value;
  const steps: VisitStep[] = [];
  const visit = visitTarget(plan.visit, {
    clock: deps.clock,
    tools: deps.tools,
    pingCount: plan.pingCount,
    mtrCycles: plan.mtrCycles,
    owners: plan.owners ? deps.rdap : undefined,
    origins: plan.owners ? deps.origins : undefined,
    mtu: plan.mtu,
    scheme: plan.scheme,
    path: plan.path,
    tls: deps.tls,
    signal: deps.signal,
  });
  for await (const step of visit) steps.push(step);
  return reportOf(plan, steps);
}
