import { causeVariants, NONE, UNKNOWN, type Catalog, type Diagnosis, type Reach } from "./model.ts";
import { STANDARD_POLICY } from "./standard-policy.ts";

/**
 * The kind of a recovery action. A service takes one action after a failed check or request.
 *
 * - `none`: the diagnosis finds no cause. The service keeps its usual backoff.
 * - `retry`: the fault is short. The service tries once more at once.
 * - `back-off`: the target or the path has too much load. The next try waits for a longer time.
 * - `change-path`: the route is bad. The service dials a different address of the same target, of the class `prefer`.
 * - `change-copy`: the copy is bad. The service sends the call to a different copy of the target.
 * - `wait-network`: a part of the network of the host is down. Each loop on that part waits until a probe passes.
 * - `stop`: the fault stays until a person repairs it. The service does not try again until a time.
 *
 * The service ends each wait and each stop at a limit of its own. Then it diagnoses the fault again.
 */
export type ActionKind = "none" | "retry" | "back-off" | "change-path" | "change-copy" | "wait-network" | "stop";

/** The kinds of action, from the least harm to the most harm. A tie of two kinds goes to the kind with less harm. */
export const ACTION_KINDS: readonly ActionKind[] = ["none", "retry", "back-off", "change-path", "change-copy", "wait-network", "stop"];

/**
 * The part of the network that a wait is on. The key of the wait names this part.
 *
 * - `network`: the link and the router of the host.
 * - `resolver`: the DNS resolver of the host.
 * - `upstream`: the network of the provider, past the router.
 */
export type WaitOn = "network" | "resolver" | "upstream";

/** A recovery action, with the values that its kind needs. */
export type Action =
  | { readonly kind: "none" }
  | { readonly kind: "retry" }
  | { readonly kind: "back-off"; readonly leastMs: number }
  | {
      readonly kind: "change-path";
      /** The label of the class of path to dial, for example `ipv4`. The label is opaque to the service. With no label, the service dials a different path of each class. */
      readonly prefer?: string | undefined;
    }
  | { readonly kind: "change-copy" }
  | { readonly kind: "wait-network"; readonly on: WaitOn }
  | { readonly kind: "stop"; readonly forMs: number | null };

/**
 * The action of some variants of one cause.
 *
 * A rule with no `reaches` applies to each reach, and a rule with no `degrees` applies to each degree. Each variant of
 * each cause has exactly one rule. `checkActions` finds a variant with no rule or with two rules.
 */
export interface ActionRule {
  /** The id of a fault of the catalog, or `NONE`, or `UNKNOWN`. */
  readonly cause: string;
  readonly reaches?: readonly Reach[] | undefined;
  readonly degrees?: readonly string[] | undefined;
  readonly action: Action;
  /**
   * The kinds of action that are harmful for these variants. A harmful action is worse than `none`. The default is
   * `harmOf` of the rule.
   */
  readonly harmful?: readonly ActionKind[] | undefined;
  /** The reason for the action, in plain words. */
  readonly why: string;
}

/**
 * The cost of an action for one variant, relative to the cost of `none`. The correct action of the variant costs 0.
 *
 * - `none`: the usual backoff of the service, when the variant has a different action. This cost is the unit.
 * - `useless`: an action that is not correct and not harmful, for a variant with a fault. It does not help, and it does no harm.
 * - `needless`: an action that is not harmful, for a variant whose action is `none`. The network has no fault, thus the
 *   action only slows the service. It costs as much as a useless action or more.
 * - `harmful`: an action that is harmful for the variant. It is worse than `none`, thus it costs more.
 */
export interface ActionCosts {
  readonly none: number;
  readonly useless: number;
  readonly needless: number;
  readonly harmful: number;
}

/**
 * The calibration map of the probabilities of the variants: two temperatures. A temperature `t` raises each probability
 * to the power `1 / t`, and then it divides each by their sum. A temperature over 1 makes a probability less certain.
 */
export interface Calibration {
  /** The temperature of the probability of each cause: the sum of the probabilities of its variants. */
  readonly cause: number;
  /** The temperature of the share of each variant in its cause: its reach and its degree. */
  readonly variant: number;
}

/** The calibration map that keeps each probability. */
export const NO_CALIBRATION: Calibration = { cause: 1, variant: 1 };

/**
 * The policy of `chooseAction`: the calibration map of the probabilities, and the costs of the actions.
 *
 * A harmful cost of `h` makes the choice take a harmful kind only at a probability of approximately `h / (h + 1)` or
 * more. A needless cost of `n` has a similar effect. The choice takes a kind that is not harmful only at approximately
 * `n` times the probability of `none`, or more. Thus the costs replace the floors of the kinds.
 */
export interface ActionPolicy {
  readonly calibration: Calibration;
  readonly costs: ActionCosts;
}

/**
 * This function gives the problems of a policy. An empty list tells that the policy is correct.
 *
 * - Each temperature is a finite number over 0.
 * - The cost of `none` is over 0. A useless action costs as much as `none` or more. A harmful action costs more than a useless action.
 * - A needless action costs as much as a useless action or more, and not more than a harmful action.
 */
export function checkPolicy(policy: ActionPolicy): string[] {
  const problems: string[] = [];
  const { calibration, costs } = policy;
  for (const [name, temperature] of Object.entries(calibration)) {
    if (!Number.isFinite(temperature) || temperature <= 0) problems.push(`The temperature of the ${name} is ${temperature}. It must be a finite number over 0.`);
  }
  if (!(costs.none > 0) || !Number.isFinite(costs.none)) problems.push(`The cost of none is ${costs.none}. It must be a finite number over 0.`);
  if (!(costs.useless >= costs.none) || !Number.isFinite(costs.useless)) problems.push(`The cost of a useless action is ${costs.useless}. It must be finite, and not less than the cost of none.`);
  if (!(costs.harmful > costs.useless) || !Number.isFinite(costs.harmful)) problems.push(`The cost of a harmful action is ${costs.harmful}. It must be finite, and more than the cost of a useless action.`);
  if (!(costs.needless >= costs.useless && costs.needless <= costs.harmful) || !Number.isFinite(costs.needless)) {
    problems.push(`The cost of a needless action is ${costs.needless}. It must be finite, not less than the cost of a useless action, and not more than the cost of a harmful action.`);
  }
  return problems;
}

/** The parts of a fault that leave the copy of the target healthy: the host and its local network. */
const HOST_PARTS: ReadonlySet<string> = new Set(["interface", "wifi", "gateway", "resolver"]);

/**
 * This function gives the kinds of action that are harmful for the variants of a rule, when the rule names none.
 *
 * - A `stop` is harmful unless the fault stays until a person repairs it.
 * - A `wait-network` stops each loop on its key. It is harmful unless the correct action is a wait or a stop.
 * - A `change-copy` is harmful when the copy is healthy: no fault, or a fault of the host, of its network or upstream.
 * - A `retry` at once is harmful when the target has too much load.
 * - `none`, `back-off` and `change-path` are not harmful at any time. They try again later or by a different address.
 */
export function harmOf(catalog: Catalog, rule: ActionRule): readonly ActionKind[] {
  const kind = rule.action.kind;
  const harmful = new Set<ActionKind>();
  if (kind !== "stop") harmful.add("stop");
  if (kind !== "stop" && kind !== "wait-network") harmful.add("wait-network");
  const h = catalog.hypotheses.find((each) => each.id === rule.cause);
  const reaches = rule.reaches ?? h?.reach ?? [];
  const healthyCopy = h === undefined || h.kind !== "fault" || HOST_PARTS.has(h.part ?? "") || !reaches.includes("target");
  if (kind !== "change-copy" && healthyCopy) harmful.add("change-copy");
  if (rule.cause === "server.slow" && kind !== "retry") harmful.add("retry");
  return ACTION_KINDS.filter((each) => harmful.has(each));
}

const harmMemo = new WeakMap<Catalog, WeakMap<ActionRule, readonly ActionKind[]>>();

/** This function gives the kinds of action that are harmful for the variants of a rule: its own list, or `harmOf`. */
export function harmfulOf(catalog: Catalog, rule: ActionRule): readonly ActionKind[] {
  if (rule.harmful !== undefined) return rule.harmful;
  const rules = harmMemo.get(catalog) ?? new WeakMap<ActionRule, readonly ActionKind[]>();
  harmMemo.set(catalog, rules);
  const known = rules.get(rule);
  if (known !== undefined) return known;
  const harmful = harmOf(catalog, rule);
  rules.set(rule, harmful);
  return harmful;
}

const SMALL_LOSS = ["loss-5", "loss-15"];
const MEDIUM_LOSS = ["loss-30", "loss-50"];
const LARGE_LOSS = ["loss-70", "loss-90"];
const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** The action of each variant of each cause of `STANDARD_CATALOG`, and of `NONE` and `UNKNOWN`. */
export const STANDARD_ACTIONS: readonly ActionRule[] = [
  { cause: NONE, action: { kind: "none" }, why: "The diagnosis finds no fault in the network, thus the usual backoff applies." },
  { cause: UNKNOWN, action: { kind: "none" }, why: "The cause is not in the catalog, thus the usual backoff applies." },
  { cause: "interface.down", action: { kind: "wait-network", on: "network" }, why: "The host has no link. Each call fails until the link operates again." },
  { cause: "wifi.weak", degrees: SMALL_LOSS, action: { kind: "retry" }, why: "A small loss stops few calls. A second try usually succeeds." },
  { cause: "wifi.weak", degrees: MEDIUM_LOSS, action: { kind: "back-off", leastMs: SECOND }, why: "A large loss stops many calls. Fewer tries keep the load of the weak link low." },
  { cause: "wifi.weak", degrees: LARGE_LOSS, action: { kind: "wait-network", on: "network" }, why: "Almost each packet is lost. Each call fails until the link is better." },
  { cause: "gateway.down", action: { kind: "wait-network", on: "network" }, why: "The router does not forward packets. Each call past the router fails until it operates again." },
  { cause: "captive.portal", action: { kind: "wait-network", on: "network" }, why: "The network holds each connection until a person accepts its terms. A probe sees the end of the portal." },
  { cause: "resolver.down", action: { kind: "wait-network", on: "resolver" }, why: "The resolver does not answer. Each name fails until the resolver operates again." },
  { cause: "resolver.failing", action: { kind: "back-off", leastMs: 2 * SECOND }, why: "The resolver gives errors for some names. A later try can succeed when the resolver recovers." },
  { cause: "name.missing", action: { kind: "stop", forMs: 5 * MINUTE }, why: "The name has no DNS record. Resolvers keep that answer for some minutes. Only a change of the zone repairs it." },
  { cause: "port.closed", action: { kind: "change-copy" }, why: "No program listens on the port of this copy. A different copy can listen." },
  { cause: "host.down", action: { kind: "change-copy" }, why: "This copy does not answer. A different copy can answer." },
  { cause: "filter.drop", action: { kind: "change-copy" }, why: "A firewall drops the packets to this copy. A different copy can be behind a different firewall." },
  { cause: "filter.icmp", action: { kind: "none" }, harmful: ["change-copy", "wait-network", "stop"], why: "The filter stops only ICMP, not the call. Thus the network does not cause the failure." },
  { cause: "filter.reset", action: { kind: "stop", forMs: null }, why: "A filter on the path resets each connection to this target. Each try gets the same reset." },
  { cause: "path.loss", degrees: SMALL_LOSS, action: { kind: "retry" }, why: "A small loss stops few calls. A second try usually succeeds." },
  { cause: "path.loss", reaches: ["shared"], degrees: MEDIUM_LOSS, action: { kind: "back-off", leastMs: SECOND }, why: "The local network loses many packets. Fewer tries keep its load low." },
  { cause: "path.loss", reaches: ["shared"], degrees: LARGE_LOSS, action: { kind: "wait-network", on: "network" }, why: "The local network loses almost each packet. Each call fails until it is better." },
  { cause: "path.loss", reaches: ["upstream"], degrees: MEDIUM_LOSS, action: { kind: "back-off", leastMs: SECOND }, why: "The network of the provider loses many packets. Each copy is past it, thus fewer tries help." },
  { cause: "path.loss", reaches: ["upstream"], degrees: LARGE_LOSS, action: { kind: "wait-network", on: "upstream" }, why: "The network of the provider loses almost each packet. Each call past it fails until it is better." },
  { cause: "path.loss", reaches: ["target"], degrees: [...MEDIUM_LOSS, ...LARGE_LOSS], action: { kind: "change-copy" }, why: "The loss is near this copy only. A copy at a different place has a different path." },
  { cause: "path.mtu", reaches: ["shared"], action: { kind: "stop", forMs: null }, why: "A link of the host has a small MTU. Large packets fail to each target until a person repairs it." },
  { cause: "path.mtu", reaches: ["target"], action: { kind: "change-copy" }, why: "A link near this copy has a small MTU. A copy at a different place has a different path." },
  { cause: "ipv6.broken", action: { kind: "change-path", prefer: "ipv4" }, why: "IPv6 does not operate on the path. An IPv4 address of the same target avoids the fault." },
  { cause: "tls.proxy", reaches: ["shared"], action: { kind: "wait-network", on: "network" }, why: "A proxy of the local network replaces each certificate. No call goes through it. A probe sees a different network." },
  { cause: "tls.proxy", reaches: ["target"], action: { kind: "stop", forMs: null }, why: "A proxy on the path to this target replaces its certificate. No call goes through it." },
  { cause: "tls.cert-invalid", action: { kind: "stop", forMs: null }, why: "The certificate of the server is not valid. Only a new certificate repairs it. Do not skip the check." },
  { cause: "tls.mismatch", action: { kind: "stop", forMs: null }, why: "The server and the client have no TLS version or cipher in common. Only a change of configuration repairs it." },
  { cause: "server.slow", action: { kind: "back-off", leastMs: 2 * SECOND }, why: "The server has too much load. A longer time between tries decreases its load." },
  { cause: "server.error", action: { kind: "change-copy" }, why: "This copy gives errors. A different copy can operate correctly." },
  {
    cause: "proxy.error",
    action: { kind: "back-off", leastMs: 5 * SECOND },
    harmful: ["change-copy", "wait-network", "stop"],
    why: "A TLS proxy of the network gives errors, also when it stops only the target. Each copy goes through it. A later try can succeed when it recovers.",
  },
];

/** This function tells if a rule applies to one variant of a cause. */
const applies = (rule: ActionRule, cause: string, reach: Reach | undefined, degree: string | undefined): boolean =>
  rule.cause === cause &&
  (rule.reaches === undefined || (reach !== undefined && rule.reaches.includes(reach))) &&
  (rule.degrees === undefined || (degree !== undefined && rule.degrees.includes(degree)));

/** This function gives the one rule of a variant of a cause. It throws when the variant has no rule or two rules. */
export function ruleOf(rules: readonly ActionRule[], cause: string, reach?: Reach, degree?: string): ActionRule {
  const found = rules.filter((rule) => applies(rule, cause, reach, degree));
  const name = [cause, reach, degree].filter((part) => part !== undefined).join(" ");
  const [rule] = found;
  if (rule === undefined) throw new RangeError(`The variant ${name} has no action rule.`);
  if (found.length > 1) throw new RangeError(`The variant ${name} has ${found.length} action rules. It must have one.`);
  return rule;
}

/**
 * This function gives the problems of a list of rules for a catalog. An empty list tells that the rules are correct.
 *
 * - Each rule names a hypothesis of the catalog, and only its reaches and degrees.
 * - Each variant of each hypothesis has exactly one rule.
 * - Each time and each delay is a whole number of milliseconds of 1 or more.
 * - The harmful kinds of a rule do not have the kind of its action, or `none`.
 */
export function checkActions(catalog: Catalog, rules: readonly ActionRule[]): string[] {
  const problems: string[] = [];
  const hypotheses = new Map(catalog.hypotheses.map((h) => [h.id, h]));
  for (const rule of rules) {
    const h = hypotheses.get(rule.cause);
    if (h === undefined) {
      problems.push(`A rule names ${rule.cause}, which the catalog does not have.`);
      continue;
    }
    for (const reach of rule.reaches ?? []) if (!(h.reach ?? []).includes(reach)) problems.push(`A rule of ${rule.cause} names the reach ${reach}, which the cause does not have.`);
    for (const degree of rule.degrees ?? []) if (!(h.degree ?? []).includes(degree)) problems.push(`A rule of ${rule.cause} names the degree ${degree}, which the cause does not have.`);
    const ms = rule.action.kind === "back-off" ? rule.action.leastMs : rule.action.kind === "stop" ? (rule.action.forMs ?? 1) : 1;
    if (!Number.isSafeInteger(ms) || ms < 1) problems.push(`The action of a rule of ${rule.cause} has the time ${ms}. It must be a whole number of milliseconds of 1 or more.`);
    const harmful = harmfulOf(catalog, rule);
    if (harmful.includes(rule.action.kind) || harmful.includes("none")) problems.push(`A rule of ${rule.cause} names its own action or none as harmful.`);
  }
  for (const h of catalog.hypotheses) {
    const reaches: readonly (Reach | undefined)[] = h.reach !== undefined && h.reach.length > 0 ? h.reach : [undefined];
    const degrees: readonly (string | undefined)[] = h.degree !== undefined && h.degree.length > 0 ? h.degree : [undefined];
    for (const reach of reaches) for (const degree of degrees) {
      const count = rules.filter((rule) => applies(rule, h.id, reach, degree)).length;
      const name = [h.id, reach, degree].filter((part) => part !== undefined).join(" ");
      if (count !== 1) problems.push(`The variant ${name} has ${count} action rules. It must have one.`);
    }
  }
  return problems;
}

/**
 * This function gives the cost of the action kind `kind` for the variants of a rule, with the costs of a policy. A kind
 * that is not harmful and not `none` costs `costs.needless` when the action of the rule is `none`, and `costs.useless` for other rules.
 */
export function actionCost(catalog: Catalog, rule: ActionRule, kind: ActionKind, costs: ActionCosts): number {
  if (kind === rule.action.kind) return 0;
  if (harmfulOf(catalog, rule).includes(kind)) return costs.harmful;
  if (kind === "none") return costs.none;
  return rule.action.kind === "none" ? costs.needless : costs.useless;
}

/** The rule of one variant of a diagnosis, and its probability after the calibration map. */
export interface RuledVariant {
  readonly rule: ActionRule;
  readonly probability: number;
}

/**
 * This function applies a calibration map to the probabilities of variants. It keeps only the variants with a probability over 0.
 *
 * - The map tempers the probability of each cause with `calibration.cause`.
 * - The map tempers the share of each variant in its cause with `calibration.variant`.
 * - The probability of a variant is the probability of its cause multiplied by its share.
 *
 * A temperature `t` raises each value to the power `1 / t`, and then it divides each by their sum. The function uses
 * logarithms, so a very small value does not become 0. A sweep of maps applies it many times, thus it uses plain loops.
 */
export function temper(variants: readonly RuledVariant[], calibration: Calibration): RuledVariant[] {
  const kept = variants.filter((each) => each.probability > 0);
  const n = kept.length;
  if (n === 0) return [];
  const groupOf = new Map<string, number>();
  const group = new Array<number>(n);
  const mass: number[] = [];
  for (let i = 0; i < n; i++) {
    const { rule, probability } = kept[i] as RuledVariant;
    let g = groupOf.get(rule.cause);
    if (g === undefined) {
      g = mass.length;
      groupOf.set(rule.cause, g);
      mass.push(0);
    }
    group[i] = g;
    mass[g] = (mass[g] as number) + probability;
  }
  const causes = mass.length;
  // The share of each variant in its cause, tempered and then divided by the sum of its cause.
  const share = new Array<number>(n);
  const top = new Array<number>(causes).fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < n; i++) {
    const g = group[i] as number;
    const log = Math.log((kept[i] as RuledVariant).probability / (mass[g] as number)) / calibration.variant;
    share[i] = log;
    if (log > (top[g] as number)) top[g] = log;
  }
  const sum = new Array<number>(causes).fill(0);
  for (let i = 0; i < n; i++) {
    const g = group[i] as number;
    const weight = Math.exp((share[i] as number) - (top[g] as number));
    share[i] = weight;
    sum[g] = (sum[g] as number) + weight;
  }
  // The probability of each cause, tempered and then divided by the sum of the causes.
  let highest = Number.NEGATIVE_INFINITY;
  const causeWeight = new Array<number>(causes);
  for (let g = 0; g < causes; g++) {
    const log = Math.log(mass[g] as number) / calibration.cause;
    causeWeight[g] = log;
    if (log > highest) highest = log;
  }
  let total = 0;
  for (let g = 0; g < causes; g++) {
    const weight = Math.exp((causeWeight[g] as number) - highest);
    causeWeight[g] = weight;
    total += weight;
  }
  const result = new Array<RuledVariant>(n);
  for (let i = 0; i < n; i++) {
    const g = group[i] as number;
    result[i] = { rule: (kept[i] as RuledVariant).rule, probability: ((causeWeight[g] as number) / total) * ((share[i] as number) / (sum[g] as number)) };
  }
  return result;
}

/**
 * This function gives the rule of each variant of each cause of a diagnosis, with its probability after a calibration
 * map. The probabilities add up to 1, or the list is empty when each variant has a probability of 0.
 */
export function ruledVariants(diagnosis: Diagnosis, rules: readonly ActionRule[], calibration: Calibration = NO_CALIBRATION): RuledVariant[] {
  const raw: RuledVariant[] = [];
  for (const cause of diagnosis.causes) for (const variant of causeVariants(cause)) {
    if (variant.probability > 0) raw.push({ rule: ruleOf(rules, cause.id, variant.reach, variant.degree), probability: variant.probability });
  }
  return temper(raw, calibration);
}

/**
 * This function gives the probability of each kind of action of variants: the sum of the probabilities of the variants
 * whose rule has that kind. A kind with no variant has no entry. Each probability stops at 1, because a sum can pass 1
 * by a rounding error of the last bit.
 */
export function kindProbabilities(variants: readonly RuledVariant[]): Partial<Record<ActionKind, number>> {
  const sums: Partial<Record<ActionKind, number>> = {};
  for (const { rule, probability } of variants) sums[rule.action.kind] = (sums[rule.action.kind] ?? 0) + probability;
  for (const kind of ACTION_KINDS) if (sums[kind] !== undefined) sums[kind] = Math.min(1, sums[kind]);
  return sums;
}

/** The probability and the expected cost of one kind of action. */
export interface KindShare {
  readonly kind: ActionKind;
  /** The sum of the probabilities of the variants whose rule has this kind, after the calibration map. */
  readonly probability: number;
  /** The sum over the variants of the probability of the variant multiplied by the cost of this kind for the variant. */
  readonly cost: number;
}

/** The action that a diagnosis chooses, with its confidence, its expected cost and the share of each candidate kind. */
export interface ActionChoice {
  readonly action: Action;
  /** The probability that the chosen kind is the correct kind, from 0 to 1, after the calibration map. */
  readonly confidence: number;
  /** The expected cost of the chosen action. */
  readonly cost: number;
  /** The share of `none` and of each kind of a variant with a probability over 0, from the least expected cost. */
  readonly kinds: readonly KindShare[];
}

/**
 * This function chooses the action for a diagnosis: the kind with the least expected cost.
 *
 * - The calibration map of the policy sets the probability of each variant.
 * - The expected cost of a kind is the sum over the variants of the probability of the variant multiplied by `actionCost`.
 * - The candidates are `none` and the kind of each variant. A tie goes to the kind with less harm.
 * - The values of the action come from the most probable variant of the chosen kind.
 */
export function chooseAction(catalog: Catalog, diagnosis: Diagnosis, rules: readonly ActionRule[], policy: ActionPolicy = STANDARD_POLICY): ActionChoice {
  return chooseByCost(catalog, ruledVariants(diagnosis, rules, policy.calibration), policy.costs);
}

/** This function chooses the kind with the least expected cost for variants with their rules, as `chooseAction` does. */
export function chooseByCost(catalog: Catalog, variants: readonly RuledVariant[], costs: ActionCosts): ActionChoice {
  const probabilities = kindProbabilities(variants);
  // The action of each kind is the action of its most probable variant.
  const best = new Map<ActionKind, { action: Action; probability: number }>([["none", { action: { kind: "none" }, probability: -1 }]]);
  for (const { rule, probability } of variants) {
    const known = best.get(rule.action.kind);
    if (known === undefined || probability > known.probability) best.set(rule.action.kind, { action: rule.action, probability });
  }
  const rank = (kind: ActionKind): number => ACTION_KINDS.indexOf(kind);
  const kinds: KindShare[] = [...best.keys()]
    .map((kind) => ({ kind, probability: probabilities[kind] ?? 0, cost: variants.reduce((sum, each) => sum + each.probability * actionCost(catalog, each.rule, kind, costs), 0) }))
    .sort((a, b) => a.cost - b.cost || rank(a.kind) - rank(b.kind));
  const [chosen = { kind: "none" as const, probability: 0, cost: 0 }] = kinds;
  return { action: best.get(chosen.kind)?.action ?? { kind: "none" }, confidence: chosen.probability, cost: chosen.cost, kinds };
}
