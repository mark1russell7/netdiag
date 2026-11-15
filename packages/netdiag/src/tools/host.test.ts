import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { commandHost, type CommandRunOptions, type ToolOutput } from "./index.ts";

// commandHost changes the call of a ToolHost into the call of a function with the shape of runCommand of
// @procedures/shell. The tests give a fake function, so no program starts.

function recorder(output: ToolOutput) {
  const calls: { command: string; options: CommandRunOptions }[] = [];
  const runner = async (command: string, options: CommandRunOptions): Promise<ToolOutput> => {
    calls.push({ command, options });
    return output;
  };
  return { calls, runner };
}

const OUTPUT: ToolOutput = { exitCode: 0, stdout: "out", stderr: "", timedOut: true };

describe("commandHost", () => {
  it("gives the platform, and the output of the function with no change", async () => {
    const { runner } = recorder(OUTPUT);
    const host = commandHost(runner, "linux");
    expect(host.platform).toBe("linux");
    await expect(host.run("ping", ["-c", "1"], { timeoutMs: 10, signal: new AbortController().signal })).resolves.toBe(OUTPUT);
  });

  it("gives the arguments, the time limit, the signal and the environment to the function", async () => {
    const signal = new AbortController().signal;
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.array(fc.string()),
        fc.nat(),
        fc.option(fc.dictionary(fc.string({ minLength: 1 }), fc.string()), { nil: undefined }),
        async (command, args, timeoutMs, env) => {
          const { calls, runner } = recorder(OUTPUT);
          const host = commandHost(runner, "win32");
          await host.run(command, args, env === undefined ? { timeoutMs, signal } : { timeoutMs, signal, env });
          expect(calls).toHaveLength(1);
          const call = calls[0];
          expect(call?.command).toBe(command);
          expect(call?.options.args).toEqual(args);
          expect(call?.options.args).not.toBe(args);
          expect(call?.options.timeout).toBe(timeoutMs);
          expect(call?.options.signal).toBe(signal);
          expect(call?.options.env).toEqual(env);
          expect(call !== undefined && "env" in call.options).toBe(env !== undefined);
        },
      ),
      { seed: 20261115, numRuns: 100 },
    );
  });
});
