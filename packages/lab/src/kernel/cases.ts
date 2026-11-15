import type { FaultOptions, FaultPlace, HopPlace, Lab, NetworkFault } from "@mark1russell7/harness";
import type { Sign, SignGroup } from "../cases.ts";
import type { LaterClass } from "../report.ts";
import type { CaseBase } from "../run.ts";
import type { KernelZone } from "./resolver.ts";

// The cases of the kernel lab (ND-7, step 3). Each fault is data. The world (world.ts) changes each step of a plan
// into an operation of the harness. This module imports no value of the harness, so the unit tests start no container.

/** The name of the target in the kernel lab. The suffix `.test` keeps the feature `dns.address` out of the evidence. */
export const KERNEL_TARGET_NAME = "www.shop.test";
/** The name of the reference host in the kernel lab. */
export const KERNEL_REFERENCE_NAME = "www.ref.test";
/** The port of the HTTPS host of the target and of the reference host. */
export const KERNEL_PORT = 443;
/** The router between the client and the network of the target. */
export const KERNEL_HOP = "gw";
/** The place of the router on the side of the target. */
export const TOWARD_TARGET: HopPlace = { hop: KERNEL_HOP, toward: "target" };

/**
 * A fault of a kernel case, as data.
 *
 * - `network`: a rule of the injector of the harness at a place, with its options. For example `blackhole` at the target
 *   drops each packet from the client and to it.
 * - `netem`: `tc netem` with the spec on the egress of the target.
 * - `sysctl`: the sysctls of the namespace of the target, and the values that put them back.
 * - `mtu`: the router drops each packet from the target and the reference host above `above` bytes.
 */
export type KernelFault =
  | { readonly kind: "network"; readonly fault: Exclude<NetworkFault, "mtu">; readonly at: FaultPlace; readonly options?: FaultOptions | undefined }
  | { readonly kind: "netem"; readonly at: "target"; readonly spec: string }
  | { readonly kind: "sysctl"; readonly values: Readonly<Record<string, string>>; readonly undo: Readonly<Record<string, string>> }
  | { readonly kind: "mtu"; readonly at: HopPlace; readonly above: number };

/** A case of the kernel lab: a fault, or none for the control, and the signs of the fault. */
export interface KernelCase extends CaseBase {
  readonly summary: string;
  readonly fault: KernelFault | null;
}

/** One operation of the harness, as data. */
export type LabStep =
  | { readonly op: "fault"; readonly kind: NetworkFault; readonly at: FaultPlace; readonly options: FaultOptions }
  | { readonly op: "lift"; readonly kind: NetworkFault; readonly at: FaultPlace; readonly options: FaultOptions }
  | { readonly op: "netem"; readonly spec: string | null; readonly at: FaultPlace }
  | { readonly op: "sysctl"; readonly values: Readonly<Record<string, string>> }
  | { readonly op: "offload"; readonly on: boolean; readonly at: FaultPlace }
  | { readonly op: "forget" };

/** The steps that make the fault of a case, and the steps that remove it. */
export interface FaultPlan {
  readonly apply: readonly LabStep[];
  readonly lift: readonly LabStep[];
}

/** The addresses of the hosts of a kernel world on the network of the target. */
export interface KernelPeers {
  readonly target: string;
  readonly reference: string;
}

/** The part of a lab of the harness that the steps of a plan use. */
export type StepLab = Pick<Lab, "fault" | "lift" | "netem" | "targetSysctl" | "offload" | "forget">;

/** This function gives the zone of the resolver of a kernel world: an A record for each name, and no AAAA record. */
export function kernelZone(peers: KernelPeers): KernelZone {
  return { [KERNEL_TARGET_NAME]: { rcode: 0, a: [peers.target] }, [KERNEL_REFERENCE_NAME]: { rcode: 0, a: [peers.reference] } };
}

const sign = (feature: string, value: string, primary = true): Sign => ({ feature, primary, value });
const anyOf = (...signs: Sign[]): SignGroup => ({ anyOf: signs });

/** The cases of the kernel lab: a control and seven faults. Each case is in each round. */
export const KERNEL_CASES: readonly KernelCase[] = [
  {
    id: "none",
    truth: "none",
    summary: "The world has no fault. The case finds a fault that a case before it did not remove.",
    fault: null,
    signs: [sign("tcp.connect", "connected"), sign("tls.handshake", "ok"), sign("http.status", "ok"), sign("icmp.reply", "reply")],
  },
  {
    id: "filter.drop",
    truth: "filter.drop",
    summary: "The target drops each packet from the client and to it.",
    fault: { kind: "network", fault: "blackhole", at: "target" },
    signs: [sign("tcp.connect", "timeout"), sign("icmp.reply", "none")],
  },
  {
    id: "filter.icmp",
    truth: "filter.icmp",
    summary: "The target ignores each ICMP echo request. TCP works.",
    fault: { kind: "sysctl", values: { "net.ipv4.icmp_echo_ignore_all": "1" }, undo: { "net.ipv4.icmp_echo_ignore_all": "0" } },
    signs: [sign("icmp.reply", "none"), sign("tcp.connect", "connected")],
  },
  {
    id: "path.loss",
    truth: "path.loss",
    summary: "The target loses 20 % of the packets that it sends. The reference host loses none.",
    fault: { kind: "netem", at: "target", spec: "loss 20%" },
    signs: [sign("path.loss", "high"), sign("path.loss", "none", false)],
  },
  {
    id: "path.mtu",
    truth: "path.mtu",
    summary: "The router drops each packet above 1200 bytes from the target and the reference host. Small packets pass.",
    fault: { kind: "mtu", at: TOWARD_TARGET, above: 1200 },
    signs: [sign("tcp.connect", "connected"), sign("tls.handshake", "timeout"), sign("tls.handshake", "timeout", false)],
  },
  {
    id: "host.down",
    truth: "host.down",
    summary: "The router answers each packet to the target with an ICMP host unreachable, as a router does for a host that is down.",
    fault: { kind: "network", fault: "reject", at: TOWARD_TARGET, options: { direction: "out", protocol: "all", code: "host" } },
    signs: [sign("icmp.reply", "unreachable"), sign("tcp.connect", "unreachable"), sign("tcp.connect", "connected", false)],
  },
  {
    id: "filter.reset",
    truth: "filter.reset",
    summary: "The target lets each SYN pass, and resets each later segment from the client. The connect or the TLS handshake gets a reset.",
    fault: { kind: "network", fault: "rst", at: "target", options: { handshake: "pass" } },
    // The last ACK of the handshake also gets the reset. On a short path, the reset comes before Node.js reads the
    // end of the connect, and the connect fails with ECONNRESET. Thus the group takes each form of the fault.
    signs: [anyOf(sign("tcp.connect", "reset"), sign("tls.handshake", "reset")), sign("icmp.reply", "reply")],
  },
  {
    id: "gateway.down",
    truth: "gateway.down",
    summary: "The router drops each packet that it gets, and its link stays up. The DNS queries and the pings of the gateway get no answer.",
    // a silence acts on each packet of the router, so the side of its place has no effect
    fault: { kind: "network", fault: "silence", at: TOWARD_TARGET },
    signs: [sign("link.state", "up", false), sign("gateway.reply", "none", false), sign("dns.answer", "timeout")],
  },
];

/** The kernel classes of the roadmap with no case yet. The gate shows them with no bar. */
export const KERNEL_LATER: readonly LaterClass[] = [
  { hypothesis: "ipv6.broken", reason: "The networks of the harness have no IPv6 (PR-E)." },
];

/**
 * This function gives the steps of the fault of a case, and the steps that remove it. Each lift ends with `forget`, so
 * the kernels keep no TCP metrics from one case to the next.
 */
export function faultPlan(fault: KernelFault | null, peers: KernelPeers): FaultPlan {
  const forget: LabStep = { op: "forget" };
  if (fault === null) return { apply: [], lift: [forget] };
  switch (fault.kind) {
    case "network": {
      const options = fault.options ?? {};
      return { apply: [{ op: "fault", kind: fault.fault, at: fault.at, options }], lift: [{ op: "lift", kind: fault.fault, at: fault.at, options }, forget] };
    }
    case "netem":
      return { apply: [{ op: "netem", spec: fault.spec, at: fault.at }], lift: [{ op: "netem", spec: null, at: fault.at }, forget] };
    case "sysctl":
      return { apply: [{ op: "sysctl", values: fault.values }], lift: [{ op: "sysctl", values: fault.undo }, forget] };
    case "mtu": {
      // With TSO, GSO and GRO off, the length match acts on segments, not on super-packets of up to 64 KB.
      const options: FaultOptions = { above: fault.above, peers: [peers.target, peers.reference] };
      return {
        apply: [{ op: "offload", on: false, at: fault.at }, { op: "offload", on: false, at: "target" }, { op: "fault", kind: "mtu", at: fault.at, options }],
        lift: [{ op: "lift", kind: "mtu", at: fault.at, options }, { op: "offload", on: true, at: fault.at }, { op: "offload", on: true, at: "target" }, forget],
      };
    }
  }
}

/** This function does each step of a plan on a lab, in sequence. A step that fails stops the sequence. */
export async function applySteps(lab: StepLab, steps: readonly LabStep[]): Promise<void> {
  for (const step of steps) {
    switch (step.op) {
      case "fault":
        await lab.fault(step.kind, step.at, step.options);
        break;
      case "lift":
        await lab.lift(step.kind, step.at, step.options);
        break;
      case "netem":
        await lab.netem(step.spec, step.at);
        break;
      case "sysctl":
        await lab.targetSysctl(step.values);
        break;
      case "offload":
        await lab.offload(step.on, step.at);
        break;
      case "forget":
        await lab.forget();
        break;
    }
  }
}
