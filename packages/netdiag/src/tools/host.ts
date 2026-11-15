import type { Availability, ProbeContext } from "../probe.ts";

/**
 * The output of one command of an outside tool.
 *
 * The function `runCommand` of `@procedures/shell` gives this shape. `commandHost` makes a host from it.
 */
export interface ToolOutput {
  /** The exit code of the program. */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** This field is true when the time limit stopped the program. */
  readonly timedOut?: boolean | undefined;
  /** The error that kept the program from its start, for example `spawn ping ENOENT`. */
  readonly error?: string | undefined;
}

/** The options of one command. */
export interface ToolRunOptions {
  /** The time limit of the command, in milliseconds. After the limit, the host stops the program. */
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** The environment variables to add to the environment of the program, for example `LC_ALL=C` for English output. */
  readonly env?: Readonly<Record<string, string>> | undefined;
}

/**
 * The host of the outside tools: the operating system, and the function that starts a program.
 *
 * - `platform` has the values of `process.platform`, for example `linux`, `darwin` or `win32`.
 * - `run` starts a program with a list of arguments and no shell. It does not throw. A failure is in the output.
 */
export interface ToolHost {
  readonly platform: string;
  run(command: string, args: readonly string[], options: ToolRunOptions): Promise<ToolOutput>;
}

/** The options of a `CommandRunner`. These are the options of `runCommand` of `@procedures/shell` that a host uses. */
export interface CommandRunOptions {
  /** The arguments of the program. No shell reads them. */
  readonly args: readonly string[];
  /** The time limit of the command, in milliseconds. */
  readonly timeout: number;
  readonly signal: AbortSignal;
  /** The environment variables to add to the environment of the program. */
  readonly env?: Readonly<Record<string, string>> | undefined;
}

/**
 * A function that starts a program with a list of arguments and no shell, and gives its output. It does not throw.
 *
 * The function `runCommand` of `@procedures/shell/command` has this shape. Thus netdiag does not depend on that package.
 */
export type CommandRunner = (command: string, options: CommandRunOptions) => Promise<ToolOutput>;

/**
 * This function gives the host of the outside tools from a `CommandRunner`, for example `runCommand` of
 * `@procedures/shell/command`. `platform` has the values of `process.platform`.
 */
export function commandHost(runner: CommandRunner, platform: string): ToolHost {
  return {
    platform,
    run: (command, args, options) =>
      runner(command, { args: [...args], timeout: options.timeoutMs, signal: options.signal, ...(options.env === undefined ? {} : { env: options.env }) }),
  };
}

/** The raw output of a probe of an outside tool: the command, its output, and the times on the clock of the runner. */
export interface ToolRaw extends ToolOutput {
  readonly platform: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly start: number;
  readonly end: number;
}

/** The time limit of the command that examines if a tool is available, in milliseconds. */
export const AVAILABILITY_TIMEOUT_MS = 5000;

/** The time that an adapter adds to the time limit of a command, in milliseconds. In this time, a tool writes its last lines. */
export const TOOL_MARGIN_MS = 3000;

/**
 * This function gives the availability of a tool from the output of a harmless command. A tool is available when its
 * program starts. The first group of `version` gives the version of the tool.
 */
export function availabilityOf(tool: string, output: ToolOutput, version?: RegExp): Availability {
  if (output.error !== undefined) return { available: false, reason: `The tool ${tool} does not start: ${output.error}` };
  const found = version?.exec(`${output.stdout}\n${output.stderr}`)?.[1];
  return found === undefined ? { available: true } : { available: true, version: found };
}

/** A command of an outside tool: the program, its arguments, its time limit and the environment variables to add. */
export interface ToolCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>> | undefined;
}

/** This function starts a command on the host, and gives its raw output with the times of the clock of the runner. */
export async function runTool(host: ToolHost, tool: ToolCommand, context: ProbeContext): Promise<ToolRaw> {
  const { command, args, timeoutMs, env } = tool;
  const start = context.clock.now();
  const output = await host.run(command, args, env === undefined ? { timeoutMs, signal: context.signal } : { timeoutMs, signal: context.signal, env });
  const end = context.clock.now();
  context.signal.throwIfAborted();
  return {
    platform: host.platform,
    command,
    args: [...args],
    start,
    end,
    exitCode: output.exitCode,
    stdout: output.stdout,
    stderr: output.stderr,
    ...(output.timedOut === true ? { timedOut: true } : {}),
    ...(output.error === undefined ? {} : { error: output.error }),
  };
}
