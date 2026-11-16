import { readFile } from "node:fs/promises";
import { realClock, type Clock } from "@mark1russell7/algebra/clock";
import { visitTarget } from "@mark1russell7/netdiag";
import { commandHost, type ToolHost } from "@mark1russell7/netdiag/tools";
import { errorMessage } from "@mark1russell7/text";
import { runCommand } from "@procedures/shell/command";
import { parseAgentArgs, stepLine, visitInputOf, type AgentLine } from "./protocol.ts";

// The agent of the kernel lab. The harness starts it in the network namespace of the client, with the arguments of
// `agentArgs`. It operates the visit of netdiag on the lab hosts only, and writes one JSON line for each step.
//
//   node packages/lab/src/kernel/agent.ts --target www.shop.test --port 443 --resolver 172.20.0.4 --grant 172.20.0.2/32 ...

/** The parts of the agent that a test replaces. */
export interface AgentDeps {
  readonly tools: ToolHost;
  readonly clock: Clock;
  readonly write: (line: AgentLine) => void;
}

/**
 * This function reads the arguments, operates the visit and writes a line for each step, then the line `done`. An
 * argument that is not valid, a root file that it cannot read and a visit that throws give the line `fail`.
 *
 * The visit keeps the MTU search of `netdiag check`: it searches an address after a TLS or HTTP time-out.
 */
export async function startAgent(args: readonly string[], deps: AgentDeps): Promise<void> {
  const { clock, write } = deps;
  try {
    const plan = parseAgentArgs(args);
    const root = await readFile(plan.root, "utf8");
    const steps = visitTarget(visitInputOf(plan), {
      clock,
      tools: deps.tools,
      pingCount: plan.pingCount,
      mtrCycles: plan.mtrCycles,
      tls: { publicRoots: [root] },
      dnsTimeoutMs: plan.dnsTimeoutMs,
      httpTimeoutMs: plan.httpTimeoutMs,
    });
    for await (const step of steps) write(stepLine(step, clock.now()));
    write({ ev: "done", t: clock.now() });
  } catch (thrown) {
    write({ ev: "fail", t: clock.now(), why: errorMessage(thrown) });
  }
}

if (import.meta.main) {
  await startAgent(process.argv.slice(2), {
    tools: commandHost(runCommand, process.platform),
    clock: realClock,
    write: (line) => process.stdout.write(`${JSON.stringify(line)}\n`),
  });
}
