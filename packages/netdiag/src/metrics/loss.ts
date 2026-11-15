import { wilson } from "@mark1russell7/rigor-statistics";
import type { IcmpEcho } from "../kinds.ts";
import { delayMetrics, type DelayMetrics } from "./delay.ts";

/** The loss of a stream of packets: the counts, the share of the lost packets, and the Wilson interval of the share at 95 %. */
export interface LossEstimate {
  readonly sent: number;
  readonly lost: number;
  /** The share of the lost packets, from 0 to 1. */
  readonly ratio: number;
  /** The low end of the interval of `ratio`. */
  readonly low: number;
  /** The high end of the interval of `ratio`. */
  readonly high: number;
}

/**
 * This function gives the loss of a stream: the mean of the loss of each packet, as RFC 7680 tells. The counts are whole
 * numbers. A stream with no packet, or with more packets received than sent, has no estimate.
 */
export function lossOf(sent: number, received: number): LossEstimate | undefined {
  if (!Number.isSafeInteger(sent) || !Number.isSafeInteger(received) || sent <= 0 || received < 0 || received > sent) return undefined;
  const lost = sent - received;
  const interval = wilson(lost, sent);
  return { sent, lost, ratio: lost / sent, low: interval.low, high: interval.high };
}

/** The metrics of the ICMP echo requests to one address. */
export interface EchoMetrics {
  readonly address: string;
  /**
   * The loss of the round trip. A packet that the path loses in one direction or in the other is a loss of the round trip.
   * Thus this loss is an upper bound of the one-way loss of each direction.
   */
  readonly loss?: LossEstimate | undefined;
  /** The summary of the round-trip times of the replies. */
  readonly delay?: DelayMetrics | undefined;
}

/** This function gives the metrics of an `icmp.echo` fact: the loss of the round trip and the summary of the round-trip times. */
export function echoMetrics(echo: IcmpEcho): EchoMetrics {
  const loss = lossOf(echo.sent, echo.received);
  const delay = delayMetrics(echo.rttMs);
  return { address: echo.address, ...(loss === undefined ? {} : { loss }), ...(delay === undefined ? {} : { delay }) };
}
