import type { Print } from "@procedures/cli-kit";
import { describe, expect, it } from "vitest";
import { createNetdiagCli, packageVersion } from "./cli.ts";
import { planCheck, type CheckOptions } from "./plan.ts";
import { formatReport, reportOf, type CheckReport } from "./report.ts";

// The command line, with a fake check. No test sends a packet.

interface Run {
  readonly code: number;
  readonly out: readonly string[];
  readonly errors: readonly string[];
  readonly calls: readonly CheckOptions[];
}

function fakeReport(options: CheckOptions): CheckReport {
  const plan = planCheck(options, { resolvers: ["192.0.2.53"] });
  if (plan.tag === "err") throw new RangeError(plan.error.join("\n"));
  return reportOf(plan.value, []);
}

async function run(argv: readonly string[]): Promise<Run> {
  const out: string[] = [];
  const errors: string[] = [];
  const calls: CheckOptions[] = [];
  const print: Print = {
    info: (message) => out.push(message),
    error: (message) => errors.push(message),
    success: (message) => out.push(message),
    warning: (message) => errors.push(message),
    table: (rows) => out.push(...rows.map((row) => row.join(" "))),
    spin: () => ({ stop: () => undefined, succeed: () => undefined, fail: () => undefined, text: "" }),
  };
  const cli = createNetdiagCli({
    version: "9.9.9",
    print,
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, env: {} },
    check: async (options) => {
      calls.push(options);
      return fakeReport(options);
    },
  });
  const code = await cli.run(argv);
  return { code, out, errors, calls };
}

describe("the command line", () => {
  it("reads the target and each option of check", async () => {
    const result = await run([
      "check",
      "shop.example",
      "--port",
      "8443",
      "--scheme",
      "http",
      "--path",
      "/health",
      "--reference",
      "example.org",
      "--reference",
      "198.51.100.7",
      "--resolver",
      "192.0.2.53",
      "--gateway",
      "192.0.2.1",
      "--grant",
      "10.1.0.0/16",
      "--ping-count",
      "20",
    ]);
    expect(result.errors).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      {
        target: "shop.example",
        port: 8443,
        scheme: "http",
        path: "/health",
        reference: ["example.org", "198.51.100.7"],
        resolver: "192.0.2.53",
        gateway: "192.0.2.1",
        grant: ["10.1.0.0/16"],
        pingCount: 20,
      },
    ]);
  });

  it("writes the text of the report by default", async () => {
    const result = await run(["check", "shop.example"]);
    expect(result.code).toBe(0);
    expect(result.out).toEqual(formatReport(fakeReport({ target: "shop.example" })));
  });

  it("writes the whole report as JSON with --json", async () => {
    const result = await run(["check", "shop.example", "--json"]);
    expect(result.code).toBe(0);
    expect(result.out).toHaveLength(1);
    const report: unknown = JSON.parse(result.out[0] ?? "");
    expect(report).toEqual(JSON.parse(JSON.stringify(fakeReport({ target: "shop.example" }))));
    expect(report).toMatchObject({ format: "netdiag-check/1", target: "shop.example", scheme: "https", path: "/", next: expect.anything() });
  });

  it("exits with 1 and starts no check for a bad option", async () => {
    for (const argv of [
      ["check", "shop.example", "--scheme", "ftp"],
      ["check", "shop.example", "--ping-count", "101"],
      ["check", "shop.example", "--ping-count", "-1"],
      ["check", "shop.example", "--port", "0"],
      ["check"],
    ]) {
      const result = await run(argv);
      expect(result.code, argv.join(" ")).toBe(1);
      expect(result.calls, argv.join(" ")).toEqual([]);
      expect(result.errors.length, argv.join(" ")).toBeGreaterThan(0);
    }
  });

  it("exits with 1 and gives each problem when the plan refuses the options", async () => {
    const result = await run(["check", "shop.example", "--gateway", "router.example", "--grant", "10.0.0.0/33"]);
    expect(result.code).toBe(1);
    expect(result.errors.join("\n")).toMatch(/router\.example/);
    expect(result.errors.join("\n")).toMatch(/10\.0\.0\.0\/33/);
  });

  it("shows the version and the help", async () => {
    expect((await run(["--version"])).out.join("\n")).toMatch(/9\.9\.9/);
    const help = (await run(["check", "--help"])).out.join("\n");
    for (const flag of ["--port", "--scheme", "--path", "--reference", "--resolver", "--gateway", "--grant", "--ping-count"]) expect(help).toContain(flag);
  });

  it("reads the version of the package", () => {
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
