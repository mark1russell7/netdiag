import { binomialTest, holm } from "@mark1russell7/rigor-statistics";
import { factsOf, type Fact } from "../fact.ts";
import { PATH_OWNER, PATH_REPORT, type PathOwner, type PathReport } from "../kinds.ts";
import { lossOf, type LossEstimate } from "./loss.ts";

// Where the loss of a path starts. A router can drop its own answers to the probes of mtr and pass the other packets. So
// the loss of a hop tells only a little. A loss of the path continues to each later hop and to the destination. Thus
// the start of the loss is after the last hop with a loss clearly lower than the loss of the destination.

/** The level of the tests that find the hops with a lower loss. The correction of Holm keeps it for all the hops. */
export const LOSS_START_LEVEL = 0.05;

/** A hop of a report with an address and its loss. */
export interface LossHop {
  readonly ttl: number;
  readonly address: string;
  readonly loss: LossEstimate;
}

/** The part of a path where the loss to the destination can start. */
export interface LossStart {
  /** The destination of the report. */
  readonly address: string;
  /** The loss at the destination. */
  readonly loss: LossEstimate;
  /** The last hop with a loss clearly lower than the loss of the destination. Without it, the loss can start on the first link. */
  readonly after?: LossHop | undefined;
  /** The hops where the loss can start, in the order of the path. The last one is the destination. */
  readonly hops: readonly LossHop[];
}

/** This function gives the hops of a report with an address and a loss, in the order of the TTL. */
function lossHops(report: PathReport): LossHop[] {
  return [...report.hops]
    .sort((a, b) => a.ttl - b.ttl)
    .flatMap((hop) => {
      const loss = lossOf(hop.sent, hop.received);
      return hop.address === undefined || loss === undefined ? [] : [{ ttl: hop.ttl, address: hop.address, loss }];
    });
}

/**
 * This function gives the part of the path of a report of `mtr` where the loss to the destination starts. It gives
 * `undefined` when the report did not reach the destination, or when the destination has no loss.
 *
 * - An exact binomial test examines each earlier hop. The claim is "the loss of the hop is the low end of the destination
 *   loss, or more".
 * - The correction of Holm at `level` rejects the claims of some hops. These hops have a lower loss.
 * - The loss starts after the last of these hops, at one of the later hops or at the destination.
 *
 * The low end of the interval of the destination makes the test conservative. A small number of cycles thus gives a long
 * part of the path, not a false hop.
 */
export function lossStart(report: PathReport, level: number = LOSS_START_LEVEL): LossStart | undefined {
  if (report.outcome !== "reached") return undefined;
  const hops = lossHops(report);
  const destination = hops.at(-1);
  if (destination === undefined || destination.loss.lost === 0) return undefined;
  const earlier = hops.slice(0, -1);
  const tests = holm(
    earlier.map((hop) => binomialTest(hop.loss.lost, hop.loss.sent, destination.loss.low, "less")),
    level,
  );
  const lower = earlier.flatMap((hop, index) => (tests[index]?.reject === true ? [hop] : []));
  const after = lower.at(-1);
  const from = after === undefined ? 0 : hops.indexOf(after) + 1;
  return { address: report.address, loss: destination.loss, ...(after === undefined ? {} : { after }), hops: hops.slice(from) };
}

/** A network of the part of a path where the loss can start, with its hops. */
export interface LossNetwork {
  /** The owner of the first hop of the network. Without it, the visit did not look up the owner of the hop. */
  readonly owner?: PathOwner | undefined;
  readonly hops: readonly LossHop[];
}

/** This function gives the key of the network of an owner. Two hops with one key are in one network. */
function networkKey(owner: PathOwner | undefined, address: string): string {
  if (owner?.outcome === "found" && owner.network !== undefined) return `network ${owner.registry ?? ""} ${owner.network.handle}`;
  return `address ${address}`;
}

/**
 * This function puts the hops of a loss start in their networks, from the owners of the hops. Two next hops in one
 * network go in one item. A hop without a found owner is an item of its own.
 */
export function lossNetworks(start: LossStart, owners: readonly PathOwner[]): LossNetwork[] {
  const byAddress = new Map(owners.map((owner) => [owner.address, owner]));
  const networks: { owner?: PathOwner | undefined; key: string; hops: LossHop[] }[] = [];
  for (const hop of start.hops) {
    const owner = byAddress.get(hop.address);
    const key = networkKey(owner, hop.address);
    const last = networks.at(-1);
    if (last !== undefined && last.key === key) last.hops.push(hop);
    else networks.push({ ...(owner === undefined ? {} : { owner }), key, hops: [hop] });
  }
  return networks.map(({ owner, hops }) => (owner === undefined ? { hops } : { owner, hops }));
}

/** The start of the loss of one report of `mtr`, with the networks of its hops. */
export interface LossOrigin {
  /** The id of the fact `path.report`. */
  readonly fact: string;
  readonly start: LossStart;
  readonly networks: readonly LossNetwork[];
}

/**
 * This function gives the start of the loss of each fact `path.report` with a loss at the destination. The facts
 * `path.owner` give the networks of the hops. Without these facts, each hop is a network of its own.
 */
export function lossOrigins(facts: readonly Fact[], level: number = LOSS_START_LEVEL): LossOrigin[] {
  const owners = factsOf(PATH_OWNER, facts).map((fact) => fact.value);
  return factsOf(PATH_REPORT, facts).flatMap((fact) => {
    const start = lossStart(fact.value, level);
    return start === undefined ? [] : [{ fact: fact.id, start, networks: lossNetworks(start, owners) }];
  });
}
