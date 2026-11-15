import { GAIN_RESOLUTION, LOSS_MIN_SENT, MAX_JOINT_VALUES, STANDARD_CATALOG, diagnose, featuresOf, type Evidence, type VisitRole } from "@mark1russell7/netdiag";
import { describe, expect, it } from "vitest";
import { ADD_GATEWAY, ADD_REFERENCE, NEXT_PROBES, nextSteps, stepText, type NextProbe, type NextStep } from "./next.ts";
import { planCheck, type CheckOptions, type CheckPlan } from "./plan.ts";

// The choice of the next step, from fixed evidence. No test sends a packet.

function plan(options: CheckOptions): CheckPlan {
  const planned = planCheck(options, { resolvers: ["192.0.2.53"] });
  if (planned.tag === "err") throw new Error(planned.error.join(" "));
  return planned.value;
}

function probe(id: string): NextProbe {
  const found = NEXT_PROBES.find((item) => item.id === id);
  if (found === undefined) throw new Error(`No probe ${id}.`);
  return found;
}

function steps(options: CheckOptions, evidence: readonly Evidence[], addressed: readonly VisitRole[]): NextStep[] {
  return nextSteps(diagnose(STANDARD_CATALOG, evidence), plan(options), new Set(addressed));
}

const primary = (feature: string, value: string): Evidence => ({ feature, value, primary: true });
const reference = (feature: string, value: string): Evidence => ({ feature, value, primary: false });

function expectRanked(found: readonly NextStep[]): void {
  const ids = new Set(NEXT_PROBES.map((item) => item.id));
  for (const step of found) {
    expect(ids.has(step.id)).toBe(true);
    expect(step.gain).toBeGreaterThan(GAIN_RESOLUTION);
    expect(step.observes.length).toBeGreaterThan(0);
  }
  expect(found.map((step) => step.gain)).toEqual(found.map((step) => step.gain).sort((a, b) => b - a));
  expect(new Set(found.map((step) => step.step)).size).toBe(found.length);
}

describe("the candidates of the next step", () => {
  it("stay below the limit of joint values of rankProbes", () => {
    for (const item of NEXT_PROBES) {
      const features = featuresOf(item.kinds, { gateway: item.role === "gateway" });
      const joint = features.reduce((product, feature) => product * (STANDARD_CATALOG.features.get(feature)?.values.length ?? Infinity), 1);
      expect(features.length, item.id).toBeGreaterThan(0);
      expect(joint, item.id).toBeLessThanOrEqual(MAX_JOINT_VALUES);
    }
  });

  it("have a unique id each", () => {
    expect(new Set(NEXT_PROBES.map((item) => item.id)).size).toBe(NEXT_PROBES.length);
  });

  it("have one HTTPS request that observes the connect, the TLS handshake and the HTTP answer together", () => {
    const features = featuresOf(probe("target.https").kinds, { gateway: false });
    expect(new Set(features)).toEqual(new Set(["tcp.connect", "tcp.time", "tls.handshake", "tls.trust", "tls.ratio", "http.status", "http.ttfb"]));
    expect(probe("target.tls").cost).toBeLessThan(probe("target.https").cost);
  });
});

describe("the next steps", () => {
  it("ask for a reference host and the gateway when the user gave neither, with one step for each instruction", () => {
    const found = steps({ target: "example.com" }, [], []);
    expectRanked(found);
    expect(found.map((step) => step.step)).toEqual(expect.arrayContaining([ADD_REFERENCE, ADD_GATEWAY]));
    // The target has no address yet, so only its DNS query is a probe of the target.
    expect(found.filter((step) => step.id.startsWith("target.")).map((step) => step.id)).toEqual(["target.dns"]);
  });

  it("do not observe again a feature that the evidence has", () => {
    const evidence = [primary("dns.answer", "nxdomain"), reference("dns.answer", "ok")];
    const found = steps({ target: "example.com", reference: ["example.org"] }, evidence, ["reference"]);
    expectRanked(found);
    for (const step of found) {
      expect(step.observes).not.toContainEqual({ feature: "dns.answer", primary: true });
      expect(step.observes).not.toContainEqual({ feature: "dns.answer", primary: false });
      // An answer nxdomain gives no address, so a new check cannot give the feature dns.address of the target.
      expect(step.observes).not.toContainEqual({ feature: "dns.address", primary: true });
    }
    // The name gave no address, so no probe of the target follows the DNS query.
    expect(found.filter((step) => step.id.startsWith("target."))).toEqual([]);
  });

  it("start no TLS handshake and no HTTP request after a refused TCP connect", () => {
    const evidence = [primary("tcp.connect", "refused"), primary("icmp.reply", "reply")];
    const found = steps({ target: "192.0.2.10", gateway: "192.0.2.1" }, evidence, ["target", "gateway"]);
    expectRanked(found);
    expect(found.map((step) => step.id)).not.toContain("target.tls");
    expect(found.map((step) => step.id)).not.toContain("target.http");
    expect(found.map((step) => step.id)).not.toContain("target.https");
  });

  it("start the request of the scheme of the check: an HTTPS request for https, an HTTP request for http", () => {
    const evidence = [primary("icmp.reply", "reply")];
    const secure = steps({ target: "192.0.2.10", gateway: "192.0.2.1" }, evidence, ["target", "gateway"]);
    expectRanked(secure);
    expect(secure.map((step) => step.id)).toContain("target.https");
    expect(secure.map((step) => step.id)).not.toContain("target.http");
    const plain = steps({ target: "http://192.0.2.10/", gateway: "192.0.2.1" }, evidence, ["target", "gateway"]);
    expectRanked(plain);
    expect(plain.map((step) => step.id)).toContain("target.http");
    expect(plain.map((step) => step.id)).not.toContain("target.https");
  });

  it("start no HTTPS request after a failed TLS handshake, and keep the HTTP features out of the TLS handshake", () => {
    const evidence = [primary("tcp.connect", "connected"), primary("tls.handshake", "timeout"), primary("icmp.reply", "reply")];
    const found = steps({ target: "192.0.2.10", gateway: "192.0.2.1" }, evidence, ["target", "gateway"]);
    expectRanked(found);
    expect(found.map((step) => step.id)).not.toContain("target.https");
    for (const step of found.filter((each) => each.id === "target.tls")) expect(step.observes.map((item) => item.feature)).not.toContain("http.status");
  });

  it("give no step when the diagnosis has no cause", () => {
    const diagnosis = { ...diagnose(STANDARD_CATALOG, []), causes: [] };
    expect(nextSteps(diagnosis, plan({ target: "example.com" }), new Set())).toEqual([]);
  });
});

describe("the instruction of a next step", () => {
  const loss = [{ feature: "path.loss", primary: true }];
  const reply = [{ feature: "icmp.reply", primary: true }];

  it("tells how to add an absent host", () => {
    expect(stepText(probe("reference.https"), [], plan({ target: "example.com" }))).toBe(ADD_REFERENCE);
    expect(stepText(probe("gateway.ping"), [], plan({ target: "example.com" }))).toBe(ADD_GATEWAY);
    expect(stepText(probe("gateway.ping"), [], plan({ target: "example.com", pingCount: 0 }))).toBe(`${ADD_GATEWAY} Run the check again with --ping-count ${LOSS_MIN_SENT}.`);
  });

  it("asks for more echo requests when the loss is the only new feature, or when the check sent none", () => {
    expect(stepText(probe("target.ping"), loss, plan({ target: "example.com" }))).toBe(`Run the check again with --ping-count ${LOSS_MIN_SENT}.`);
    expect(stepText(probe("target.ping"), reply, plan({ target: "example.com", pingCount: 0 }))).toMatch(/--ping-count 20/);
    expect(stepText(probe("target.ping"), loss, plan({ target: "example.com", pingCount: LOSS_MIN_SENT }))).toMatch(
      /^The check has no value of path\.loss from the ping of example\.com\./,
    );
  });

  it("asks for a resolver, and for https before a TLS handshake", () => {
    const none = planCheck({ target: "example.com" }, { resolvers: [] });
    if (none.tag === "err") throw new Error(none.error.join(" "));
    expect(stepText(probe("target.dns"), [], none.value)).toMatch(/--resolver <address>/);
    expect(stepText(probe("target.tls"), [], plan({ target: "http://example.com/" }))).toBe("Run the check again with --scheme https.");
  });

  it("tells the user to read the problems of a probe that gave no result", () => {
    const http = [
      { feature: "http.status", primary: true },
      { feature: "http.ttfb", primary: true },
    ];
    expect(stepText(probe("target.https"), http, plan({ target: "example.com:8443" }))).toBe(
      "The check has no value of http.status, http.ttfb from the HTTPS request of example.com:8443. Look at the problems of the visit, then run the check again.",
    );
    expect(stepText(probe("target.http"), http, plan({ target: "http://example.com:8080/" }))).toBe(
      "The check has no value of http.status, http.ttfb from the HTTP request of example.com:8080. Look at the problems of the visit, then run the check again.",
    );
    const dns = [{ feature: "dns.answer", primary: false }];
    expect(stepText(probe("reference.dns"), dns, plan({ target: "example.com", reference: ["example.org"] }))).toMatch(/from the DNS query of the reference hosts\./);
  });
});
