import { describe, expect, it } from "vitest";
import {
  DNS_PROBE,
  HTTP_PROBE,
  MAX_JOINT_VALUES,
  STANDARD_CATALOG,
  TCP_PROBE,
  TLS_PROBE,
  diagnose,
  featuresOf,
  rankProbes,
  type Candidate,
} from "./index.ts";
import { captureProbe, iperf3Probe, mtrProbe, pingProbe, tracerouteProbe, type ToolHost } from "./tools/index.ts";

// The gate of the size of a candidate: each probe of this package, with all of its facts, is one candidate that
// `rankProbes` can rank with `STANDARD_CATALOG`. A new feature or a new value can make a probe too large. Then this test
// fails before a planner does.

const host: ToolHost = {
  platform: "linux",
  run: () => Promise.reject(new Error("The gate of the size of a candidate starts no program.")),
};

const PROBES = [DNS_PROBE, TCP_PROBE, TLS_PROBE, HTTP_PROBE, pingProbe(host), tracerouteProbe(host), mtrProbe(host), captureProbe(host), iperf3Probe(host)];

/** This function gives the number of joint values of some features in `STANDARD_CATALOG`. */
function jointOf(features: readonly string[]): number {
  return features.reduce((product, feature) => product * (STANDARD_CATALOG.features.get(feature)?.values.length ?? Number.NaN), 1);
}

describe("each probe as one candidate", () => {
  it("has its features in the limit of joint values of rankProbes", () => {
    for (const probe of PROBES) {
      for (const gateway of [false, true]) {
        const joint = jointOf(featuresOf(probe.kinds.map((kind) => kind.kind), { gateway }));
        expect(joint, `${probe.id}, gateway ${String(gateway)}`).toBeLessThanOrEqual(MAX_JOINT_VALUES);
      }
    }
  });

  it("gets a gain from rankProbes, for the target and for a reference host", () => {
    const diagnosis = diagnose(STANDARD_CATALOG, []);
    const candidates: Candidate[] = PROBES.flatMap((probe) =>
      [true, false].map((primary) => ({
        id: `${probe.id} ${primary ? "target" : "reference"}`,
        observes: featuresOf(probe.kinds.map((kind) => kind.kind)).map((feature) => ({ feature, primary })),
      })),
    );
    for (const top of [3, undefined]) {
      const ranked = rankProbes(STANDARD_CATALOG, diagnosis, candidates, { top });
      expect(ranked).toHaveLength(candidates.length);
      for (const choice of ranked) expect(Number.isFinite(choice.gain), choice.candidate.id).toBe(true);
    }
  });

  it("gives the HTTPS request at least the gain of the TLS handshake, and the handshake at least the gain of the connect", () => {
    // The request gives the facts of the TCP connect and of the TLS handshake too. Thus its gain is at least theirs.
    const diagnosis = diagnose(STANDARD_CATALOG, []);
    const candidates: Candidate[] = [DNS_PROBE, TCP_PROBE, TLS_PROBE, HTTP_PROBE].map((probe) => ({
      id: probe.id,
      observes: featuresOf(probe.kinds.map((kind) => kind.kind)).map((feature) => ({ feature, primary: true })),
    }));
    const gains = new Map(rankProbes(STANDARD_CATALOG, diagnosis, candidates).map((choice) => [choice.candidate.id, choice.gain]));
    const gainOf = (id: string): number => gains.get(id) ?? Number.NaN;
    expect(jointOf(featuresOf(HTTP_PROBE.kinds.map((kind) => kind.kind)))).toBe(5400);
    expect(gainOf(HTTP_PROBE.id)).toBeGreaterThanOrEqual(gainOf(TLS_PROBE.id) - 1e-12);
    expect(gainOf(TLS_PROBE.id)).toBeGreaterThanOrEqual(gainOf(TCP_PROBE.id) - 1e-12);
  });
});
