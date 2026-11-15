import { readFileSync } from "node:fs";
import { DEFAULT_PING_COUNT, MAX_PING_COUNT } from "@mark1russell7/netdiag/tools";
import { createProcedureCli, type Print, type ProcedureCli, type Terminal } from "@procedures/cli-kit";
import { defineProcedure } from "@procedures/client";
import { z } from "zod";
import { check, systemDeps } from "./check.ts";
import { SCHEMES, type CheckOptions } from "./plan.ts";
import { formatReport, type CheckReport } from "./report.ts";

// The command line of netdiag. `@procedures/cli-kit` makes the flags from the input schema of the command `check`, and
// gives the help, `--json` and the exit code.

/** The name of the program. */
export const PROGRAM = "netdiag";

/** The options of `createNetdiagCli`. */
export interface NetdiagCliOptions {
  /** The function that operates one check. A test gives a fake. */
  readonly check: (options: CheckOptions, signal: AbortSignal | undefined) => Promise<CheckReport>;
  /** The version that `--version` shows. */
  readonly version?: string | undefined;
  /** The output of the program. The default writes plain text to the console. */
  readonly print?: Print | undefined;
  /** The terminal state. The program asks for a missing target only in a terminal. */
  readonly terminal?: Terminal | undefined;
}

const CHECK_INPUT = z.object({
  target: z.string().min(1).describe("The host to check: a DNS name, an IP address, host:port or a URL"),
  port: z.number().int().min(1).max(65535).optional().describe("The port of the HTTP request. The default is the port of the scheme"),
  scheme: z.enum(SCHEMES).optional().describe("The scheme of the HTTP request: http or https. The default is https"),
  path: z.string().optional().describe("The path of the HTTP request. The default is /"),
  reference: z.array(z.string()).optional().describe("A host that works, for a comparison. Give the flag again for more hosts"),
  resolver: z.string().optional().describe("The address of the DNS resolver. The default is the first resolver of this computer"),
  gateway: z.string().optional().describe("The IP address of the default gateway. The check pings it"),
  grant: z.array(z.string()).optional().describe("A CIDR range that you own. The check can probe each address in it"),
  pingCount: z
    .number()
    .int()
    .min(0)
    .max(MAX_PING_COUNT)
    .optional()
    .describe(`The number of echo requests to each address. The default is ${DEFAULT_PING_COUNT}`),
});

/** This function makes the command line of netdiag with the command `check`. */
export function createNetdiagCli(options: NetdiagCliOptions): ProcedureCli {
  const procedure = defineProcedure({
    path: ["check"],
    input: CHECK_INPUT,
    output: z.custom<CheckReport>(),
    metadata: {
      description: "Check a target, and show the probable causes of a fault and the next step",
      args: ["target"],
      effects: { reads: ["network"], writes: ["process"], destructive: false },
    },
    handler: (input, context) => options.check(input, context.signal),
  });
  return createProcedureCli({
    name: PROGRAM,
    version: options.version,
    description: "the probable causes of a network fault, and the next step",
    procedures: [procedure],
    format: { check: (result) => formatReport(result as CheckReport) },
    print: options.print,
    terminal: options.terminal,
  });
}

/** This function gives the version in `package.json` of this package. */
export function packageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const version = typeof manifest === "object" && manifest !== null && "version" in manifest ? manifest.version : undefined;
  return typeof version === "string" ? version : "0.0.0";
}

/** This function operates the command line on this computer, and gives the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const cli = createNetdiagCli({ version: packageVersion(), check: (options, signal) => check(options, { ...systemDeps(), signal }) });
  return cli.run(argv);
}
