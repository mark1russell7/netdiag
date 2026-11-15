import { median, medianInterval } from "@mark1russell7/rigor-statistics";
import { canonicalAddress } from "../address/index.ts";
import type { CapturedPacket, PathCapture } from "../kinds.ts";

// The capacity of the narrowest link of a path from packet pairs (ND-6). The capture is at the receiver.

/** The level of the interval of `bandwidthOf`. */
export const PAIR_LEVEL = 0.95;

const flowOf = (packet: CapturedPacket): string => `${packet.srcPort ?? ""}|${packet.dstPort ?? ""}`;

/**
 * This function gives one estimate of the capacity of the narrowest link for each packet pair of a capture. The
 * estimates are in bits per second, in the order of the capture.
 *
 * - A pair is two data segments from the remote host, one after the other in the capture, of one flow, in sequence.
 * - Both segments have the largest frame of the data segments of their flow. A burst of the sender has such segments.
 * - The narrowest link spaces the two segments. Thus the estimate is the frame of the second segment in bits, divided by the gap.
 * - A retransmitted segment and a pair with no gap give no estimate.
 */
export function packetPairs(capture: PathCapture): number[] {
  const remote = canonicalAddress(capture.address);
  const data = capture.packets.filter(
    (packet) => packet.protocol === "tcp" && packet.seq !== undefined && (packet.payload ?? 0) > 0 && canonicalAddress(packet.src) === remote,
  );
  const largest = new Map<string, number>();
  for (const packet of data) largest.set(flowOf(packet), Math.max(largest.get(flowOf(packet)) ?? 0, packet.bytes));
  const estimates: number[] = [];
  for (let index = 1; index < data.length; index++) {
    const first = data[index - 1]!;
    const second = data[index]!;
    const flow = flowOf(second);
    const full = largest.get(flow);
    if (flowOf(first) !== flow || first.bytes !== full || second.bytes !== full) continue;
    if (first.retransmission === true || second.retransmission === true) continue;
    if (second.seq !== first.seq! + first.payload!) continue;
    const gapMs = second.atMs - first.atMs;
    if (gapMs > 0) estimates.push((second.bytes * 8 * 1000) / gapMs);
  }
  return estimates;
}

/** The capacity of the narrowest link of a path, from the packet pairs of a capture. */
export interface BandwidthEstimate {
  /** The number of packet pairs. */
  readonly pairs: number;
  /** The median of the estimates of the pairs, in bits per second. */
  readonly bitsPerSecond: number;
  /** The low end of the distribution-free interval of the median. */
  readonly low: number;
  /** The high end of the interval. */
  readonly high: number;
  /** The chance that the interval holds the median. With 5 pairs or fewer, it is less than `PAIR_LEVEL`. */
  readonly coverage: number;
}

/**
 * This function gives the median of the estimates of the packet pairs of a capture. Cross traffic makes a gap larger,
 * and the compression of ACKs makes a gap smaller. The median keeps the middle. A capture with no pair has no estimate.
 */
export function bandwidthOf(capture: PathCapture): BandwidthEstimate | undefined {
  const estimates = packetPairs(capture);
  if (estimates.length === 0) return undefined;
  const interval = medianInterval(estimates, PAIR_LEVEL);
  return { pairs: estimates.length, bitsPerSecond: median(estimates), low: interval.low, high: interval.high, coverage: interval.coverage };
}
