import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";

describe("the entry", () => {
  it("has the command line and its pure parts", () => {
    expect(entry.PROGRAM).toBe("netdiag");
    for (const name of ["planCheck", "reportOf", "formatReport", "nextSteps", "check", "createNetdiagCli", "main"] as const) {
      expect(entry[name], name).toBeTypeOf("function");
    }
  });
});
