import { describe, expect, it } from "vitest";
import { NATIVE_KINDS, TCP_CONNECT, TOOL_KINDS, VISIT_ROLES, readFact, type Fact, type VisitRole } from "./index.ts";

// The reader of a fact of a record (ND-9): a JSON report gives each fact as plain data, and a page reads it back.

const KINDS = [...NATIVE_KINDS, ...TOOL_KINDS];

/** A fact `tcp.connect` as a JSON report gives it. */
const connect: Fact = {
  id: "f3",
  kind: TCP_CONNECT.kind,
  layer: TCP_CONNECT.layer,
  subject: { host: "192.0.2.10", kind: "ipv4", port: 443 },
  time: { start: 1025, end: 1031.5 },
  source: { probe: "tcp.connect", version: "1" },
  value: { address: "192.0.2.10", port: 443, outcome: "connected", ms: 6.5 },
};

/** This function gives a copy of the fact through JSON, with the fields of `change`. */
const changed = (change: Record<string, unknown>): unknown => ({ ...(JSON.parse(JSON.stringify(connect)) as object), ...change });

describe("readFact", () => {
  it("gives the same fact for a fact of a known kind, after a round trip through JSON", () => {
    expect(TCP_CONNECT.check(connect.value)).toBe(true);
    const read = readFact(JSON.parse(JSON.stringify(connect)), KINDS);
    expect(read).toEqual({ tag: "ok", value: connect });
  });

  it("accepts a fact of a kind that it does not know, with no check of its value", () => {
    const later = changed({ kind: "path.later", layer: "path", value: { anything: [1, 2] } });
    expect(readFact(later, KINDS).tag).toBe("ok");
    expect(readFact(connect, []).tag).toBe("ok");
  });

  it("gives each problem of the fields", () => {
    expect(readFact(null, KINDS)).toEqual({ tag: "err", error: ["The fact is not an object."] });
    expect(readFact([connect], KINDS)).toEqual({ tag: "err", error: ["The fact is not an object."] });
    expect(readFact({}, KINDS)).toEqual({
      tag: "err",
      error: [
        "The fact has no id.",
        "The fact has no valid kind.",
        "The fact has no valid layer.",
        "The fact has no valid subject.",
        "The fact has no valid time.",
        "The fact has no valid source.",
        "The fact has no value.",
      ],
    });
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ kind: "TCP Connect" }, "The fact f3 has no valid kind."],
      [{ layer: "transport" }, "The fact f3 has no valid layer."],
      [{ subject: { host: "192.0.2.10", kind: "address" } }, "The fact f3 has no valid subject."],
      [{ subject: { host: "", kind: "name" } }, "The fact f3 has no valid subject."],
      [{ subject: { host: "192.0.2.10", kind: "ipv4", port: 70000 } }, "The fact f3 has no valid subject."],
      [{ time: { start: 9, end: 8 } }, "The fact f3 has no valid time."],
      [{ time: { start: "9", end: 10 } }, "The fact f3 has no valid time."],
      [{ source: { probe: "tcp.connect" } }, "The fact f3 has no valid source."],
      [{ source: { probe: "tcp.connect", version: "1", tool: 7 } }, "The fact f3 has no valid source."],
    ];
    for (const [change, problem] of cases) expect(readFact(changed(change), KINDS), problem).toEqual({ tag: "err", error: [problem] });
  });

  it("refuses a fact of a known kind with the layer or the value of another kind", () => {
    const problem = "The fact f3 has a layer or a value that the kind tcp.connect does not accept.";
    expect(readFact(changed({ layer: "tls" }), KINDS)).toEqual({ tag: "err", error: [problem] });
    expect(readFact(changed({ value: { outcome: "maybe" } }), KINDS)).toEqual({ tag: "err", error: [problem] });
  });
});

describe("VISIT_ROLES", () => {
  it("has each role of the type VisitRole", () => {
    const roles: readonly VisitRole[] = VISIT_ROLES;
    expect(roles).toEqual(["target", "reference", "gateway", "local"]);
  });
});
