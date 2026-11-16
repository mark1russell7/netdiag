import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PATH_MTU, type MtuTry, type PathMtu } from "../kinds.ts";
import { ETHERNET_MTU, IPV4_MIN_MTU, IPV6_MIN_MTU, mtuOf, nextMtuSize, type MtuBounds } from "./index.ts";

// The search for the MTU of a path (ND-6, step 2), on model paths with no tool.

/** A model path: the result of the echo requests of one size. */
type Path = (size: number) => Omit<MtuTry, "size">;

/** This function runs a search on a model path. Each size is new and in the bounds. */
function search(path: Path, bounds: MtuBounds): MtuTry[] {
  const tries: MtuTry[] = [];
  for (let size = nextMtuSize(tries, bounds); size !== undefined; size = nextMtuSize(tries, bounds)) {
    if (tries.some((each) => each.size === size)) throw new Error(`The search tried ${size} bytes two times.`);
    if (size < bounds.floor || size > bounds.ceiling) throw new Error(`The size ${size} is out of the bounds.`);
    tries.push({ size, ...path(size) });
  }
  return tries;
}

/** A path with the MTU `mtu` that drops each larger packet with no message: an MTU black hole. */
const blackHole =
  (mtu: number): Path =>
  (size) =>
    size <= mtu ? { result: "reply" } : { result: "none" };

/** A path with the MTU `mtu` that tells the MTU `told(size)` for each larger packet. */
const withMessage =
  (mtu: number, told: (size: number) => number | undefined = () => mtu): Path =>
  (size) => {
    if (size <= mtu) return { result: "reply" };
    const value = told(size);
    return value === undefined ? { result: "too-big" } : { result: "too-big", mtu: value };
  };

const V4: MtuBounds = { floor: IPV4_MIN_MTU, ceiling: ETHERNET_MTU };
const V6: MtuBounds = { floor: IPV6_MIN_MTU, ceiling: ETHERNET_MTU };

const halves = (bounds: MtuBounds): number => Math.ceil(Math.log2(Math.max(1, bounds.ceiling - bounds.floor)));
/** The largest number of tries of a search, from the doc comment of `nextMtuSize`. */
const most = (bounds: MtuBounds): number => 4 + 3 * halves(bounds);

const measure = (path: Path, bounds: MtuBounds): { tries: MtuTry[]; value: PathMtu } => {
  const tries = search(path, bounds);
  const value = mtuOf("192.0.2.1", tries, bounds);
  expect(PATH_MTU.check(value), JSON.stringify(value)).toBe(true);
  return { tries, value };
};

const sizes = (tries: readonly MtuTry[]): number[] => tries.map((each) => each.size);

describe("the search for the MTU", () => {
  it("ends after one try on a path that passes the ceiling", () => {
    for (const mtu of [ETHERNET_MTU, 9000]) {
      const { tries, value } = measure(blackHole(mtu), V4);
      expect(sizes(tries)).toEqual([ETHERNET_MTU]);
      expect(value).toMatchObject({ outcome: "measured", mtu: ETHERNET_MTU, ceiling: ETHERNET_MTU });
      expect(value.stop).toBeUndefined();
    }
  });

  it("finds the MTU of a black hole by halves", () => {
    const { tries, value } = measure(blackHole(1200), V4);
    expect(value).toMatchObject({ outcome: "measured", mtu: 1200, stop: "silent" });
    expect(sizes(tries).slice(0, 3)).toEqual([1500, 68, 784]);
    expect(tries.length).toBeLessThanOrEqual(2 + halves(V4));
  });

  it("uses a true message: the ceiling, the floor, the told MTU and one byte above it", () => {
    const { tries, value } = measure(withMessage(1400), V4);
    expect(sizes(tries)).toEqual([1500, 68, 1400, 1401]);
    expect(value).toMatchObject({ outcome: "measured", mtu: 1400, stop: "message" });
    expect(measure(withMessage(IPV4_MIN_MTU), V4).tries.map((each) => each.size)).toEqual([1500, 68, 69]);
  });

  it("finds the MTU when a message tells an MTU that is too low", () => {
    const { tries, value } = measure(withMessage(1400, () => 1300), V4);
    expect(sizes(tries).slice(0, 4)).toEqual([1500, 68, 1300, 1301]);
    expect(value).toMatchObject({ outcome: "measured", mtu: 1400, stop: "message" });
  });

  it("stops the trust in messages after a false one, so the search stays short", () => {
    // Each message tells one byte below the size. With trust in each message, the search tries each size from 1499 to 1001.
    const { tries, value } = measure(withMessage(1000, (size) => size - 1), V4);
    expect(sizes(tries).slice(0, 4)).toEqual([1500, 68, 1499, 783]);
    expect(value).toMatchObject({ outcome: "measured", mtu: 1000, stop: "message" });
    expect(tries.length).toBeLessThanOrEqual(most(V4));
  });

  it("uses the floor of IPv6", () => {
    const { tries, value } = measure(blackHole(1350), V6);
    expect(sizes(tries).slice(0, 2)).toEqual([1500, 1280]);
    expect(value).toMatchObject({ outcome: "measured", mtu: 1350, stop: "silent" });
  });

  it("gives the outcome none when the floor fails, with the first detail", () => {
    const path: Path = () => ({ result: "none", detail: "Destination Host Unreachable" });
    const { tries, value } = measure(path, V4);
    expect(sizes(tries)).toEqual([1500, 68]);
    expect(value).toMatchObject({ outcome: "none", detail: "Destination Host Unreachable" });
    expect(value.mtu).toBeUndefined();
  });

  it("ends at the first error, and gives the outcome error", () => {
    const path: Path = (size) => (size === 68 ? { result: "error", detail: "spawn ping ENOENT" } : { result: "none" });
    const { tries, value } = measure(path, V4);
    expect(sizes(tries)).toEqual([1500, 68]);
    expect(value).toMatchObject({ outcome: "error", detail: "spawn ping ENOENT" });
  });

  it("gives an error for tries that do not bound the MTU, and for bounds that are not valid", () => {
    expect(mtuOf("192.0.2.1", [{ size: 1000, result: "reply" }], V4)).toMatchObject({ outcome: "error", detail: expect.stringContaining("1000") });
    for (const bounds of [{ floor: 0, ceiling: 1500 }, { floor: 1500, ceiling: 1400 }, { floor: 68.5, ceiling: 1500 }]) {
      expect(() => nextMtuSize([], bounds)).toThrow(RangeError);
      expect(() => mtuOf("192.0.2.1", [], bounds)).toThrow(RangeError);
    }
  });
});

describe("a property of the search for the MTU", () => {
  const bounds = fc
    .record({ floor: fc.integer({ min: 1, max: 2000 }), width: fc.integer({ min: 0, max: 7216 }) })
    .map(({ floor, width }): MtuBounds => ({ floor, ceiling: floor + width }));
  const told = fc.func(fc.option(fc.integer({ min: 1, max: 9300 }), { nil: undefined }));

  it("finds the MTU of each path that passes each size up to its MTU, with any message", () => {
    fc.assert(
      fc.property(bounds, fc.double({ min: -0.1, max: 1.1, noNaN: true }), fc.constantFrom("silent", "true", "any"), told, (b, share, kind, tell) => {
        // A path MTU below 0 is not a path: no message tells a negative MTU.
        const mtu = Math.max(0, Math.round(b.floor + share * (b.ceiling - b.floor)));
        const path = kind === "silent" ? blackHole(mtu) : kind === "true" ? withMessage(mtu) : withMessage(mtu, tell);
        const { tries, value } = measure(path, b);
        if (mtu < b.floor) expect(value.outcome).toBe("none");
        else if (mtu >= b.ceiling) expect(value).toMatchObject({ outcome: "measured", mtu: b.ceiling });
        else expect(value).toMatchObject({ outcome: "measured", mtu, stop: kind === "silent" ? "silent" : "message" });
        expect(tries.length).toBeLessThanOrEqual(kind === "silent" ? 2 + halves(b) : kind === "true" ? 4 : most(b));
      }),
      { seed: 20261115, numRuns: 400 },
    );
  });

  it("ends within its bound on any path, and bounds the MTU when no try has an error", () => {
    const result = fc.oneof(
      { arbitrary: fc.constant<Omit<MtuTry, "size">>({ result: "reply" }), weight: 4 },
      { arbitrary: fc.constant<Omit<MtuTry, "size">>({ result: "none" }), weight: 3 },
      { arbitrary: fc.integer({ min: 1, max: 9300 }).map((mtu): Omit<MtuTry, "size"> => ({ result: "too-big", mtu })), weight: 3 },
      { arbitrary: fc.constant<Omit<MtuTry, "size">>({ result: "too-big" }), weight: 1 },
      { arbitrary: fc.constant<Omit<MtuTry, "size">>({ result: "error", detail: "test" }), weight: 1 },
    );
    fc.assert(
      fc.property(bounds, fc.func(result), (b, path) => {
        const { tries, value } = measure(path, b);
        expect(tries.length).toBeLessThanOrEqual(most(b));
        expect(value.outcome === "error").toBe(tries.some((each) => each.result === "error"));
      }),
      { seed: 20261116, numRuns: 400 },
    );
  });
});
