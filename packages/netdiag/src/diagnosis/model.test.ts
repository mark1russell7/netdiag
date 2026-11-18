import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ALIKE_EPSILON,
  ALIKE_MARGIN,
  FLOOR,
  LOSS_DEGREES,
  LOSS_STEPS,
  NONE,
  STANDARD_CATALOG,
  STANDARD_CATALOG_SPEC,
  STANDARD_FEATURES,
  STRENGTHS,
  UNKNOWN,
  alikeCauses,
  alikeDistance,
  alikeMargin,
  causeVariants,
  compileCatalog,
  diagnose,
  expand,
  explain,
  predictive,
  type CatalogSpec,
  type Degree,
  type Evidence,
  type Feature,
  type Reach,
} from "./index.ts";
import type { Layer } from "../layer.ts";

const catalog = STANDARD_CATALOG;

function e(feature: string, value: string, primary = true): Evidence {
  return { feature, value, primary };
}

function top(evidence: readonly Evidence[]): string {
  return diagnose(catalog, evidence).causes[0]?.id ?? "";
}

function probability(evidence: readonly Evidence[], id: string): number {
  return diagnose(catalog, evidence).causes.find((cause) => cause.id === id)?.probability ?? Number.NaN;
}

const tcp: Feature = {
  id: "tcp.connect",
  layer: "tcp",
  summary: "",
  values: ["connected", "refused", "timeout"],
  healthy: { connected: 0.98, refused: 0.01, timeout: 0.01 },
};

describe("the catalog", () => {
  it("compiles the standard catalog with no problem", () => {
    expect(compileCatalog(STANDARD_CATALOG_SPEC)).toMatchObject({ tag: "ok" });
    expect(catalog.hypotheses[0]?.id).toBe(NONE);
    expect(catalog.hypotheses.at(-1)?.id).toBe(UNKNOWN);
    const priors = catalog.hypotheses.map((h) => catalog.prior(h.id));
    expect(priors.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(new Set(priors).size).toBe(1);
  });

  it("gives each fault a summary and a step in plain words", () => {
    for (const h of catalog.hypotheses) {
      expect(h.summary).toMatch(/^[A-Z].*\.$/);
      expect(h.step).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("expands an expectation: the expected values share the strength, the others share the rest as the healthy distribution", () => {
    const strong = expand(tcp, { expect: "refused", strength: "strong" });
    if (strong.tag !== "ok") throw new Error(strong.error.join(" "));
    expect(strong.value["refused"]).toBe(0.9);
    // Each other value gets the floor. The rest above the floors goes as the healthy probabilities 0.98 and 0.01.
    expect(strong.value["connected"]).toBeCloseTo(0.001 + (0.098 * 0.98) / 0.99, 12);
    expect(strong.value["timeout"]).toBeCloseTo(0.001 + (0.098 * 0.01) / 0.99, 12);
    expect(Object.values(strong.value).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const usual = expand(tcp, { expect: ["refused", "timeout"], strength: "usual" });
    expect(usual.tag === "ok" ? usual.value : {}).toMatchObject({ refused: 0.375, timeout: 0.375 });
    expect(usual.tag === "ok" ? usual.value["connected"] : 0).toBeCloseTo(0.25, 12);
    // With no room above the floors, the other values share the rest equally.
    const many: Feature = { ...tcp, values: Array.from({ length: 22 }, (_, i) => `v${i}`), healthy: Object.fromEntries(Array.from({ length: 22 }, (_, i) => [`v${i}`, 1 / 22])) };
    const sure = expand(many, { expect: "v0", strength: "sure" });
    expect(sure.tag === "ok" ? [sure.value["v1"], sure.value["v21"]] : []).toEqual([(1 - 0.98) / 21, (1 - 0.98) / 21]);
    expect(expand(tcp, { expect: ["connected", "refused", "timeout"], strength: "weak" })).toMatchObject({ tag: "ok", value: { connected: 1 / 3 } });
    expect(expand(tcp, { expect: "maybe", strength: "weak" }).tag).toBe("err");
    expect(expand(tcp, { expect: [], strength: "weak" }).tag).toBe("err");
  });

  it.each<[string, CatalogSpec]>([
    ["a sum that is not 1", { version: "t", features: [{ ...tcp, healthy: { connected: 0.5, refused: 0.1, timeout: 0.1 } }], faults: [] }],
    ["a probability below the floor", { version: "t", features: [{ ...tcp, healthy: { connected: 1, refused: 0, timeout: 0 } }], faults: [] }],
    ["a value with no probability", { version: "t", features: [{ ...tcp, healthy: { connected: 0.99, refused: 0.01 } }], faults: [] }],
    ["an unknown value", { version: "t", features: [{ ...tcp, healthy: { connected: 0.98, refused: 0.01, timeout: 0.005, other: 0.005 } }], faults: [] }],
    ["a repeated feature", { version: "t", features: [tcp, tcp], faults: [] }],
    ["a feature with one value", { version: "t", features: [{ ...tcp, values: ["connected"], healthy: { connected: 1 } }], faults: [] }],
    [
      "an unknown feature in a prediction",
      { version: "t", features: [tcp], faults: [{ id: "x", part: "service", layer: "tcp", reach: "target", summary: "", step: "", predicts: { "dns.answer": { expect: "ok", strength: "weak" } } }] },
    ],
    ["a fault that predicts nothing", { version: "t", features: [tcp], faults: [{ id: "x", part: "service", layer: "tcp", reach: "target", summary: "", step: "", predicts: {} }] }],
    [
      "a repeated fault",
      {
        version: "t",
        features: [tcp],
        faults: [
          { id: "x", part: "service", layer: "tcp", reach: "target", summary: "", step: "", predicts: { "tcp.connect": { expect: "refused", strength: "weak" } } },
          { id: "x", part: "service", layer: "tcp", reach: "target", summary: "", step: "", predicts: { "tcp.connect": { expect: "refused", strength: "weak" } } },
        ],
      },
    ],
    [
      "a fault with a reserved id",
      { version: "t", features: [tcp], faults: [{ id: "none", part: "service", layer: "tcp", reach: "target", summary: "", step: "", predicts: { "tcp.connect": { expect: "refused", strength: "weak" } } }] },
    ],
    ["a prior of 0", { version: "t", features: [tcp], faults: [], priors: { unknown: 0 } }],
    ["a feature with an unknown layer", { version: "t", features: [{ ...tcp, layer: "radio" as Layer }], faults: [] }],
    [
      "a fault with an unknown layer",
      {
        version: "t",
        features: [tcp],
        faults: [{ id: "x", part: "service", layer: "radio" as Layer, reach: "target", summary: "", step: "", predicts: { "tcp.connect": { expect: "refused", strength: "weak" } } }],
      },
    ],
    ...[
      ["an empty list of reaches", []],
      ["a repeated reach", ["target", "target"]],
      ["an unknown reach", ["near"]],
    ].map(
      ([name, reach]): [string, CatalogSpec] =>
        [
          `a fault with ${name}`,
          {
            version: "t",
            features: [tcp],
            faults: [{ id: "x", part: "service", layer: "tcp", reach: reach as unknown as readonly Reach[], summary: "", step: "", predicts: { "tcp.connect": { expect: "refused", strength: "weak" } } }],
          },
        ],
    ),
    ...[
      ["a share of a reach that the fault does not have", { shared: 1 }],
      ["a reach with a share of 0", { target: 0 }],
      ["a reach with a share that is not a number", { target: Number.NaN }],
    ].map(
      ([name, reachShares]): [string, CatalogSpec] =>
        [
          `a fault with ${String(name)}`,
          {
            version: "t",
            features: [tcp],
            faults: [{ id: "x", part: "service", layer: "tcp", reach: "target", reachShares: reachShares as Partial<Record<Reach, number>>, summary: "", step: "", predicts: { "tcp.connect": { expect: "refused", strength: "weak" } } }],
          },
        ],
    ),
    ...[
      ["an empty list of degrees", []],
      ["a repeated degree", [{ id: "heavy", summary: "", share: 1 }, { id: "heavy", summary: "", share: 1 }]],
      ["a degree with an invalid id", [{ id: "Heavy Loss", summary: "", share: 1 }]],
      ["a degree with a share of 0", [{ id: "heavy", summary: "", share: 0 }]],
      ["a degree with a share that is not a number", [{ id: "heavy", summary: "", share: Number.NaN }]],
      ["a degree that predicts an unknown feature", [{ id: "heavy", summary: "", share: 1, predicts: { "dns.answer": { expect: "ok", strength: "weak" } } }]],
      ["a degree with a sum that is not 1", [{ id: "heavy", summary: "", share: 1, predicts: { "tcp.connect": { connected: 0.5, refused: 0.1, timeout: 0.1 } } }]],
    ].map(
      ([name, degrees]): [string, CatalogSpec] =>
        [
          `a fault with ${String(name)}`,
          {
            version: "t",
            features: [tcp],
            faults: [{ id: "x", part: "service", layer: "tcp", reach: "target", summary: "", step: "", predicts: { "tcp.connect": { expect: "refused", strength: "weak" } }, degrees: degrees as readonly Degree[] }],
          },
        ],
    ),
  ])("refuses %s", (_name, spec) => {
    expect(compileCatalog(spec).tag).toBe("err");
  });

  it("keeps each probability of the standard catalog at the floor or above", () => {
    for (const h of catalog.hypotheses) {
      for (const feature of STANDARD_FEATURES) {
        for (const value of feature.values) {
          expect(catalog.likelihood(h.id, feature.id, value, true)).toBeGreaterThanOrEqual(FLOOR);
          for (const degree of h.degree ?? []) expect(catalog.likelihood(h.id, feature.id, value, true, undefined, degree)).toBeGreaterThanOrEqual(FLOOR);
        }
      }
    }
  });
});

describe("the rules of practice", () => {
  it("names a missing name when the DNS answer is NXDOMAIN", () => {
    expect(top([e("dns.answer", "nxdomain")])).toBe("name.missing");
  });

  it("names the resolver when DNS times out, and the gateway and the link are up", () => {
    expect(top([e("dns.answer", "timeout"), e("gateway.reply", "reply"), e("link.state", "up")])).toBe("resolver.down");
  });

  it("names a filter of ICMP when ping fails and a TCP connect succeeds", () => {
    expect(top([e("icmp.reply", "none"), e("tcp.connect", "connected")])).toBe("filter.icmp");
  });

  it("names a closed port when the TCP connect is refused", () => {
    expect(top([e("tcp.connect", "refused")])).toBe("port.closed");
  });

  it("names a filter that drops packets when the TCP connect times out and the host answers ping", () => {
    expect(top([e("tcp.connect", "timeout"), e("icmp.reply", "reply")])).toBe("filter.drop");
  });

  it("names a TLS proxy when the TLS handshake is slow and the TCP connect is fast", () => {
    expect(top([e("tcp.connect", "connected"), e("tcp.time", "short"), e("tls.handshake", "ok"), e("tls.ratio", "high"), e("tls.trust", "private")])).toBe(
      "tls.proxy",
    );
  });

  it("names a failing proxy of the network when the issuer is private and the status is an error", () => {
    // Only a TLS proxy that the clients trust can give an HTTP status for an HTTPS site.
    expect(top([e("tls.handshake", "ok"), e("tls.trust", "private"), e("http.status", "server-error")])).toBe("proxy.error");
    expect(top([e("tls.handshake", "ok"), e("tls.trust", "public"), e("http.status", "server-error")])).toBe("server.error");
    expect(top([e("tls.handshake", "ok"), e("tls.trust", "private"), e("http.status", "ok")])).toBe("tls.proxy");
    const reference = [e("tls.trust", "public", false), e("http.status", "ok", false)];
    expect(top([e("tls.trust", "private"), e("http.status", "server-error"), ...reference])).toBe("proxy.error");
  });

  it("names a slow server when the first byte is slow and the handshakes are fast", () => {
    expect(top([e("tcp.time", "short"), e("tls.ratio", "low"), e("http.status", "ok"), e("http.ttfb", "high")])).toBe("server.slow");
  });

  it("names a loss on the path to the target when the connect is fast and the first byte is slow", () => {
    // A read of the kernel lab: netem drops 20 % of the packets of the target. Each SYN passed at once.
    const read = [
      "dns.answer=ok@target", "dns.answer=ok@reference", "tcp.connect=connected@target", "tcp.time=short@target",
      "tcp.connect=connected@reference", "tcp.time=short@reference", "tls.handshake=ok@target", "tls.trust=public@target",
      "tls.ratio=mid@target", "tls.handshake=ok@reference", "tls.trust=public@reference", "tls.ratio=low@reference",
      "http.status=ok@target", "http.ttfb=high@target", "http.status=ok@reference", "http.ttfb=low@reference",
      "icmp.reply=reply@target", "icmp.reply=reply@reference", "gateway.reply=reply@reference", "path.loss=high@target",
      "path.loss=none@reference", "path.loss=none@reference", "link.state=up@reference",
    ];
    const evidence = read.map((label) => {
      const [pair = "", at] = label.split("@");
      const [feature = "", value = ""] = pair.split("=");
      return e(feature, value, at === "target");
    });
    expect(top(evidence)).toBe("path.loss");
  });

  it("expects no slow connect from a loss: a SYN passes at once, or it goes again after 1 s", () => {
    const of = (value: string): number => catalog.likelihood("path.loss", "tcp.time", value, true);
    expect(of("long")).toBeLessThan(catalog.likelihood(NONE, "tcp.time", "long", true));
    expect(of("short")).toBeGreaterThan(of("long"));
    expect(of("retry")).toBeGreaterThan(of("long"));
  });

  it("names an MTU black hole when TCP connects and the TLS handshake times out", () => {
    expect(top([e("tcp.connect", "connected"), e("tls.handshake", "timeout"), e("http.status", "none")])).toBe("path.mtu");
  });

  it("names no fault when each observation is healthy", () => {
    const healthy = [e("dns.answer", "ok"), e("tcp.connect", "connected"), e("tcp.time", "short"), e("tls.handshake", "ok"), e("tls.ratio", "low"), e("http.status", "ok"), e("http.ttfb", "low")];
    expect(top(healthy)).toBe(NONE);
  });

  it("names an unknown cause for observations that no fault of the catalog explains", () => {
    const strange = [
      e("link.state", "down"),
      e("dns.answer", "ok"),
      e("tcp.connect", "connected"),
      e("tls.handshake", "alert"),
      e("http.status", "client-error"),
      e("http.ttfb", "high"),
    ];
    expect(top(strange)).toBe(UNKNOWN);
  });
});

describe("a reference host", () => {
  const primary = [e("tcp.time", "short"), e("tls.ratio", "high")];
  const odds = (evidence: readonly Evidence[]): number => probability(evidence, "tls.proxy") / probability(evidence, "server.slow");

  it("tells a shared fault from a fault of the target", () => {
    const sameOnReference = odds([...primary, e("tls.ratio", "high", false)]);
    const alone = odds(primary);
    const fastOnReference = odds([...primary, e("tls.ratio", "low", false)]);
    expect(sameOnReference).toBeGreaterThan(alone);
    expect(alone).toBeGreaterThan(fastOnReference);
  });

  it("uses the healthy distribution for a fault of the target on a reference host", () => {
    expect(catalog.likelihood("server.slow", "http.ttfb", "high", false)).toBe(catalog.likelihood(NONE, "http.ttfb", "high", false));
    expect(catalog.likelihood("captive.portal", "tls.trust", "private", false)).toBe(catalog.likelihood("captive.portal", "tls.trust", "private", true));
  });
});

describe("a fault with two reaches", () => {
  const primary = [e("tcp.time", "short"), e("tls.ratio", "high")];
  const reachOf = (evidence: readonly Evidence[], reach: string): number =>
    diagnose(catalog, evidence).causes.find((cause) => cause.id === "tls.proxy")?.reaches?.find((share) => share.reach === reach)?.probability ?? Number.NaN;

  it("gives the table of each reach on a reference host, and their mean without a reach", () => {
    const shared = catalog.likelihood("tls.proxy", "tls.ratio", "high", false, "shared");
    const target = catalog.likelihood("tls.proxy", "tls.ratio", "high", false, "target");
    expect(shared).toBe(catalog.likelihood("tls.proxy", "tls.ratio", "high", true));
    expect(target).toBe(catalog.likelihood(NONE, "tls.ratio", "high", false));
    expect(catalog.likelihood("tls.proxy", "tls.ratio", "high", false)).toBeCloseTo((shared + target) / 2, 12);
    expect(catalog.likelihood("tls.proxy", "tls.ratio", "high", true, "target")).toBe(catalog.likelihood("tls.proxy", "tls.ratio", "high", true));
  });

  it("gives no number for a reach that the fault does not have", () => {
    expect(catalog.likelihood("server.slow", "http.ttfb", "high", true, "shared")).toBeNaN();
    expect(catalog.hypotheses.find((h) => h.id === "server.slow")?.reach).toEqual(["target"]);
    expect(catalog.hypotheses.find((h) => h.id === "tls.proxy")?.reach).toEqual(["shared", "target"]);
  });

  it("gives the probability of each reach, with a sum of the probability of the cause", () => {
    const evidence = [...primary, e("tls.ratio", "high", false)];
    const cause = diagnose(catalog, evidence).causes.find((each) => each.id === "tls.proxy");
    expect(cause?.reaches?.map((share) => share.reach)).toEqual(["shared", "target"]);
    expect((cause?.reaches ?? []).reduce((sum, share) => sum + share.probability, 0)).toBeCloseTo(cause?.probability ?? Number.NaN, 12);
    expect(reachOf(evidence, "shared")).toBeGreaterThan(reachOf(evidence, "target"));
    const fastOnReference = [...primary, e("tls.ratio", "low", false)];
    expect(reachOf(fastOnReference, "target")).toBeGreaterThan(reachOf(fastOnReference, "shared"));
  });

  it("finds a fault of each reach: a proxy on the two hosts or on the path to the target only", () => {
    expect(top([...primary, e("tcp.time", "short", false), e("tls.ratio", "high", false)])).toBe("tls.proxy");
    // A slow handshake on the target alone fits a slow server too. A private issuer on the target only names the proxy.
    const targetOnly = [...primary, e("tls.trust", "private"), e("tcp.time", "short", false), e("tls.ratio", "low", false), e("tls.trust", "public", false)];
    expect(top(targetOnly)).toBe("tls.proxy");
    expect(reachOf(targetOnly, "target")).toBeGreaterThan(reachOf(targetOnly, "shared"));
  });

  it("gives one variant for a cause with no reach, and the reaches of a fault", () => {
    const causes = diagnose(catalog, primary).causes;
    const none = causes.find((cause) => cause.id === NONE);
    expect(none?.reaches).toBeUndefined();
    expect(causeVariants(none ?? causes[0]!)).toEqual([{ reach: undefined, probability: none?.probability }]);
    const proxy = causes.find((cause) => cause.id === "tls.proxy");
    expect(causeVariants(proxy ?? causes[0]!).map((variant) => variant.reach)).toEqual(["shared", "target"]);
  });

  it("explains a fault by its most probable reach", () => {
    const weights = explain(catalog, [...primary, e("tls.ratio", "low", false)], "tls.proxy");
    expect(weights.find((item) => !item.evidence.primary)?.weight).toBeCloseTo(0, 12);
    const shared = explain(catalog, [...primary, e("tls.ratio", "high", false)], "tls.proxy");
    expect(shared.find((item) => !item.evidence.primary)?.weight).toBeGreaterThan(0);
  });
});

describe("a fault with three reaches and their shares", () => {
  const reachOf = (evidence: readonly Evidence[], reach: string): number =>
    diagnose(catalog, evidence).causes.find((cause) => cause.id === "path.loss")?.reaches?.find((share) => share.reach === reach)?.probability ?? Number.NaN;

  it("keeps the local features healthy under the reach upstream, and changes the others on each host", () => {
    expect(catalog.likelihood("path.loss", "gateway.loss", "none", true, "upstream")).toBeCloseTo(catalog.likelihood(NONE, "gateway.loss", "none", true), 12);
    expect(catalog.likelihood("path.loss", "gateway.loss", "none", true, "shared")).toBeLessThan(catalog.likelihood(NONE, "gateway.loss", "none", true));
    expect(catalog.likelihood("path.loss", "path.loss", "some", false, "upstream")).toBe(catalog.likelihood("path.loss", "path.loss", "some", true, "upstream"));
    expect(catalog.likelihood("path.loss", "path.loss", "some", false, "target")).toBeCloseTo(catalog.likelihood(NONE, "path.loss", "some", false), 12);
  });

  it("gives each reach its share of the prior, and the mean of the reaches by their shares", () => {
    const whole = catalog.prior("path.loss");
    expect(catalog.prior("path.loss", undefined, "shared")).toBeCloseTo(whole / 4, 12);
    expect(catalog.prior("path.loss", undefined, "upstream")).toBeCloseTo(whole / 4, 12);
    expect(catalog.prior("path.loss", undefined, "target")).toBeCloseTo(whole / 2, 12);
    expect(catalog.prior("path.loss", "loss-5", "target")).toBeCloseTo(catalog.prior("path.loss", "loss-5") / 2, 12);
    expect(catalog.prior("tls.proxy", undefined, "target")).toBeCloseTo(catalog.prior("tls.proxy") / 2, 12);
    expect(catalog.prior("server.slow", undefined, "upstream")).toBe(0);
    const of = (reach: Reach): number => catalog.likelihood("path.loss", "gateway.loss", "none", false, reach);
    expect(catalog.likelihood("path.loss", "gateway.loss", "none", false)).toBeCloseTo(of("shared") / 4 + of("upstream") / 4 + of("target") / 2, 12);
  });

  it("finds where a loss starts: before the gateway or past it", () => {
    // A loss of 15 % loses 2 pings of 20 or more in 82 of 100 visits. One lost ping of 20 is a weak sign, because a
    // healthy path loses one in 8 of 100 visits.
    const past = [e("gateway.loss", "none"), e("path.loss", "high"), e("path.loss", "high", false)];
    expect(top(past)).toBe("path.loss");
    expect(reachOf(past, "upstream")).toBeGreaterThan(reachOf(past, "shared"));
    expect(reachOf(past, "upstream")).toBeGreaterThan(reachOf(past, "target"));
    const before = [e("gateway.loss", "high"), e("path.loss", "high"), e("path.loss", "high", false)];
    expect(reachOf(before, "shared")).toBeGreaterThan(reachOf(before, "upstream"));
  });
});

describe("a fault with degrees", () => {
  // A read of the simulated world: a loss of 76 % at the gateway. Each DNS try fails at the target and at the reference.
  // The reference replies to less than half of the pings.
  const heavy = [
    e("dns.answer", "timeout"),
    e("dns.answer", "timeout", false),
    e("gateway.reply", "reply", false),
    e("path.loss", "most", false),
    e("link.state", "up", false),
    e("wifi.signal", "strong", false),
    e("wifi.state", "connected", false),
  ];
  const lossOf = (evidence: readonly Evidence[]) => diagnose(catalog, evidence).causes.find((cause) => cause.id === "path.loss");
  const lossOfDegree = (degree: string | undefined): number => LOSS_DEGREES.find((each) => each.id === degree)?.loss ?? Number.NaN;
  const likeliestDegree = (evidence: readonly Evidence[]): string | undefined =>
    [...(lossOf(evidence)?.degrees ?? [])].sort((a, b) => b.probability - a.probability)[0]?.degree;

  it("names a heavy loss when each DNS try fails and the reference loses packets", () => {
    expect(top(heavy)).toBe("path.loss");
    expect(lossOfDegree(likeliestDegree(heavy))).toBeGreaterThanOrEqual(0.5);
  });

  it("takes the signs of a loss in each step from the tries of the step", () => {
    const healthy = (feature: string, value: string): number => catalog.likelihood(NONE, feature, value, true);
    for (const { id, loss } of LOSS_DEGREES) {
      for (const step of LOSS_STEPS) {
        const timeout = loss ** step.tries;
        const expected = Math.max(FLOOR, timeout + (1 - timeout) * healthy(step.feature, step.timeout));
        expect(catalog.likelihood("path.loss", step.feature, step.timeout, true, "target", id)).toBeCloseTo(expected, 12);
      }
    }
    // Under a loss of 0.7, a connect that passes lost its first SYN in 0.54 of the visits. So it gives retry.
    const heavy = lossOfDegree("loss-70");
    const late = (heavy - heavy ** 3) / (1 - heavy ** 3);
    expect(late).toBeCloseTo(0.543, 3);
    expect(catalog.likelihood("path.loss", "tcp.time", "retry", true, "target", "loss-70")).toBeCloseTo(late + (1 - late) * healthy("tcp.time", "retry"), 12);
    // The pings follow the binomial of 20 requests: a visit under a loss of 0.05 loses no ping with the chance 0.95^20.
    const none = (1 - STRENGTHS.sure) * healthy("path.loss", "none") + STRENGTHS.sure * 0.95 ** 20;
    expect(catalog.likelihood("path.loss", "path.loss", "none", true, "target", "loss-5")).toBeCloseTo(none, 3);
  });

  it("names a loss that passes its tries, and not a broken family, when the connects of one family fail", () => {
    // The case 1:path.loss#33 of the simulated world: a loss of 50 % near the target. Each step passed after a few tries.
    const passed = [
      e("dns.answer", "ok"),
      e("ip.family", "ipv4-only"),
      e("ip.family", "both", false),
      e("tcp.connect", "connected"),
      e("tcp.time", "retry"),
      e("tcp.connect", "connected", false),
      e("tcp.time", "short", false),
      e("tls.handshake", "ok"),
      e("tls.ratio", "low"),
      e("http.status", "ok"),
      e("http.ttfb", "low"),
      e("path.loss", "high"),
      e("path.loss", "none", false),
      e("gateway.loss", "none", false),
    ];
    expect(top(passed)).toBe("path.loss");
  });

  it("names a weak Wi-Fi signal with a heavy loss when DNS times out", () => {
    const weak = heavy.map((item) => (item.feature === "wifi.signal" ? e("wifi.signal", "weak", false) : item));
    expect(top(weak)).toBe("wifi.weak");
  });

  it("names a heavy loss on the path to the target when the connect times out and ping loses packets", () => {
    // A read of the simulated world: a loss of 38 % in each direction near the target.
    const target = [
      e("dns.answer", "ok"),
      e("dns.answer", "ok", false),
      e("tcp.connect", "timeout"),
      e("tcp.connect", "connected", false),
      e("tcp.time", "short", false),
      e("http.status", "ok", false),
      e("icmp.reply", "reply"),
      e("icmp.reply", "reply", false),
      e("path.loss", "most"),
      e("path.loss", "none", false),
    ];
    expect(top(target)).toBe("path.loss");
    expect(lossOfDegree(likeliestDegree(target))).toBeGreaterThanOrEqual(0.5);
  });

  it("gives the table of each degree, and their mean with the shares without a degree", () => {
    const timeouts = LOSS_DEGREES.map((degree) => catalog.likelihood("path.loss", "dns.answer", "timeout", true, "shared", degree.id));
    timeouts.slice(1).forEach((p, index) => expect(p).toBeGreaterThan(timeouts[index] ?? Number.NaN));
    const total = LOSS_DEGREES.reduce((sum, degree) => sum + degree.share, 0);
    const mean = LOSS_DEGREES.reduce((sum, degree, index) => sum + (degree.share / total) * (timeouts[index] ?? Number.NaN), 0);
    expect(catalog.likelihood("path.loss", "dns.answer", "timeout", true, "shared")).toBeCloseTo(mean, 12);
    // A larger loss gives more visits with less than half of the replies.
    const most = LOSS_DEGREES.map((degree) => catalog.likelihood("path.loss", "path.loss", "most", true, "shared", degree.id));
    most.slice(1).forEach((p, index) => expect(p).toBeGreaterThanOrEqual(most[index] ?? Number.NaN));
    // A degree keeps each prediction of the fault that it does not replace: each degree of wifi.weak keeps the weak signal.
    expect(catalog.likelihood("wifi.weak", "wifi.signal", "weak", false, undefined, "loss-5")).toBe(catalog.likelihood("wifi.weak", "wifi.signal", "weak", false, undefined, "loss-90"));
    expect(catalog.likelihood("wifi.weak", "wifi.signal", "weak", false, undefined, "loss-5")).toBeGreaterThan(catalog.likelihood(NONE, "wifi.signal", "weak", false));
    // A fault of the target uses the healthy distribution on a reference host for each degree.
    expect(catalog.likelihood("path.loss", "dns.answer", "timeout", false, "target", "loss-90")).toBe(catalog.likelihood(NONE, "dns.answer", "timeout", false));
  });

  it("gives the part of the prior of each degree", () => {
    const whole = catalog.prior("path.loss");
    expect(catalog.prior("path.loss", "loss-5")).toBeCloseTo((3 / 12) * whole, 12);
    expect(catalog.prior("path.loss", "loss-90")).toBeCloseTo((1 / 12) * whole, 12);
    expect(catalog.prior("path.loss", "medium")).toBe(0);
  });

  it("gives no number for a degree that the hypothesis does not have", () => {
    expect(catalog.likelihood("path.loss", "dns.answer", "timeout", true, undefined, "medium")).toBeNaN();
    expect(catalog.likelihood("server.slow", "http.ttfb", "high", true, undefined, "loss-90")).toBeNaN();
    expect(catalog.likelihood(NONE, "http.ttfb", "high", true, undefined, "loss-90")).toBeNaN();
    expect(catalog.hypotheses.find((h) => h.id === "path.loss")?.degree).toEqual(LOSS_DEGREES.map((degree) => degree.id));
    expect(catalog.hypotheses.find((h) => h.id === "server.slow")?.degree).toBeUndefined();
  });

  it("gives the probability of each degree and each variant, with a sum of the probability of the cause", () => {
    const cause = lossOf(heavy);
    const p = cause?.probability ?? Number.NaN;
    expect(cause?.degrees?.map((share) => share.degree)).toEqual(LOSS_DEGREES.map((degree) => degree.id));
    expect((cause?.degrees ?? []).reduce((sum, share) => sum + share.probability, 0)).toBeCloseTo(p, 12);
    expect((cause?.reaches ?? []).reduce((sum, share) => sum + share.probability, 0)).toBeCloseTo(p, 12);
    const variants = cause === undefined ? [] : causeVariants(cause);
    const expected = LOSS_DEGREES.flatMap((degree) => ["shared", "upstream", "target"].map((reach) => `${degree.id}/${reach}`));
    expect(variants.map((variant) => `${variant.degree ?? ""}/${variant.reach ?? ""}`)).toEqual(expected);
    expect(variants.reduce((sum, variant) => sum + variant.probability, 0)).toBeCloseTo(p, 12);
    const slow = diagnose(catalog, heavy).causes.find((each) => each.id === "server.slow");
    expect(slow?.degrees).toBeUndefined();
    expect(slow?.variants).toBeUndefined();
  });

  it("explains a fault by its most probable degree", () => {
    // The weight of the DNS timeout comes from the most probable degree of this read, a loss of 0.5 or more.
    const causes = diagnose(catalog, heavy).causes;
    const likeliest = (id: string) => {
      const cause = causes.find((each) => each.id === id);
      return cause === undefined ? undefined : [...causeVariants(cause)].sort((a, b) => b.probability - a.probability)[0];
    };
    const first = likeliest("path.loss");
    const second = likeliest("resolver.down");
    expect(lossOfDegree(first?.degree)).toBeGreaterThanOrEqual(0.5);
    const timeout = (id: string, variant: typeof first): number => catalog.likelihood(id, "dns.answer", "timeout", true, variant?.reach, variant?.degree);
    const why = explain(catalog, heavy, "path.loss", "resolver.down");
    const weight = why.find((item) => item.evidence.feature === "dns.answer" && item.evidence.primary)?.weight;
    expect(weight).toBeCloseTo(Math.log10(timeout("path.loss", first)) - Math.log10(timeout("resolver.down", second)), 12);
    expect(why[0]?.evidence.feature).toBe("path.loss");
  });
});

describe("the modes of a fault", () => {
  // The sample of a silent resolver: the DNS queries of the target and of the reference time out, and the gateway answers.
  const silent = [
    e("dns.answer", "timeout"),
    e("dns.answer", "timeout", false),
    e("gateway.reply", "reply", false),
    e("gateway.loss", "none", false),
    e("link.state", "up", false),
    e("wifi.signal", "strong", false),
    e("wifi.state", "connected", false),
  ];

  it("names a down resolver and its silent mode when each DNS query times out and the gateway answers", () => {
    expect(top(silent)).toBe("resolver.down");
    const cause = diagnose(catalog, silent).causes.find((each) => each.id === "resolver.down");
    expect([...(cause?.degrees ?? [])].sort((a, b) => b.probability - a.probability)[0]?.degree).toBe("silent");
  });

  it("counts a mode once for each visit, so more timeouts do not move the read to another fault", () => {
    // Before the modes, each subject paid for the split of the strength between two values. Four timeouts read as gateway.down.
    const four = [...silent, e("dns.answer", "timeout"), e("dns.answer", "timeout", false)];
    expect(top(four)).toBe("resolver.down");
    expect(probability(four, "resolver.down")).toBeGreaterThanOrEqual(probability(silent, "resolver.down"));
  });
});

describe("the evidence", () => {
  it("ignores an unknown feature or value, with the reason", () => {
    const result = diagnose(catalog, [e("tcp.connect", "refused"), e("smtp.banner", "ok"), e("tcp.connect", "maybe")]);
    expect(result.used).toHaveLength(1);
    expect(result.ignored.map((item) => item.reason)).toEqual(["The catalog has no feature smtp.banner.", '"maybe" is not a value of tcp.connect.']);
  });

  it("gives the priors when there is no evidence", () => {
    for (const cause of diagnose(catalog, []).causes) {
      expect(cause.probability).toBeCloseTo(catalog.prior(cause.id), 12);
      for (const share of cause.degrees ?? []) expect(share.probability).toBeCloseTo(catalog.prior(cause.id, share.degree), 12);
    }
  });

  it("explains a cause by the weight of each observation", () => {
    const evidence = [e("dns.answer", "ok"), e("tcp.connect", "refused")];
    const why = explain(catalog, evidence, "port.closed");
    expect(why[0]?.evidence.feature).toBe("tcp.connect");
    expect(why[0]?.weight).toBeCloseTo(Math.log10(0.9 / 0.01), 12);
    expect(why[1]?.weight).toBe(0);
  });

  it("predicts the values of a feature that is not observed", () => {
    const d = diagnose(catalog, [e("tcp.connect", "refused")]);
    const dist = predictive(catalog, d, "icmp.reply", true);
    expect(Object.values(dist).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(() => predictive(catalog, d, "smtp.banner", true)).toThrow(RangeError);
  });
});

const evidenceArb = fc.array(
  fc
    .constantFrom(...STANDARD_FEATURES)
    .chain((feature) => fc.record({ feature: fc.constant(feature.id), value: fc.constantFrom(...feature.values), primary: fc.boolean() })),
  { maxLength: 30 },
);

describe("the properties of the model", () => {
  it("gives probabilities from 0 to 1 with a sum of 1, from the most probable", () => {
    fc.assert(
      fc.property(evidenceArb, (evidence) => {
        const causes = diagnose(catalog, evidence).causes;
        const sum = causes.reduce((a, c) => a + c.probability, 0);
        expect(sum).toBeCloseTo(1, 9);
        for (let i = 0; i < causes.length; i += 1) {
          const p = causes[i]?.probability ?? Number.NaN;
          const reaches = causes[i]?.reaches;
          if (reaches !== undefined) expect(reaches.reduce((a, share) => a + share.probability, 0)).toBeCloseTo(p, 12);
          const degrees = causes[i]?.degrees;
          if (degrees !== undefined) expect(degrees.reduce((a, share) => a + share.probability, 0)).toBeCloseTo(p, 12);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          if (i > 0) expect(p).toBeLessThanOrEqual(causes[i - 1]?.probability ?? Number.NaN);
        }
      }),
      { seed: 20261115, numRuns: 300 },
    );
  });

  it("gives the same result for each order of the evidence", () => {
    fc.assert(
      fc.property(evidenceArb.chain((evidence) => fc.tuple(fc.constant(evidence), fc.shuffledSubarray(evidence, { minLength: evidence.length }))), ([a, b]) => {
        const pa = new Map(diagnose(catalog, a).causes.map((c) => [c.id, c.probability]));
        for (const cause of diagnose(catalog, b).causes) expect(cause.probability).toBeCloseTo(pa.get(cause.id) ?? Number.NaN, 12);
      }),
      { seed: 20261115, numRuns: 200 },
    );
  });

  // For a fault with two or more variants, the factor of one more observation is its likelihood under the posterior of the variants.
  it("changes the odds of two causes by the ratio of their likelihoods for one more observation", () => {
    const ids = catalog.hypotheses.map((h) => h.id);
    fc.assert(
      fc.property(evidenceArb, evidenceArb.filter((x) => x.length > 0), fc.constantFrom(...ids), fc.constantFrom(...ids), (before, [extra], a, b) => {
        if (extra === undefined) return;
        const p = (evidence: readonly Evidence[], id: string): number => diagnose(catalog, evidence).causes.find((c) => c.id === id)?.probability ?? Number.NaN;
        const oddsBefore = Math.log(p(before, a)) - Math.log(p(before, b));
        const oddsAfter = Math.log(p([...before, extra], a)) - Math.log(p([...before, extra], b));
        const causes = diagnose(catalog, before).causes;
        const factor = (id: string): number => {
          const cause = causes.find((c) => c.id === id);
          if (cause === undefined) return Number.NaN;
          const sum = causeVariants(cause).reduce((s, v) => s + v.probability * catalog.likelihood(id, extra.feature, extra.value, extra.primary, v.reach, v.degree), 0);
          return sum / cause.probability;
        };
        const ratio = Math.log(factor(a)) - Math.log(factor(b));
        if (Number.isFinite(oddsBefore) && Number.isFinite(oddsAfter) && Number.isFinite(ratio)) expect(oddsAfter - oddsBefore).toBeCloseTo(ratio, 6);
      }),
      { seed: 20261115, numRuns: 300 },
    );
  });
});

describe("alikeCauses", () => {
  const twin = (id: string, prior: number) => ({ id, part: "service" as const, layer: "tcp" as const, reach: "target" as const, summary: "", step: "", prior, predicts: { "tcp.connect": { expect: "timeout", strength: "strong" as const } } });
  // The fault d gives the timeout the same probability as a and b (0.9), but it moves the rest to refused.
  const tied = { ...twin("d", 1), predicts: { "tcp.connect": { connected: 0.001, refused: 0.099, timeout: 0.9 } } };
  const compiled = compileCatalog({ version: "t", features: [tcp], faults: [twin("a", 1), twin("b", 3), { ...twin("c", 1), predicts: { "tcp.connect": { expect: "refused", strength: "strong" } } }, tied] });
  const small = compiled.tag === "ok" ? compiled.value : catalog;

  it("gives the causes with the same predictions of the read features, also when their priors are not the same", () => {
    const diagnosis = diagnose(small, [e("tcp.connect", "timeout")]);
    expect(diagnosis.causes.map((cause) => cause.id).slice(0, 2)).toEqual(["b", "a"]);
    expect(alikeCauses(small, diagnosis, "a")).toEqual(["b"]);
    expect(alikeCauses(small, diagnosis, "b")).toEqual(["a"]);
    expect(alikeCauses(small, diagnosis, "c")).toEqual([]);
    expect(alikeDistance(small, diagnosis, "a", "b")).toBe(0);
    // With no evidence, the diagnosis read no feature, so each cause is alike to each other cause.
    const empty = diagnose(small, []);
    expect(alikeCauses(small, empty, NONE)).toEqual(empty.causes.map((cause) => cause.id).filter((id) => id !== NONE));
    expect(alikeCauses(small, empty, NONE)).toContain(UNKNOWN);
  });

  it("does not make a tie of the likelihoods of the evidence alone an alike cause", () => {
    const diagnosis = diagnose(small, [e("tcp.connect", "timeout")]);
    const p = new Map(diagnosis.causes.map((cause) => [cause.id, cause.probability]));
    expect(p.get("d")).toBeCloseTo(p.get("a") ?? 0, 12);
    expect(alikeCauses(small, diagnosis, "a")).not.toContain("d");
    // The rest of a goes mostly to connected (the healthy distribution), and d gives connected the probability 0.001.
    expect(alikeDistance(small, diagnosis, "a", "d")).toBeGreaterThan(ALIKE_EPSILON * ALIKE_MARGIN);
    const margin = alikeMargin(small, diagnosis, "a");
    expect(margin?.inner).toBe(0);
    expect(margin?.outer).toBe(Math.min(...["c", "d", NONE, UNKNOWN].map((id) => alikeDistance(small, diagnosis, "a", id))));
  });

  it("gives no alike cause for a cause that is not in the diagnosis, and refuses a bound below 0", () => {
    const diagnosis = diagnose(small, [e("tcp.connect", "timeout")]);
    expect(alikeCauses(small, diagnosis, "dns.slow")).toEqual([]);
    expect(alikeMargin(small, diagnosis, "dns.slow")).toBeUndefined();
    expect(alikeDistance(small, diagnosis, "a", "dns.slow")).toBe(Number.POSITIVE_INFINITY);
    expect(() => alikeCauses(small, diagnosis, "a", -1)).toThrow(RangeError);
    expect(() => alikeMargin(small, diagnosis, "a", -1)).toThrow(RangeError);
  });

  it("finds host.down alike to filter.drop on the evidence of a target that drops each packet", () => {
    // The kernel world of filter.drop gave this evidence in each round. The degree all of filter.drop and the degree
    // silent of host.down have the same predictions, so the read probes cannot tell them apart.
    const evidence = [
      "dns.answer=ok@target", "dns.answer=ok@reference", "tcp.connect=timeout@target", "tcp.connect=connected@reference",
      "tcp.time=short@reference", "tls.handshake=ok@reference", "tls.trust=public@reference", "tls.ratio=mid@reference",
      "http.status=ok@reference", "http.ttfb=mid@reference", "icmp.reply=none@target", "icmp.reply=reply@reference",
      "gateway.reply=reply@reference", "path.loss=none@reference", "gateway.loss=none@reference", "link.state=up@reference",
    ].map((text) => {
      const [pair = "", subject = ""] = text.split("@");
      const [feature = "", value = ""] = pair.split("=");
      return e(feature, value, subject === "target");
    });
    const diagnosis = diagnose(catalog, evidence);
    expect(diagnosis.ignored).toEqual([]);
    expect(diagnosis.causes.map((cause) => cause.id).slice(0, 2)).toEqual(["filter.drop", "host.down"]);
    expect(alikeCauses(catalog, diagnosis, "filter.drop")).toEqual(["host.down"]);
    expect(alikeCauses(catalog, diagnosis, "host.down")).toEqual(["filter.drop"]);
    expect(alikeCauses(catalog, diagnosis, "filter.drop", 0)).toEqual(["host.down"]);
    const margin = alikeMargin(catalog, diagnosis, "filter.drop");
    expect(margin?.inner).toBe(0);
    expect(margin?.outer).toBeGreaterThan(ALIKE_EPSILON * ALIKE_MARGIN);
  });

  it("is a symmetric relation that agrees with alikeDistance and alikeMargin", () => {
    const ids = catalog.hypotheses.map((h) => h.id);
    fc.assert(
      fc.property(evidenceArb, fc.constantFrom(...ids), (evidence, id) => {
        const diagnosis = diagnose(catalog, evidence);
        const alike = alikeCauses(catalog, diagnosis, id);
        for (const other of alike) expect(alikeCauses(catalog, diagnosis, other)).toContain(id);
        const live = diagnosis.causes.filter((cause) => cause.probability > 0 && cause.id !== id).map((cause) => cause.id);
        if (!live.length || !((diagnosis.causes.find((cause) => cause.id === id)?.probability ?? 0) > 0)) return;
        const distances = live.map((other) => ({ other, d: alikeDistance(catalog, diagnosis, id, other) }));
        expect(new Set(alike)).toEqual(new Set(distances.filter((each) => each.d <= ALIKE_EPSILON).map((each) => each.other)));
        for (const { other, d } of distances) expect(alikeDistance(catalog, diagnosis, other, id)).toBe(d);
        const margin = alikeMargin(catalog, diagnosis, id);
        const outside = distances.filter((each) => each.d > ALIKE_EPSILON).map((each) => each.d);
        expect(margin?.outer).toBe(outside.length > 0 ? Math.min(...outside) : undefined);
      }),
      { seed: 20261118, numRuns: 200 },
    );
  });
});
