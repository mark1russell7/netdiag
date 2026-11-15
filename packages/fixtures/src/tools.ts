/** The output of a fake tool. Its fields are the fields of `ToolOutput` of `@mark1russell7/netdiag/tools`. */
export interface FakeOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean | undefined;
  readonly error?: string | undefined;
}

/** One rule of a fake host: a test of the command and its arguments, and the output for a command that passes it. */
export type FakeRule = readonly [(args: readonly string[], command: string) => boolean, FakeOutput];

/** One command that a fake host received. */
export interface FakeCall<Options> {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: Options;
}

/** A fake host of outside tools. It has the shape of `ToolHost`, and it records each command. */
export interface FakeToolHost<Options> {
  readonly platform: string;
  readonly calls: FakeCall<Options>[];
  run(command: string, args: readonly string[], options: Options): Promise<FakeOutput>;
}

/** The output of a fake host for a command that passes no rule. */
export const NO_RULE: FakeOutput = { exitCode: 1, stdout: "", stderr: "", error: "no rule" };

/**
 * This function makes a fake host of outside tools. It starts no program. For each command, it records the command,
 * waits for `step`, and gives the output of the first rule that the command passes.
 */
export function fakeToolHost<Options>(platform: string, rules: readonly FakeRule[], step?: () => Promise<void> | void): FakeToolHost<Options> {
  const calls: FakeCall<Options>[] = [];
  return {
    platform,
    calls,
    async run(command, args, options) {
      calls.push({ command, args, options });
      await step?.();
      return rules.find(([match]) => match(args, command))?.[1] ?? NO_RULE;
    },
  };
}
