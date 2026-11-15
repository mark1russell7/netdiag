import { canonicalAddress } from "../address/index.ts";
import type { CapturedPacket, PathCapture } from "../kinds.ts";

// The retransmission timeout of RFC 6298 (ND-6), and its samples from a capture with the rule of Karn.

/** The gain `alpha` of the smoothed RTT of RFC 6298. */
export const RTO_ALPHA: number = 1 / 8;
/** The gain `beta` of the variation of the RTT of RFC 6298. */
export const RTO_BETA: number = 1 / 4;
/** The factor `K` of the variation in the RTO of RFC 6298. */
export const RTO_K = 4;

/** The options of `rtoOf`. Each time is in milliseconds. */
export interface RtoOptions {
  /** The granularity `G` of the clock. The default is 1. */
  readonly granularityMs?: number | undefined;
  /** The lower bound of the RTO. RFC 6298 tells 1 second, and the default is 1000. The kernel of Linux uses 200. */
  readonly minMs?: number | undefined;
  /** The upper bound of the RTO. RFC 6298 lets it be 60 seconds or more, and the default is 60000. */
  readonly maxMs?: number | undefined;
}

/** The state of the estimator of RFC 6298 after the last sample. Each time is in milliseconds. */
export interface RtoEstimate {
  /** The number of samples. */
  readonly samples: number;
  /** The smoothed RTT, `SRTT`. */
  readonly srttMs: number;
  /** The variation of the RTT, `RTTVAR`. */
  readonly rttvarMs: number;
  /** The retransmission timeout: `SRTT + max(G, K * RTTVAR)`, in the bounds of the options. */
  readonly rtoMs: number;
}

/**
 * This function gives the RTO of RFC 6298 (section 2) after each sample in sequence. The first sample sets `SRTT` to
 * `R` and `RTTVAR` to `R / 2`. Each later sample first changes `RTTVAR` with the old `SRTT`, then changes `SRTT`.
 * A list with no sample, or with a sample that is negative or not finite, has no estimate.
 */
export function rtoOf(samplesMs: readonly number[], options: RtoOptions = {}): RtoEstimate | undefined {
  if (samplesMs.length === 0 || !samplesMs.every((sample) => Number.isFinite(sample) && sample >= 0)) return undefined;
  const granularity = options.granularityMs ?? 1;
  const [first, ...rest] = samplesMs as [number, ...number[]];
  let srtt = first;
  let rttvar = first / 2;
  for (const sample of rest) {
    rttvar = (1 - RTO_BETA) * rttvar + RTO_BETA * Math.abs(srtt - sample);
    srtt = (1 - RTO_ALPHA) * srtt + RTO_ALPHA * sample;
  }
  const raw = srtt + Math.max(granularity, RTO_K * rttvar);
  const rto = Math.min(options.maxMs ?? 60_000, Math.max(options.minMs ?? 1000, raw));
  return { samples: samplesMs.length, srttMs: srtt, rttvarMs: rttvar, rtoMs: rto };
}

const FIN = 0x01;
const SYN = 0x02;
const ACK = 0x10;

/** A segment of the local host that the remote host did not acknowledge yet. */
interface InFlight {
  /** The sequence number after the last byte of the segment. */
  readonly end: number;
  readonly retransmitted: boolean;
}

interface Flow {
  inFlight: InFlight[];
  /** The largest end of a segment so far. */
  highest: number;
  /** The largest acknowledgment number so far. */
  acked: number;
}

const flowKey = (local: CapturedPacket["src"], localPort: number | undefined, remotePort: number | undefined): string =>
  `${local}|${localPort ?? ""}|${remotePort ?? ""}`;

/**
 * This function gives the RTT samples of a capture for RFC 6298, in the order of the capture. Each sample is the time
 * `ackRttMs` of an ACK from the remote host.
 *
 * - The remote host is the address of the capture filter. An ACK from the local host measures the local host, not the path.
 * - The rule of Karn applies: an ACK of a retransmitted segment gives no sample.
 * - A segment is retransmitted when `tshark` marks it, or when it ends at or before the end of an earlier segment.
 * - A SYN and a FIN each take one number of the sequence space, as in TCP.
 * - An ACK of no segment of the capture gives no sample, because the rule of Karn cannot examine it.
 */
export function ackSamples(capture: PathCapture): number[] {
  const remote = canonicalAddress(capture.address);
  const flows = new Map<string, Flow>();
  const samples: number[] = [];
  for (const packet of capture.packets) {
    if (packet.protocol !== "tcp" || packet.seq === undefined) continue;
    const flags = packet.flags ?? 0;
    if (canonicalAddress(packet.src) !== remote) {
      const length = (packet.payload ?? 0) + (flags & SYN ? 1 : 0) + (flags & FIN ? 1 : 0);
      if (length === 0) continue;
      const key = flowKey(canonicalAddress(packet.src), packet.srcPort, packet.dstPort);
      const flow = flows.get(key) ?? { inFlight: [], highest: 0, acked: 0 };
      flows.set(key, flow);
      const end = packet.seq + length;
      const retransmitted = packet.retransmission === true || end <= flow.highest;
      flow.highest = Math.max(flow.highest, end);
      if (end > flow.acked) flow.inFlight.push({ end, retransmitted });
      continue;
    }
    if ((flags & ACK) === 0 || packet.ack === undefined || packet.ackRttMs === undefined) continue;
    const flow = flows.get(flowKey(canonicalAddress(packet.dst), packet.dstPort, packet.srcPort));
    if (flow === undefined || packet.ack <= flow.acked) continue;
    const ack = packet.ack;
    const covered = flow.inFlight.filter((segment) => segment.end <= ack);
    flow.inFlight = flow.inFlight.filter((segment) => segment.end > ack);
    flow.acked = ack;
    if (covered.length > 0 && covered.every((segment) => !segment.retransmitted)) samples.push(packet.ackRttMs);
  }
  return samples;
}
