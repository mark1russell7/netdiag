/**
 * The metric estimators of netdiag (ND-6). The statistics come from `@mark1russell7/rigor-statistics`.
 *
 * - The jitter of RFC 3550, and the delay variation of RFC 3393 and RFC 5481.
 * - The loss of RFC 7680.
 * - The RTO of RFC 6298, with the rule of Karn.
 * - The capacity of the narrowest link, from packet pairs.
 *
 * @packageDocumentation
 */
export { JITTER_GAIN, PDV_QUANTILE, delayMetrics, ipdv, pdv, rfc3550Jitter, type DelayMetrics } from "./delay.ts";
export { echoMetrics, lossOf, type EchoMetrics, type LossEstimate } from "./loss.ts";
export { PAIR_LEVEL, bandwidthOf, packetPairs, type BandwidthEstimate } from "./pairs.ts";
export { RTO_ALPHA, RTO_BETA, RTO_K, ackSamples, rtoOf, type RtoEstimate, type RtoOptions } from "./rto.ts";
