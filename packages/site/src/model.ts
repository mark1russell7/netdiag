/**
 * The model of the demos. It has the observations of the board, the probes of the search, the world of a hidden fault
 * and the runs of the lab. It uses only the entry `@mark1russell7/netdiag/diagnosis`, which a browser can load.
 *
 * @packageDocumentation
 */
import {
  GAIN_RESOLUTION,
  LAYERS,
  NONE,
  STANDARD_CATALOG,
  STANDARD_FEATURES,
  UNKNOWN,
  diagnose,
  explain,
  labGate,
  labRecordOf,
  rankProbes,
  scoreLab,
  type Candidate,
  type Cause,
  type Contribution,
  type Diagnosis,
  type Evidence,
  type Feature,
  type LabGate,
  type LabRecord,
  type LabScore,
  type Layer,
  type ProbeChoice,
  type Reach,
} from "@mark1russell7/netdiag/diagnosis";
import { random } from "@mark1russell7/rigor-generators";

/** The catalog of the demos: the standard catalog of netdiag. */
export const CATALOG = STANDARD_CATALOG;

/** A short name of each feature for the board. The catalog gives the full summary. */
export const FEATURE_NAMES: Readonly<Record<string, string>> = {
  "link.state": "The link of the interface",
  "wifi.signal": "The Wi-Fi signal",
  "wifi.state": "The state of the Wi-Fi",
  "gateway.reply": "A ping of the gateway",
  "path.loss": "The packet loss",
  "path.mtu": "The MTU of the path",
  "dns.answer": "The DNS answer",
  "dns.address": "The address that DNS gives",
  "ip.family": "The address families that connect",
  "icmp.reply": "A ping of the target",
  "tcp.connect": "The TCP connect",
  "tcp.time": "The time of the TCP connect",
  "tls.handshake": "The TLS handshake",
  "tls.ratio": "The time of the TLS handshake",
  "tls.trust": "The root of the certificate",
  "http.status": "The HTTP status",
  "http.ttfb": "The time to the first byte",
};

/** The name of a layer for the board, from the bottom of the stack. */
export const LAYER_NAMES: Readonly<Record<Layer, string>> = {
  link: "Link",
  wifi: "Wi-Fi",
  ip: "IP",
  route: "Route",
  path: "Path",
  dns: "DNS",
  tcp: "TCP",
  tls: "TLS",
  http: "HTTP",
};

/** The features of the catalog in groups, one group for each layer, in the order of the layers. */
export function featureGroups(): readonly { readonly layer: Layer; readonly features: readonly Feature[] }[] {
  const features = [...CATALOG.features.values()];
  return LAYERS.map((layer) => ({ layer, features: features.filter((feature) => feature.layer === layer) })).filter((group) => group.features.length > 0);
}

/** This function gives the feature of an id. It throws for an id that the catalog does not have. */
export function featureOf(id: string): Feature {
  const feature = CATALOG.features.get(id);
  if (feature === undefined) throw new RangeError(`The catalog has no feature ${id}`);
  return feature;
}

/** A value is usual when a network with no fault gives it half of the time or more. */
export function isUsual(feature: string, value: string): boolean {
  return (featureOf(feature).healthy[value] ?? 0) >= 0.5;
}

/** The observations of the board: a value for each feature of the target, and of a second host. */
export interface Board {
  readonly target: Readonly<Record<string, string>>;
  readonly reference: Readonly<Record<string, string>>;
}

/** An empty board. */
export const EMPTY_BOARD: Board = { target: {}, reference: {} };

/** This function gives the evidence of a board: the target first, then the second host. */
export function evidenceOf(board: Board): Evidence[] {
  return [
    ...Object.entries(board.target).map(([feature, value]) => ({ feature, value, primary: true })),
    ...Object.entries(board.reference).map(([feature, value]) => ({ feature, value, primary: false })),
  ];
}

/** This function gives the value of a feature that a network with no fault gives most often. */
export function usualValue(feature: Feature): string {
  return feature.values.reduce((best, value) => ((feature.healthy[value] ?? 0) > (feature.healthy[best] ?? 0) ? value : best));
}

/** A scenario of the board: a name, and the observations. */
export interface Scenario {
  readonly label: string;
  readonly board: Board;
}

/** The scenarios of the board. A test holds the most probable cause of each one. */
export const SCENARIOS: readonly Scenario[] = [
  { label: "Everything works", board: { target: Object.fromEntries(STANDARD_FEATURES.map((feature) => [feature.id, usualValue(feature)])), reference: {} } },
  { label: "The DNS lookup times out", board: { target: { "gateway.reply": "reply", "dns.answer": "timeout" }, reference: {} } },
  { label: "The port refuses", board: { target: { "dns.answer": "ok", "tcp.connect": "refused" }, reference: {} } },
  { label: "No ping, and TCP connects", board: { target: { "icmp.reply": "none", "tcp.connect": "connected" }, reference: {} } },
  {
    label: "A slow handshake on two hosts",
    board: { target: { "tcp.time": "short", "tls.ratio": "high", "tls.trust": "private" }, reference: { "tls.ratio": "high", "tls.trust": "private" } },
  },
  {
    label: "A slow handshake on the target only",
    board: { target: { "tls.ratio": "high", "http.ttfb": "high" }, reference: { "tls.ratio": "low", "http.ttfb": "low" } },
  },
  {
    label: "A hotel network",
    board: { target: { "dns.address": "private", "tls.handshake": "cert-error", "tls.trust": "private" }, reference: {} },
  },
  {
    label: "Facts that disagree",
    board: { target: { "link.state": "down", "tcp.connect": "connected", "http.status": "ok" }, reference: {} },
  },
];

/** The ids of the most probable cause of each scenario, in the order of `SCENARIOS`. A test holds them. */
export const SCENARIO_CAUSES: readonly string[] = [
  NONE,
  "resolver.down",
  "port.closed",
  "filter.icmp",
  "tls.proxy",
  "server.slow",
  "captive.portal",
  UNKNOWN,
];

/** This function gives the diagnosis of a board. */
export function diagnoseBoard(board: Board): Diagnosis {
  return diagnose(CATALOG, evidenceOf(board));
}

/** The explanation of one cause: the cause, the second cause of the comparison, and the weight of each observation. */
export interface Explanation {
  readonly cause: Cause;
  readonly versus: Cause;
  readonly contributions: readonly Contribution[];
}

/**
 * This function tells why the diagnosis gives a cause its probability. It compares the cause with "no fault". For the
 * cause "no fault", it compares it with the most probable fault.
 */
export function explainCause(board: Board, diagnosis: Diagnosis, id: string): Explanation | undefined {
  const cause = diagnosis.causes.find((each) => each.id === id);
  const versus = id === NONE ? diagnosis.causes.find((each) => each.id !== NONE) : diagnosis.causes.find((each) => each.id === NONE);
  if (cause === undefined || versus === undefined) return undefined;
  return { cause, versus, contributions: explain(CATALOG, evidenceOf(board), cause.id, versus.id) };
}

/** This function gives a factor in plain words: "×12" for a weight of log10(12), and "÷12" for a weight of -log10(12). */
export function factorText(weight: number): string {
  const factor = 10 ** Math.abs(weight);
  const text = factor >= 100 ? Math.round(factor).toLocaleString("en-US") : factor >= 10 ? factor.toFixed(0) : factor.toFixed(1);
  return `${weight < 0 ? "÷" : "×"}${text}`;
}

/** A probe of the search: a candidate of `rankProbes`, with a name, the fact kinds of its facts and its time. */
export interface Probe extends Candidate {
  readonly label: string;
  /** The fact kinds that the probe gives. `featuresOf(kinds, { gateway })` of netdiag gives the features, and a test holds them. */
  readonly kinds: readonly string[];
  /** For an ICMP probe: `true` when it pings the gateway, `false` when it pings the target. */
  readonly gateway?: boolean | undefined;
  /** The time of the probe in seconds. It is the cost of the candidate. */
  readonly cost: number;
}

const target = (...features: string[]): Probe["observes"] => features.map((feature) => ({ feature, primary: true }));
const reference = (...features: string[]): Probe["observes"] => features.map((feature) => ({ feature, primary: false }));

/**
 * The probes of the search and of the lab. Each probe is a probe of netdiag. The HTTPS request gives the facts of the
 * TCP connect, the TLS handshake and the HTTP answer, so it observes 7 features. The TLS handshake costs less, and it
 * observes 5 of them.
 */
export const PROBES: readonly Probe[] = [
  { id: "dns", label: "Look up the name", kinds: ["dns.answer"], cost: 1, observes: target("dns.answer", "dns.address") },
  { id: "tcp", label: "Connect to the port", kinds: ["tcp.connect"], cost: 1, observes: target("tcp.connect", "tcp.time") },
  {
    id: "tls",
    label: "Make a TLS handshake",
    kinds: ["tcp.connect", "tls.handshake"],
    cost: 2,
    observes: target("tcp.connect", "tcp.time", "tls.handshake", "tls.trust", "tls.ratio"),
  },
  {
    id: "https",
    label: "Send an HTTPS request",
    kinds: ["tcp.connect", "tls.handshake", "http.response"],
    cost: 3,
    observes: target("tcp.connect", "tcp.time", "tls.handshake", "tls.trust", "tls.ratio", "http.status", "http.ttfb"),
  },
  { id: "ping-gateway", label: "Ping the gateway 20 times", kinds: ["icmp.echo"], gateway: true, cost: 20, observes: target("gateway.reply", "path.loss") },
  { id: "ping-target", label: "Ping the target 20 times", kinds: ["icmp.echo"], gateway: false, cost: 20, observes: target("icmp.reply", "path.loss") },
  { id: "mtr", label: "Measure the path with mtr", kinds: ["path.report"], cost: 20, observes: target("path.loss") },
  // The search for the MTU takes approximately 1 second on most paths, and up to 30 seconds on an MTU black hole.
  { id: "mtu", label: "Find the MTU of the path", kinds: ["path.mtu"], cost: 10, observes: target("path.mtu") },
  {
    id: "https-reference",
    label: "An HTTPS request to a second host",
    kinds: ["tcp.connect", "tls.handshake", "http.response"],
    cost: 3,
    observes: reference("tcp.connect", "tcp.time", "tls.handshake", "tls.trust", "tls.ratio", "http.status", "http.ttfb"),
  },
];

/** This function gives the probe of an id. It throws for an id that is not a probe of the demo. */
export function probeOf(id: string): Probe {
  const probe = PROBES.find((each) => each.id === id);
  if (probe === undefined) throw new RangeError(`The demo has no probe ${id}`);
  return probe;
}

/** The hypotheses that a world can make true: "no fault" and each fault. A world cannot make "unknown cause". */
export const TRUTHS: readonly string[] = CATALOG.hypotheses.filter((hypothesis) => hypothesis.kind !== "unknown").map((hypothesis) => hypothesis.id);

/** This function gives the hypothesis of an id. It throws for an id that the catalog does not have. */
export function hypothesisOf(id: string): (typeof CATALOG.hypotheses)[number] {
  const hypothesis = CATALOG.hypotheses.find((each) => each.id === id);
  if (hypothesis === undefined) throw new RangeError(`The catalog has no hypothesis ${id}`);
  return hypothesis;
}

/** This function draws the hidden fault of a seed from `TRUTHS`. */
export function hiddenTruth(seed: string): string {
  return random(`netdiag-demo/truth/${seed}`).pick(TRUTHS);
}

/**
 * This function gives the reach of the fault of a world. A fault with more than one reach gets one reach for each seed,
 * so each feature of the world agrees on it. A hypothesis with no reach gives no reach.
 */
export function worldReach(truth: string, seed: string): Reach | undefined {
  const reaches = hypothesisOf(truth).reach ?? [];
  if (reaches.length < 2) return reaches[0];
  return random(`netdiag-demo/reach/${seed}/${truth}`).pick(reaches);
}

/**
 * This function gives the degree of the fault of a world, for example a light or a heavy loss. It draws the degree by
 * its part of the prior, one for each seed, so each feature of the world agrees on it. A fault with no degrees gives no degree.
 */
export function worldDegree(truth: string, seed: string): string | undefined {
  const degrees = hypothesisOf(truth).degree ?? [];
  if (degrees.length < 2) return degrees[0];
  return degrees[random(`netdiag-demo/degree/${seed}/${truth}`).weighted(degrees.map((degree) => CATALOG.prior(truth, degree)))];
}

/**
 * This function gives the value that a world with a true hypothesis gives for one feature. It draws the value from the
 * likelihoods of the catalog, for the reach and the degree of the world. Each feature, role and seed has its own stream,
 * so the order of the probes does not change a value.
 */
export function observe(truth: string, seed: string, feature: string, primary: boolean): string {
  const { values } = featureOf(feature);
  const reach = worldReach(truth, seed);
  const degree = worldDegree(truth, seed);
  const weights = values.map((value) => CATALOG.likelihood(truth, feature, value, primary, reach, degree));
  const value = values[random(`netdiag-demo/world/${seed}/${truth}/${feature}/${primary ? "target" : "reference"}`).weighted(weights)];
  if (value === undefined) throw new RangeError(`No value of ${feature}`);
  return value;
}

/** The probability of the top cause at which the search stops. */
export const FOUND = 0.9;

/** One step of the search: the probe, its new observations, and the diagnosis after them. */
export interface Step {
  readonly probe: Probe;
  readonly observed: readonly Evidence[];
  readonly diagnosis: Diagnosis;
}

/** The state of a search for a hidden fault. */
export interface Search {
  readonly truth: string;
  readonly steps: readonly Step[];
  readonly diagnosis: Diagnosis;
  /** The probes from the largest expected information gain. */
  readonly ranked: readonly ProbeChoice[];
  /** The total time of the probes, in seconds. */
  readonly time: number;
}

const keyOf = (item: { readonly feature: string; readonly primary: boolean }): string => `${item.feature}/${item.primary ? "target" : "reference"}`;

/** This function replays a search: it starts the probes of `runs` in order, in the world of `truth` and `seed`. */
export function search(truth: string, seed: string, runs: readonly string[]): Search {
  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  const steps: Step[] = [];
  let diagnosis = diagnose(CATALOG, evidence);
  for (const id of runs) {
    const probe = probeOf(id);
    const observed = probe.observes
      .filter((item) => !seen.has(keyOf(item)))
      .map((item) => ({ feature: item.feature, primary: item.primary, value: observe(truth, seed, item.feature, item.primary) }));
    for (const item of observed) {
      seen.add(keyOf(item));
      evidence.push(item);
    }
    diagnosis = diagnose(CATALOG, evidence);
    steps.push({ probe, observed, diagnosis });
  }
  const ranked = rankProbes(CATALOG, diagnosis, PROBES);
  return { truth, steps, diagnosis, ranked, time: steps.reduce((sum, step) => sum + step.probe.cost, 0) };
}

/** This function tells if a search is at its end: one cause has `FOUND` or more, or no probe gives information. */
export function searchDone(state: Search): boolean {
  return (state.diagnosis.causes[0]?.probability ?? 0) >= FOUND || (state.ranked[0]?.gain ?? 0) <= GAIN_RESOLUTION;
}

/** This function starts the best probe until the search is at its end, with at most one run of each probe. */
export function autoSearch(truth: string, seed: string, runs: readonly string[]): string[] {
  const next = [...runs];
  for (let state = search(truth, seed, next); !searchDone(state) && next.length < PROBES.length; state = search(truth, seed, next)) {
    const best = state.ranked[0];
    if (best === undefined || best.gain <= GAIN_RESOLUTION) break;
    next.push(best.candidate.id);
  }
  return next;
}

/** The settings of the lab. */
export interface LabSettings {
  /** The number of runs of each hypothesis of `TRUTHS`. */
  readonly runs: number;
  readonly seed: string;
  /** The ids of the probes of each run. */
  readonly probes: readonly string[];
  /** The bar of each hypothesis: the least lower end of its recall interval. */
  readonly bar: number;
}

/** The result of the lab: the score, the verdicts of the gate, and the most frequent wrong cause of each hypothesis. */
export interface LabResult {
  readonly records: readonly LabRecord[];
  readonly score: LabScore;
  readonly gate: LabGate;
  readonly mistakes: ReadonlyMap<string, { readonly id: string; readonly count: number }>;
}

/** This function makes the runs of the lab, scores them and holds each recall with the bar. */
export function runLab(settings: LabSettings): LabResult {
  const observes = new Map<string, { feature: string; primary: boolean }>();
  for (const id of settings.probes) for (const item of probeOf(id).observes) observes.set(keyOf(item), item);
  const records: LabRecord[] = [];
  for (const truth of TRUTHS) {
    for (let run = 0; run < settings.runs; run++) {
      const seed = `lab/${settings.seed}/${run}`;
      const evidence = [...observes.values()].map((item) => ({ ...item, value: observe(truth, seed, item.feature, item.primary) }));
      const record = labRecordOf(CATALOG, `${truth}/${run}`, truth, diagnose(CATALOG, evidence));
      if (record.tag === "err") throw new Error(record.error);
      records.push(record.value);
    }
  }
  const score = scoreLab(CATALOG, records);
  if (score.tag === "err") throw new Error(score.error.join(" "));
  const gate = labGate(score.value, Object.fromEntries(TRUTHS.map((truth) => [truth, settings.bar])));
  if (gate.tag === "err") throw new Error(gate.error.join(" "));
  const mistakes = new Map<string, { id: string; count: number }>();
  const { labels, counts } = score.value.table;
  labels.forEach((truth, row) => {
    let best: { id: string; count: number } | undefined;
    labels.forEach((predicted, column) => {
      const count = counts[row]?.[column] ?? 0;
      if (predicted !== truth && count > 0 && (best === undefined || count > best.count)) best = { id: predicted, count };
    });
    if (best !== undefined) mistakes.set(truth, best);
  });
  return { records, score: score.value, gate: gate.value, mistakes };
}

/** This function gives a probability as a percent with no decimals, or with one decimal below 1 %. */
export function percent(p: number): string {
  if (p > 0 && p < 0.01) return `${(p * 100).toFixed(1)}%`;
  return `${Math.round(p * 100)}%`;
}
