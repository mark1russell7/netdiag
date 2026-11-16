import { getServers } from "node:dns";
import { realClock, type Clock } from "@mark1russell7/algebra/clock";
import { visitTarget, type TlsProbeOptions, type VisitStep } from "@mark1russell7/netdiag";
import { commandHost, type ToolHost } from "@mark1russell7/netdiag/tools";
import { runCommand } from "@procedures/shell/command";
import { planCheck, type CheckOptions } from "./plan.ts";
import { reportOf, type CheckReport } from "./report.ts";

// The edge of a check: the visit sends the packets, and starts the outside tools. A test gives a fake tool host and
// servers on the loopback addresses.

/** The parts of the computer that a check uses. A test gives its own parts. */
export interface CheckDeps {
  readonly clock: Clock;
  /** The host of the outside tools. Without it, the check starts no `ping`. */
  readonly tools?: ToolHost | undefined;
  /** The DNS resolvers of the computer, in the form of `getServers()` of `node:dns`. */
  readonly resolvers: readonly string[];
  /** The trust stores of the TLS handshake. The default is the roots of Node.js. */
  readonly tls?: TlsProbeOptions | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** This function gives the parts of this computer: the monotonic clock, `runCommand` of `@procedures/shell` and the DNS resolvers. */
export function systemDeps(): CheckDeps {
  return { clock: realClock, tools: commandHost(runCommand, process.platform), resolvers: getServers() };
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
    mtu: plan.mtu,
    scheme: plan.scheme,
    path: plan.path,
    tls: deps.tls,
    signal: deps.signal,
  });
  for await (const step of visit) steps.push(step);
  return reportOf(plan, steps);
}
