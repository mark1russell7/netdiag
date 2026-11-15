import { DNS_ANSWER, TCP_CONNECT, target, type Fact, type VisitRole, type VisitStep } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { TOP_CAUSES } from "./next.ts";
import { planCheck, type CheckOptions, type CheckPlan } from "./plan.ts";
import { CHECK_FORMAT, formatReport, percentOf, reportOf, subjectText, type CheckReport } from "./report.ts";

// The report of fixed steps of a visit. No test sends a packet.

function plan(options: CheckOptions): CheckPlan {
  const planned = planCheck(options, { resolvers: ["192.0.2.53"] });
  if (planned.tag === "err") throw new Error(planned.error.join(" "));
  return planned.value;
}

let next = 0;
function fact(role: VisitRole, host: string, kind: string, layer: Fact["layer"], subject: string, value: unknown): VisitStep {
  next += 1;
  const item: Fact = { id: `f${next}`, kind, layer, subject: target(subject), time: { start: 0, end: 1 }, source: { probe: "test", version: "0" }, value };
  return { kind: "fact", role, host, fact: item };
}

const answer = (role: VisitRole, name: string, outcome: string, addresses: readonly string[]): VisitStep =>
  fact(role, name, DNS_ANSWER.kind, "dns", name, { name, record: "A", resolver: "192.0.2.53:53", outcome, addresses, ms: 3 });
const connect = (role: VisitRole, host: string, address: string, outcome: string): VisitStep =>
  fact(role, host, TCP_CONNECT.kind, "tcp", address, { address, port: 443, family: 4, outcome, ms: 2 });
const problem = (role: VisitRole, host: string, text: string): VisitStep => ({ kind: "problem", role, host, problem: text });

const REFUSED: readonly VisitStep[] = [
  answer("target", "shop.example", "ok", ["192.0.2.10"]),
  connect("target", "shop.example", "192.0.2.10", "refused"),
  answer("reference", "example.org", "ok", ["198.51.100.7"]),
  connect("reference", "example.org", "198.51.100.7", "connected"),
  problem("target", "shop.example", "The ping gave no result."),
];

describe("the report of a check", () => {
  const options = { target: "shop.example", reference: ["example.org"] };
  const report = reportOf(plan(options), REFUSED);

  it("has the shape of the format netdiag-check/1", () => {
    expect(Object.keys(report).sort()).toEqual(
      ["causes", "choices", "evidence", "facts", "format", "grants", "ignored", "next", "path", "problems", "scheme", "skipped", "target"].sort(),
    );
    expect(report.format).toBe(CHECK_FORMAT);
    expect([report.target, report.scheme, report.path]).toEqual(["shop.example", "https", "/"]);
    expect(report.next).toEqual(report.choices[0] ?? null);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("reads the facts of the target as primary evidence, and the facts of a reference host as reference evidence", () => {
    expect(report.evidence).toContainEqual(expect.objectContaining({ feature: "tcp.connect", value: "refused", primary: true }));
    expect(report.evidence).toContainEqual(expect.objectContaining({ feature: "tcp.connect", value: "connected", primary: false }));
    expect(report.facts.map((item) => item.role)).toEqual(["target", "target", "reference", "reference"]);
    expect(report.problems).toEqual([{ role: "target", host: "shop.example", problem: "The ping gave no result." }]);
  });

  it("gives the closed port as the most probable cause, with probabilities that sum to 1", () => {
    expect(report.causes[0]?.id).toBe("port.closed");
    expect(report.causes.reduce((sum, cause) => sum + cause.probability, 0)).toBeCloseTo(1, 9);
  });

  it("gives no probe of the target after the refused connect", () => {
    expect(report.choices.map((step) => step.id)).not.toContain("target.tls");
    expect(report.choices.map((step) => step.id)).not.toContain("target.http");
  });

  it("gives the same report for the same steps", () => {
    expect(reportOf(plan(options), REFUSED)).toEqual(report);
  });
});

describe("the text of a report", () => {
  it("shows the top causes, the next step with its gain, the problems and the count of the evidence", () => {
    const report = reportOf(plan({ target: "shop.example", reference: ["example.org"] }), REFUSED);
    const lines = formatReport(report);
    expect(lines[0]).toBe("netdiag check shop.example (https, path /)");
    // A percent has 4 characters: "100%", " 45%", " <1%" or "  0%".
    const causes = lines.filter((line) => /^ {2}[ \d][ <\d]\d% {2}\S/.test(line));
    expect(causes).toHaveLength(TOP_CAUSES);
    expect(lines.filter((line) => line.startsWith("        To do: "))).toHaveLength(TOP_CAUSES);
    expect(lines).toContain(`  ${percentOf(report.causes[0]?.probability ?? 0).padStart(4)}  ${report.causes[0]?.summary ?? ""}`);
    if (report.next !== null) {
      expect(lines).toContain(`The next step (it can give ${report.next.gain.toFixed(2)} bits of information about the causes)`);
      expect(lines).toContain(`  ${report.next.step}`);
    }
    expect(lines).toContain("The problems of the visit (1)");
    expect(lines).toContain("  target shop.example: The ping gave no result.");
    expect(lines.at(-1)).toBe(`${report.evidence.length} observations from 4 facts. The option --json gives each fact.`);
  });

  it("tells when the visit gave no evidence, and when no probe tells more", () => {
    const empty: CheckReport = { ...reportOf(plan({ target: "192.0.2.10" }), []), next: null, choices: [] };
    const lines = formatReport(empty);
    expect(lines).toContain("  The visit gave no evidence. These probabilities are the probabilities before a probe.");
    expect(lines).toContain("  netdiag has no probe that can tell more about these causes.");
    expect(lines.some((line) => line.startsWith("The problems"))).toBe(false);
    expect(lines.at(-1)).toBe("0 observations from 0 facts. The option --json gives each fact.");
  });

  it("names the role local as this computer", () => {
    expect(subjectText("local", "localhost")).toBe("this computer");
    expect(subjectText("gateway", "192.0.2.1")).toBe("gateway 192.0.2.1");
  });

  it("writes a small probability as <1%", () => {
    expect([percentOf(0), percentOf(0.004), percentOf(0.006), percentOf(0.5), percentOf(1)]).toEqual(["0%", "<1%", "1%", "50%", "100%"]);
  });
});
