import type { MtuTry, PathMtu } from "../kinds.ts";

// The search for the MTU of a path (ND-6, step 2). The state of a search is the list of its tries. Thus each decision
// is a function of the tries, and a test can replay a search with no tool.

/** The MTU of Ethernet, in bytes. It is the default ceiling of a search. */
export const ETHERNET_MTU = 1500;

/** The smallest MTU of IPv4 (RFC 791), in bytes. It is the floor of a search over IPv4. */
export const IPV4_MIN_MTU = 68;

/** The smallest MTU of IPv6 (RFC 8200), in bytes. It is the floor of a search over IPv6. */
export const IPV6_MIN_MTU = 1280;

/** The smallest and the largest size of a search for the MTU. Each size is the size of an IP packet in bytes. */
export interface MtuBounds {
  /** The smallest MTU of the family. Each link of a correct path passes this size. */
  readonly floor: number;
  /**
   * The size of a small echo request, below `floor`. The search tries this size when `floor` fails. When it passes, a
   * link of the path has an MTU below the floor, and the search finds that MTU. With no `least`, the search ends at `floor`.
   */
  readonly least?: number | undefined;
  /** The largest size. */
  readonly ceiling: number;
}

function checkBounds(bounds: MtuBounds): void {
  const { floor, least, ceiling } = bounds;
  if (!Number.isInteger(floor) || !Number.isInteger(ceiling) || floor < 1 || ceiling < floor) {
    throw new RangeError(`The bounds ${floor} and ${ceiling} are not two sizes in bytes with the floor at or below the ceiling.`);
  }
  if (least !== undefined && (!Number.isInteger(least) || least < 1 || least >= floor)) {
    throw new RangeError(`The size ${least} is not a size in bytes below the floor ${floor}.`);
  }
}

/** The largest size that passed, and the first try of the smallest size above it that failed. */
interface Found {
  readonly passed?: number | undefined;
  readonly failed?: MtuTry | undefined;
}

function foundOf(tries: readonly MtuTry[]): Found {
  let passed: number | undefined;
  for (const each of tries) if (each.result === "reply" && (passed === undefined || each.size > passed)) passed = each.size;
  let failed: MtuTry | undefined;
  for (const each of tries) {
    if (each.result !== "too-big" && each.result !== "none") continue;
    if (passed !== undefined && each.size <= passed) continue;
    if (failed === undefined || each.size < failed.size) failed = each;
  }
  return { passed, failed };
}

/**
 * This function gives the next size of a search for the MTU, or `undefined` when the search ends.
 *
 * 1. The first size is the ceiling. Most paths pass it, so most searches end after one try.
 * 2. The second size is the floor. Each link of a correct path passes it.
 * 3. When the floor fails, the next size is `least`. A path that does not pass `least` does not answer, so the search ends.
 *    With no `least`, the search ends when the floor fails.
 * 4. A message can tell an MTU between the largest size that passed and the smallest size that failed. That MTU is the next size.
 * 5. When the told MTU passes, the next size is one byte above it. Thus a true message ends the search in two tries.
 * 6. Each other size is the middle of the largest size that passed and the smallest size above it that failed.
 *
 * When a told MTU fails, a message was false. After that, the search uses no message, and each size is a middle. Thus
 * false messages cannot make the search long.
 *
 * An error ends the search. The search also ends when the two sizes are next to each other. The function does not give a
 * size that the search tried, so each search ends. A search has at most `4 + 3 * ceil(log2(ceiling - floor))` tries.
 * With `least`, the search has one more try, and `least` replaces `floor` in the formula.
 */
export function nextMtuSize(tries: readonly MtuTry[], bounds: MtuBounds): number | undefined {
  checkBounds(bounds);
  if (tries.some((each) => each.result === "error")) return undefined;
  const tried = (size: number): boolean => tries.some((each) => each.size === size);
  if (!tried(bounds.ceiling)) return bounds.ceiling;
  const { passed, failed } = foundOf(tries);
  if (passed !== undefined && passed >= bounds.ceiling) return undefined;
  if (!tried(bounds.floor)) return bounds.floor;
  if (passed === undefined && bounds.least !== undefined && !tried(bounds.least)) return bounds.least;
  if (passed === undefined || failed === undefined || failed.size - passed <= 1) return undefined;
  const told = new Set(tries.flatMap((each) => (each.result === "too-big" && each.mtu !== undefined ? [each.mtu] : [])));
  const trusted = !tries.some((each) => each.result !== "reply" && told.has(each.size));
  if (trusted) {
    const between = [...told].filter((mtu) => mtu > passed && mtu < failed.size && !tried(mtu));
    if (between.length > 0) return Math.max(...between);
    if (told.has(passed) && !tried(passed + 1)) return passed + 1;
  }
  return Math.floor((passed + failed.size) / 2);
}

/**
 * This function gives the value of a fact `path.mtu` from the tries of a search.
 *
 * - A try with an error gives the outcome `error`.
 * - With no size that passed, the outcome is `none`.
 * - Else the MTU is the largest size that passed. The smallest size above it that failed gives the stop: `message` for
 *   the result `too-big`, and `silent` for the result `none`.
 * - Tries with a size below the ceiling that passed, and no larger size that failed, do not bound the MTU. They give an error.
 */
export function mtuOf(address: string, tries: readonly MtuTry[], bounds: MtuBounds): PathMtu {
  checkBounds(bounds);
  const base = { address, ceiling: bounds.ceiling, tries: [...tries] };
  const error = tries.find((each) => each.result === "error");
  if (error !== undefined) return { ...base, outcome: "error", detail: error.detail ?? `The try of ${error.size} bytes failed.` };
  const { passed, failed } = foundOf(tries);
  if (passed === undefined) {
    const detail = tries.find((each) => each.detail !== undefined)?.detail;
    return detail === undefined ? { ...base, outcome: "none" } : { ...base, outcome: "none", detail };
  }
  if (passed >= bounds.ceiling) return { ...base, outcome: "measured", mtu: bounds.ceiling };
  if (failed === undefined) return { ...base, outcome: "error", detail: `No size above ${passed} bytes failed, so the tries do not bound the MTU.` };
  return { ...base, outcome: "measured", mtu: passed, stop: failed.result === "too-big" ? "message" : "silent" };
}
