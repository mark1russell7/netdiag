import { wilson } from "@mark1russell7/rigor-statistics";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CapturedPacket, IcmpEcho, PathCapture } from "../kinds.ts";
import { ackSamples, bandwidthOf, delayMetrics, echoMetrics, ipdv, lossOf, packetPairs, pdv, rfc3550Jitter, rtoOf } from "./index.ts";

// The estimators of ND-6, from fixed numbers and from properties. The numbers of the examples are exact in binary.

const delays = fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), { minLength: 2, maxLength: 40 });

describe("the jitter of RFC 3550", () => {
  it("moves by 1/16 of the difference at each change of the delay", () => {
    // D = 2, -1, 4: J = 2/16, then J + (1 - J)/16, then J + (4 - J)/16.
    expect(rfc3550Jitter([10, 12, 11, 15])).toBe(0.41845703125);
  });

  it("has no value for fewer than 2 delays", () => {
    expect(rfc3550Jitter([])).toBeUndefined();
    expect(rfc3550Jitter([7])).toBeUndefined();
  });

  it("is 0 for equal delays, and stays from 0 to the largest change", () => {
    expect(rfc3550Jitter([5, 5, 5, 5])).toBe(0);
    fc.assert(
      fc.property(delays, (list) => {
        const jitter = rfc3550Jitter(list) ?? Number.NaN;
        const largest = Math.max(...ipdv(list).map(Math.abs));
        expect(jitter).toBeGreaterThanOrEqual(0);
        expect(jitter).toBeLessThanOrEqual(largest * (1 + 1e-12) + 1e-12);
      }),
      { seed: 20261115, numRuns: 200 },
    );
  });

  it("does not change when each delay moves by one offset, as a round trip with a clock offset does", () => {
    fc.assert(
      fc.property(delays, fc.double({ min: -500, max: 500, noNaN: true }), (list, offset) => {
        expect(rfc3550Jitter(list.map((delay) => delay + offset))).toBeCloseTo(rfc3550Jitter(list) ?? Number.NaN, 6);
      }),
      { seed: 20261116, numRuns: 200 },
    );
  });
});

describe("the delay variation of RFC 3393 and RFC 5481", () => {
  it("gives the IPDV of each pair in sequence, and the PDV of each packet", () => {
    expect(ipdv([10, 12, 11, 15])).toEqual([2, -1, 4]);
    expect(pdv([10, 12, 11, 15])).toEqual([0, 2, 1, 5]);
    expect(ipdv([4])).toEqual([]);
    expect(pdv([])).toEqual([]);
  });

  it("gives an IPDV whose sum is the last delay less the first, and a PDV whose smallest value is 0", () => {
    fc.assert(
      fc.property(delays, (list) => {
        expect(ipdv(list).reduce((sum, step) => sum + step, 0)).toBeCloseTo(list.at(-1)! - list[0]!, 6);
        expect(Math.min(...pdv(list))).toBe(0);
      }),
      { seed: 20261117, numRuns: 200 },
    );
  });
});

describe("the summary of the delays", () => {
  it("gives each measure of a list", () => {
    const summary = delayMetrics([10, 12, 11, 15]);
    expect(summary).toMatchObject({ samples: 4, minMs: 10, medianMs: 11.5, meanMs: 12, maxMs: 15, jitterMs: 0.41845703125, ipdvMs: 2 });
    expect(summary?.sdMs).toBeCloseTo(Math.sqrt(14 / 3), 12);
    // The linear quantile 0.99 of the PDV 0, 1, 2, 5: 2 + 0.97 * 3.
    expect(summary?.pdvMs).toBeCloseTo(4.91, 12);
  });

  it("gives no spread for one delay, and no summary for no delay or a value that is not finite", () => {
    expect(delayMetrics([7])).toEqual({ samples: 1, minMs: 7, medianMs: 7, meanMs: 7, maxMs: 7, pdvMs: 0 });
    expect(delayMetrics([])).toBeUndefined();
    expect(delayMetrics([3, Number.NaN])).toBeUndefined();
    expect(delayMetrics([3, Number.POSITIVE_INFINITY])).toBeUndefined();
  });
});

describe("the loss of RFC 7680", () => {
  it("gives the share of the lost packets with its Wilson interval", () => {
    const interval = wilson(2, 20);
    expect(lossOf(20, 18)).toEqual({ sent: 20, lost: 2, ratio: 0.1, low: interval.low, high: interval.high });
    expect(lossOf(5, 5)?.ratio).toBe(0);
  });

  it("gives no estimate for no packet, for more replies than requests, or for counts that are not whole", () => {
    expect(lossOf(0, 0)).toBeUndefined();
    expect(lossOf(5, 6)).toBeUndefined();
    expect(lossOf(5, -1)).toBeUndefined();
    expect(lossOf(2.5, 1)).toBeUndefined();
  });

  it("gives the metrics of an echo fact", () => {
    const echo: IcmpEcho = { address: "192.0.2.10", outcome: "reply", sent: 4, received: 3, rttMs: [10, 12, 11] };
    const metrics = echoMetrics(echo);
    expect(metrics.address).toBe("192.0.2.10");
    expect(metrics.loss?.ratio).toBe(0.25);
    expect(metrics.delay?.samples).toBe(3);
    expect(echoMetrics({ address: "192.0.2.10", outcome: "error", sent: 0, received: 0, rttMs: [] })).toEqual({ address: "192.0.2.10" });
  });
});

describe("the RTO of RFC 6298", () => {
  it("sets SRTT to R and RTTVAR to R / 2 at the first sample, then changes RTTVAR before SRTT", () => {
    expect(rtoOf([100], { minMs: 0 })).toEqual({ samples: 1, srttMs: 100, rttvarMs: 50, rtoMs: 300 });
    // RTTVAR = 3/4 * 50 + 1/4 * 20 = 42.5 and SRTT = 102.5. Then RTTVAR = 3/4 * 42.5 + 1/4 * 22.5 = 37.5 and SRTT = 99.6875.
    expect(rtoOf([100, 120, 80], { minMs: 0 })).toEqual({ samples: 3, srttMs: 99.6875, rttvarMs: 37.5, rtoMs: 249.6875 });
  });

  it("keeps the RTO in its bounds, and adds G when 4 * RTTVAR is smaller", () => {
    expect(rtoOf([100])?.rtoMs).toBe(1000);
    expect(rtoOf([100_000])?.rtoMs).toBe(60_000);
    const steady = rtoOf(Array.from({ length: 40 }, () => 100), { minMs: 0, granularityMs: 50 });
    expect(steady?.rtoMs).toBe(150);
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 100_000, noNaN: true }), { minLength: 1, maxLength: 30 }), (samples) => {
        const estimate = rtoOf(samples, { minMs: 200, maxMs: 120_000 });
        expect(estimate?.rtoMs).toBeGreaterThanOrEqual(200);
        expect(estimate?.rtoMs).toBeLessThanOrEqual(120_000);
      }),
      { seed: 20261118, numRuns: 200 },
    );
  });

  it("gives no estimate for no sample, or for a sample that is negative or not finite", () => {
    expect(rtoOf([])).toBeUndefined();
    expect(rtoOf([10, -1])).toBeUndefined();
    expect(rtoOf([Number.NaN])).toBeUndefined();
  });
});

const LOCAL = "192.0.2.2";
const REMOTE = "203.0.113.10";
const SYN = 0x02;
const ACK = 0x10;
const PSH_ACK = 0x18;

function tcp(atMs: number, from: "local" | "remote", fields: Partial<CapturedPacket>): CapturedPacket {
  const local = from === "local";
  return {
    atMs,
    src: local ? LOCAL : REMOTE,
    dst: local ? REMOTE : LOCAL,
    protocol: "tcp",
    srcPort: local ? 50_000 : 443,
    dstPort: local ? 443 : 50_000,
    bytes: 66 + (fields.payload ?? 0),
    ...fields,
  };
}

function capture(packets: readonly CapturedPacket[]): PathCapture {
  return { address: REMOTE, port: 443, protocol: "tcp", device: "eth0", filter: `tcp and host ${REMOTE} and port 443`, outcome: "captured", packets };
}

// A connect, two segments with an ACK each, a retransmission of the second segment, and a third segment.
const FLOW: readonly CapturedPacket[] = [
  tcp(0, "local", { seq: 0, flags: SYN }),
  tcp(10, "remote", { seq: 0, ack: 1, flags: SYN | ACK, ackRttMs: 10 }),
  tcp(10.5, "local", { seq: 1, ack: 1, flags: ACK, ackRttMs: 0.5 }),
  tcp(11, "local", { seq: 1, ack: 1, payload: 100, flags: PSH_ACK }),
  tcp(21, "remote", { seq: 1, ack: 101, flags: ACK, ackRttMs: 10 }),
  tcp(22, "local", { seq: 101, ack: 1, payload: 100, flags: PSH_ACK }),
  tcp(322, "local", { seq: 101, ack: 1, payload: 100, flags: PSH_ACK, retransmission: true }),
  tcp(332, "remote", { seq: 1, ack: 201, flags: ACK, ackRttMs: 10 }),
  tcp(333, "local", { seq: 201, ack: 1, payload: 50, flags: PSH_ACK }),
  tcp(345, "remote", { seq: 1, ack: 251, flags: ACK, ackRttMs: 12 }),
];

describe("the RTT samples of a capture", () => {
  it("takes the ACKs of the remote host, and no ACK of a retransmitted segment (the rule of Karn)", () => {
    expect(ackSamples(capture(FLOW))).toEqual([10, 10, 12]);
  });

  it("finds a retransmission that tshark did not mark, from the end of the segment", () => {
    const unmarked = FLOW.map((packet) => (packet.retransmission === true ? { ...packet, retransmission: undefined } : packet));
    expect(ackSamples(capture(unmarked))).toEqual([10, 10, 12]);
  });

  it("gives no sample for an ACK of a segment before the capture, or for a packet that is not TCP", () => {
    expect(ackSamples(capture(FLOW.slice(4)))).toEqual([12]);
    const other: CapturedPacket = { atMs: 1, src: REMOTE, dst: LOCAL, protocol: "other", bytes: 98 };
    expect(ackSamples(capture([other]))).toEqual([]);
  });

  it("gives the samples that rtoOf reads", () => {
    expect(rtoOf(ackSamples(capture(FLOW)), { minMs: 0 })?.samples).toBe(3);
  });
});

const FULL = 1448;
const FRAME = 66 + FULL;

/** A burst of the remote host: full segments in sequence, with one gap between each two, from the time 100. */
function burst(gapsMs: readonly number[]): CapturedPacket[] {
  let atMs = 100;
  return [0, ...gapsMs].map((gap, index) => {
    atMs += gap;
    return tcp(atMs, "remote", { seq: 1 + index * FULL, ack: 100, payload: FULL, flags: ACK });
  });
}

describe("the packet pairs", () => {
  it("divides the frame of the second segment by the gap", () => {
    // 1514 bytes each 0.125 ms: 1514 * 8 * 8000 bits per second.
    expect(packetPairs(capture(burst([0.125, 0.125, 0.125])))).toEqual([96_896_000, 96_896_000, 96_896_000]);
  });

  it("takes no pair with a short segment, a lost segment, a retransmission or no gap", () => {
    const [a, b, c, d] = burst([0.125, 0.125, 0.125]) as [CapturedPacket, CapturedPacket, CapturedPacket, CapturedPacket];
    const short = { ...d, payload: 500, bytes: 566 };
    expect(packetPairs(capture([a, b, c, short]))).toHaveLength(2);
    expect(packetPairs(capture([a, c]))).toEqual([]);
    expect(packetPairs(capture([a, { ...b, retransmission: true }]))).toEqual([]);
    expect(packetPairs(capture([a, { ...b, atMs: a.atMs }]))).toEqual([]);
    expect(FRAME).toBe(a.bytes);
  });

  it("does not take a pair across the ACKs of the local host, and takes no segment of the local host", () => {
    const [a, b] = burst([0.25]) as [CapturedPacket, CapturedPacket];
    const ack = tcp(100.125, "local", { seq: 100, ack: 1 + FULL, flags: ACK });
    expect(packetPairs(capture([a, ack, b]))).toEqual([48_448_000]);
    expect(packetPairs(capture(FLOW))).toEqual([]);
  });

  it("gives estimates that scale down when each gap scales up", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0.01, max: 10, noNaN: true }), { minLength: 1, maxLength: 12 }), fc.integer({ min: 2, max: 8 }), (gaps, factor) => {
        const base = packetPairs(capture(burst(gaps)));
        const slow = packetPairs(capture(burst(gaps.map((gap) => gap * factor))));
        expect(slow).toHaveLength(base.length);
        slow.forEach((estimate, index) => expect(estimate * factor).toBeCloseTo(base[index]!, -2));
      }),
      { seed: 20261119, numRuns: 100 },
    );
  });

  it("gives the median of the pairs with its interval, and no estimate with no pair", () => {
    const estimate = bandwidthOf(capture(burst([0.125, 0.25, 0.125, 0.125])));
    expect(estimate).toMatchObject({ pairs: 4, bitsPerSecond: 96_896_000, low: 48_448_000, high: 96_896_000 });
    expect(estimate?.coverage).toBeLessThan(0.95);
    expect(bandwidthOf(capture(FLOW))).toBeUndefined();
  });
});
