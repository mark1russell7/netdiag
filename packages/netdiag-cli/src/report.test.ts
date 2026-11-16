import { DNS_ANSWER, PATH_OWNER, PATH_REPORT, TCP_CONNECT, target, type Fact, type VisitRole, type VisitStep } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { TOP_CAUSES } from "./next.ts";
import { planCheck, type CheckOptions, type CheckPlan } from "./plan.ts";
import {
  CHECK_FORMAT,
  MAX_REPORT_PROBLEMS,
  PATH_LOSS_FAULT,
  formatReport,
  hopsText,
  networkName,
  ownerText,
  percentOf,
  readCheckReport,
  reportOf,
  subjectText,
  type CheckReport,
} from "./report.ts";

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
    expect(report.choices.map((step) => step.id)).not.toContain("target.https");
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

const owner = (address: string, value: Readonly<Record<string, unknown>>): VisitStep =>
  fact("target", "shop.example", PATH_OWNER.kind, "path", address, { address, ...value });

const NETWORK = { handle: "NET-8-8-4-0-1", name: "EXAMPLE-8", start: "8.8.4.0", end: "8.8.4.255", cidrs: ["8.8.4.0/24"], holder: "Example Networks Inc.", country: "US", originAs: [64500] };

describe("the owners of the hops in a report", () => {
  const options = { target: "shop.example", reference: ["example.org"] };
  const steps = [
    ...REFUSED,
    owner("10.0.0.1", { outcome: "special", class: "private" }),
    owner("8.8.4.4", { outcome: "found", registry: "rdap.arin.net", network: NETWORK }),
    owner("8.8.4.9", { outcome: "unregistered", registry: "rdap.arin.net" }),
    owner("45.0.0.9", { outcome: "failed", detail: "rdap.lacnic.net gave the status 500." }),
  ];
  const report = reportOf(plan(options), steps);

  it("shows the owner of each hop in the text, and no section with no owner", () => {
    const lines = formatReport(report);
    const start = lines.indexOf("The owners of the hops (4)");
    expect(lines.slice(start, start + 5)).toEqual([
      "The owners of the hops (4)",
      "  10.0.0.1: a special-purpose address (private), with no lookup",
      "  8.8.4.4: EXAMPLE-8 (NET-8-8-4-0-1), Example Networks Inc., US, AS64500",
      "  8.8.4.9: the registry has no network for this address",
      "  45.0.0.9: no owner: rdap.lacnic.net gave the status 500.",
    ]);
    expect(formatReport(reportOf(plan(options), REFUSED)).some((line) => line.startsWith("The owners of the hops"))).toBe(false);
  });

  it("gives the handle of a network with no name, and no AS for a network with no origin", () => {
    const plain = { address: "8.8.4.4", outcome: "found", registry: "rdap.arin.net", network: { handle: "NET-1", start: "8.8.4.0", end: "8.8.4.255", cidrs: [], originAs: [] } } as const;
    expect(ownerText(plain)).toBe("NET-1");
    expect(ownerText({ address: "9.9.9.9", outcome: "unlisted", detail: "The bootstrap of IANA gives no registry for 9.9.9.9." })).toBe(
      "no owner: The bootstrap of IANA gives no registry for 9.9.9.9.",
    );
  });

  it("reads a report with owners after a round trip through JSON", () => {
    expect(readCheckReport(JSON.parse(JSON.stringify(report)))).toEqual({ tag: "ok", value: report });
  });
});

/** A report of mtr to the address of the target: `lost` probes of `sent` lost at each hop. */
const path = (sent: number, hops: readonly (readonly [string, number])[]): VisitStep =>
  fact("target", "shop.example", PATH_REPORT.kind, PATH_REPORT.layer, "192.0.2.10", {
    address: "192.0.2.10",
    outcome: "reached",
    cycles: sent,
    hops: hops.map(([address, lost], index) => ({ ttl: index + 1, address, sent, received: sent - lost })),
  });

const network = (handle: string, name: string, originAs: readonly number[]) => ({ handle, name, start: "0.0.0.0", end: "0.0.0.0", cidrs: [], originAs });

describe("the start of a loss in a report", () => {
  const options = { target: "shop.example" };
  const connected = [answer("target", "shop.example", "ok", ["192.0.2.10"]), connect("target", "shop.example", "192.0.2.10", "connected")];
  // With 100 cycles and 10 lost at the destination, the p of each hop with no loss is 0.0034. So the loss starts after hop 2.
  const hops = [["192.168.1.1", 0], ["198.51.100.1", 0], ["203.0.113.1", 10], ["192.0.2.10", 10]] as const;
  const steps = [
    ...connected,
    path(100, hops),
    owner("203.0.113.1", { outcome: "found", registry: "rdap.arin.net", network: network("NET-T", "TRANSIT-NET", [64501]) }),
    owner("192.0.2.10", { outcome: "found", registry: "rdap.arin.net", network: network("NET-S", "SHOP-NET", []) }),
  ];
  const report = reportOf(plan(options), steps);
  const sentence = "The loss of 10% to 192.0.2.10 starts in one of 2 networks: TRANSIT-NET (AS64501) or SHOP-NET.";

  it("names the networks under the cause of a loss, and shows the hops of each network", () => {
    const lines = formatReport(report);
    const cause = report.causes.slice(0, TOP_CAUSES).find((item) => item.id === PATH_LOSS_FAULT);
    expect(cause).toBeDefined();
    const at = lines.findIndex((line) => line.endsWith(`  ${cause?.summary ?? ""}`));
    expect(lines[at + 2]).toBe(`        Where: ${sentence}`);
    const start = lines.indexOf("Where the loss starts (1)");
    expect(lines.slice(start, start + 5)).toEqual([
      "Where the loss starts (1)",
      `  ${sentence}`,
      "    The loss starts after hop 2 (198.51.100.1), a hop with a clearly lower loss.",
      "    hop 3 (203.0.113.1): TRANSIT-NET (NET-T), AS64501",
      "    hop 4 (192.0.2.10): SHOP-NET (NET-S)",
    ]);
    expect(readCheckReport(JSON.parse(JSON.stringify(report)))).toEqual({ tag: "ok", value: report });
  });

  it("tells to give more cycles when no hop has a clearly lower loss, and names a hop with no lookup", () => {
    const lines = formatReport(reportOf(plan(options), [...connected, path(20, [["192.168.1.1", 0], ["192.0.2.10", 4]])]));
    const start = lines.indexOf("Where the loss starts (1)");
    expect(lines.slice(start + 1, start + 6)).toEqual([
      "  The loss of 20% to 192.0.2.10 starts in one of 2 networks: the network of 192.168.1.1 or the network of 192.0.2.10.",
      "    No hop has a clearly lower loss, so the loss can start on the first link.",
      "    More cycles give a shorter part of the path. Give --mtr-cycles 100.",
      "    hop 1 (192.168.1.1): no lookup of the owner",
      "    hop 2 (192.0.2.10): no lookup of the owner",
    ]);
  });

  it("shows no start without a loss at the destination", () => {
    const lines = formatReport(reportOf(plan(options), [...connected, path(100, [["192.168.1.1", 40], ["192.0.2.10", 0]])]));
    expect(lines.some((line) => line.startsWith("Where the loss starts") || line.includes("Where: "))).toBe(false);
  });

  it("writes one hop, a range of hops, and a network with no owner", () => {
    const loss = { sent: 100, lost: 0, ratio: 0, low: 0, high: 0.04 };
    expect(hopsText([])).toBe("no hop");
    expect(hopsText([{ ttl: 7, address: "203.0.113.2", loss }, { ttl: 8, address: "203.0.113.7", loss }])).toBe("hops 7 to 8 (203.0.113.2, 203.0.113.7)");
    expect(networkName({ hops: [] })).toBe("the network of a hop");
  });
});

describe("readCheckReport", () => {
  const report = reportOf(plan({ target: "shop.example", reference: ["example.org"] }), REFUSED);
  /** This function gives a copy of the report through JSON, with the fields of `change`. */
  const changed = (change: Record<string, unknown>): Record<string, unknown> => ({ ...(JSON.parse(JSON.stringify(report)) as object), ...change });
  const problemsOf = (value: unknown): readonly string[] => {
    const read = readCheckReport(value);
    return read.tag === "err" ? read.error : [];
  };

  it("gives the same report after a round trip through JSON", () => {
    expect(readCheckReport(JSON.parse(JSON.stringify(report)))).toEqual({ tag: "ok", value: report });
    const empty = reportOf(plan({ target: "192.0.2.10" }), []);
    expect(readCheckReport(JSON.parse(JSON.stringify(empty)))).toEqual({ tag: "ok", value: empty });
  });

  it("refuses a value that is not a report of the format netdiag-check/1", () => {
    expect(problemsOf("text")).toEqual(["The report is not a JSON object."]);
    expect(problemsOf([report])).toEqual(["The report is not a JSON object."]);
    expect(problemsOf(changed({ format: "netdiag-check/2" }))).toEqual(['The format of the report is "netdiag-check/2", not "netdiag-check/1".']);
    expect(problemsOf({})).toEqual(['The format of the report is null, not "netdiag-check/1".']);
  });

  it("gives the problems of the fields", () => {
    expect(problemsOf(changed({ target: "", scheme: "ftp", path: "shop" }))).toEqual([
      "The report has no target.",
      "The scheme of the report is not http or https.",
      "The path of the report does not start with /.",
    ]);
    expect(problemsOf(changed({ evidence: "none" }))).toEqual(["The field evidence of the report is not a list."]);
    expect(problemsOf(changed({ grants: [{ kind: "host", basis: "named" }] }))).toEqual(["The item 1 of grants is not a grant."]);
    expect(problemsOf(changed({ problems: [{ role: "router", host: "", problem: "x" }] }))).toEqual(["The item 1 of problems is not a problem of a probe."]);
  });

  it("checks the order and the sum of the probabilities of the causes", () => {
    const causes = report.causes;
    expect(causes.length).toBeGreaterThan(1);
    expect(problemsOf(changed({ causes: [...causes].reverse() }))).toEqual(["The causes do not go from the most probable."]);
    const half = causes.map((cause) => ({ ...cause, probability: cause.probability / 2 }));
    expect(problemsOf(changed({ causes: half }))).toEqual([`The probabilities of the causes sum to ${half.reduce((sum, cause) => sum + cause.probability, 0)}, not 1.`]);
  });

  it("checks that the next step is the first of the choices", () => {
    expect(report.choices.length).toBeGreaterThan(1);
    expect(problemsOf(changed({ next: report.choices[1] }))).toEqual(["The next step is not the first of the choices."]);
    expect(problemsOf(changed({ next: null }))).toEqual(["The next step is not the first of the choices."]);
    expect(problemsOf(changed({ next: null, choices: [] }))).toEqual([]);
  });

  it("checks each fact, and each fact id that the report names", () => {
    const [first, second] = report.facts;
    if (first === undefined || second === undefined) throw new Error("The report has no facts.");
    expect(problemsOf(changed({ facts: [{ ...first, fact: { ...first.fact, layer: "tls" } }, ...report.facts.slice(1)] }))).toEqual([
      `The item 1 of facts: The fact ${first.fact.id} has a layer or a value that the kind dns.answer does not accept.`,
    ]);
    expect(problemsOf(changed({ facts: [first, { ...second, fact: { ...second.fact, id: first.fact.id } }, ...report.facts.slice(2)] }))).toContain(
      `The fact id ${first.fact.id} is not unique.`,
    );
    expect(problemsOf(changed({ skipped: [{ fact: "f999", reason: "No reader." }] }))).toEqual(["The report names the fact f999, and has no fact with this id."]);
  });

  it("gives at most MAX_REPORT_PROBLEMS problems", () => {
    const many = Array.from({ length: 50 }, () => ({ role: "router" }));
    expect(problemsOf(changed({ problems: many }))).toHaveLength(MAX_REPORT_PROBLEMS);
  });
});
