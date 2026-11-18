import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FLOOR,
  NONE,
  STANDARD_CATALOG,
  STANDARD_CATALOG_SPEC,
  STANDARD_FEATURES,
  UNKNOWN,
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

describe("a fault with degrees", () => {
  // A read of the simulated world: a loss of 76 % at the gateway. Each DNS try fails at the target and at the reference.
  const heavy = [
    e("dns.answer", "timeout"),
    e("dns.answer", "timeout", false),
    e("gateway.reply", "reply", false),
    e("path.loss", "high", false),
    e("link.state", "up", false),
    e("wifi.signal", "strong", false),
    e("wifi.state", "connected", false),
  ];
  const lossOf = (evidence: readonly Evidence[]) => diagnose(catalog, evidence).causes.find((cause) => cause.id === "path.loss");
  const degreeOf = (evidence: readonly Evidence[], degree: string): number => lossOf(evidence)?.degrees?.find((share) => share.degree === degree)?.probability ?? Number.NaN;

  it("names a heavy loss when each DNS try fails and the reference loses packets", () => {
    expect(top(heavy)).toBe("path.loss");
    expect(degreeOf(heavy, "heavy")).toBeGreaterThan(degreeOf(heavy, "light"));
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
      e("path.loss", "high"),
      e("path.loss", "none", false),
    ];
    expect(top(target)).toBe("path.loss");
    expect(degreeOf(target, "heavy")).toBeGreaterThan(degreeOf(target, "light"));
  });

  it("gives the table of each degree, and their mean with the shares without a degree", () => {
    const light = catalog.likelihood("path.loss", "dns.answer", "timeout", true, "shared", "light");
    const severe = catalog.likelihood("path.loss", "dns.answer", "timeout", true, "shared", "heavy");
    expect(light).toBe(catalog.likelihood(NONE, "dns.answer", "timeout", true));
    expect(severe).toBeCloseTo(0.45, 12);
    expect(catalog.likelihood("path.loss", "dns.answer", "timeout", true, "shared")).toBeCloseTo(0.75 * light + 0.25 * severe, 12);
    // A degree keeps each prediction of the fault that it does not replace.
    expect(catalog.likelihood("path.loss", "http.ttfb", "high", true, "shared", "heavy")).toBe(catalog.likelihood("path.loss", "http.ttfb", "high", true, "shared", "light"));
    // A fault of the target uses the healthy distribution on a reference host for each degree.
    expect(catalog.likelihood("path.loss", "dns.answer", "timeout", false, "target", "heavy")).toBe(catalog.likelihood(NONE, "dns.answer", "timeout", false));
  });

  it("gives the part of the prior of each degree", () => {
    const whole = catalog.prior("path.loss");
    expect(catalog.prior("path.loss", "light")).toBeCloseTo(0.75 * whole, 12);
    expect(catalog.prior("path.loss", "heavy")).toBeCloseTo(0.25 * whole, 12);
    expect(catalog.prior("path.loss", "medium")).toBe(0);
  });

  it("gives no number for a degree that the hypothesis does not have", () => {
    expect(catalog.likelihood("path.loss", "dns.answer", "timeout", true, undefined, "medium")).toBeNaN();
    expect(catalog.likelihood("server.slow", "http.ttfb", "high", true, undefined, "heavy")).toBeNaN();
    expect(catalog.likelihood(NONE, "http.ttfb", "high", true, undefined, "heavy")).toBeNaN();
    expect(catalog.hypotheses.find((h) => h.id === "path.loss")?.degree).toEqual(["light", "heavy"]);
    expect(catalog.hypotheses.find((h) => h.id === "server.slow")?.degree).toBeUndefined();
  });

  it("gives the probability of each degree and each variant, with a sum of the probability of the cause", () => {
    const cause = lossOf(heavy);
    const p = cause?.probability ?? Number.NaN;
    expect(cause?.degrees?.map((share) => share.degree)).toEqual(["light", "heavy"]);
    expect((cause?.degrees ?? []).reduce((sum, share) => sum + share.probability, 0)).toBeCloseTo(p, 12);
    expect((cause?.reaches ?? []).reduce((sum, share) => sum + share.probability, 0)).toBeCloseTo(p, 12);
    const variants = cause === undefined ? [] : causeVariants(cause);
    expect(variants.map((variant) => `${variant.degree ?? ""}/${variant.reach ?? ""}`)).toEqual(["light/shared", "light/target", "heavy/shared", "heavy/target"]);
    expect(variants.reduce((sum, variant) => sum + variant.probability, 0)).toBeCloseTo(p, 12);
    const slow = diagnose(catalog, heavy).causes.find((each) => each.id === "server.slow");
    expect(slow?.degrees).toBeUndefined();
    expect(slow?.variants).toBeUndefined();
  });

  it("explains a fault by its most probable degree", () => {
    // Under the degree heavy, a DNS timeout has the same probability as under a down resolver.
    const why = explain(catalog, heavy, "path.loss", "resolver.down");
    expect(why.find((item) => item.evidence.feature === "dns.answer" && item.evidence.primary)?.weight).toBeCloseTo(0, 12);
    expect(why[0]?.evidence.feature).toBe("path.loss");
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
