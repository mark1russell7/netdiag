import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { imageOf, openLab, type BuildImage, type ClientImage, type Lab, type Sibling, type Target, type Topology } from "@mark1russell7/harness";
import { quantity } from "@mark1russell7/quantity";
import { errorMessage } from "@mark1russell7/text";
import type { Authority, Pems } from "@netdiag/fixtures";
import { DNS_TIMEOUT_MS, HTTP_TIMEOUT_MS, type LabRound, type Visit } from "../run.ts";
import { KERNEL_HOP, KERNEL_PORT, KERNEL_REFERENCE_NAME, KERNEL_TARGET_NAME, applySteps, faultPlan, kernelZone, type KernelCase, type KernelPeers } from "./cases.ts";
import { HTTPS_READY, httpsArgs } from "./https.ts";
import { agentArgs, visitOf, type AgentPlan } from "./protocol.ts";
import { RESOLVER_READY, zoneArg } from "./resolver.ts";

// The world of the kernel lab: the harness of systems with real kernels. The client container is the netdiag image
// and starts the agent. The router `gw` joins the network of the client to the network of the target. The target, the
// reference host and the resolver are on the network of the target. Each round has one world. Each case adds its
// fault to the world, starts the agent, and removes the fault.

/** The base image of the target and of the netdiag image: Node 24 on Debian 13, pinned by digest. */
export const NODE_IMAGE = "node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66";
/** The topology of the kernel lab: one router between the client and the target. */
export const KERNEL_TOPOLOGY: Topology = { name: "kernel", hops: [{ name: KERNEL_HOP, kind: "router", form: "none", idle: quantity(300, "s") }] };
/** The number of echo requests to each address. `path.loss` needs 20 or more. */
export const KERNEL_PING_COUNT = 50;
/** The path of the PEM file of the lab root in the client container. */
export const KERNEL_ROOT_PATH = "/tmp/netdiag-lab-root.pem";
/** The longest time of the agent of one case, in milliseconds. Two pings of 50 requests take approximately 25 seconds. */
export const AGENT_LIMIT_MS = 120_000;

/** The path of the root of the repository. The build context of the netdiag image is this folder. */
export const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../../../", import.meta.url));

/** The files of the build context of the netdiag image, from the root of the repository. */
export const IMAGE_FILES: readonly string[] = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "packages/fixtures/package.json",
  "packages/lab/package.json",
  "packages/netdiag/package.json",
  "packages/site/package.json",
  "packages/fixtures/src",
  "packages/lab/src",
  "packages/netdiag/src",
  "packages/lab/kernel/Dockerfile",
];

/** The netdiag image: Node, the tools of the visit and the packages of the lab. The harness builds it. */
export function labImage(root: string = REPOSITORY_ROOT): BuildImage {
  return { kind: "build", name: "netdiag-lab", context: root, dockerfile: "packages/lab/kernel/Dockerfile", files: IMAGE_FILES };
}

/** The keys and the certificates of a kernel world. */
export interface KernelTrust {
  /** The lab root, as PEM text. The agent counts it as a public root. */
  readonly root: string;
  readonly target: Pems;
  readonly reference: Pems;
}

/** This function issues the certificates of the kernel world from a root of trust. */
export async function kernelTrust(ca: Authority): Promise<KernelTrust> {
  return { root: ca.cert, target: await ca.issue([KERNEL_TARGET_NAME]), reference: await ca.issue([KERNEL_REFERENCE_NAME]) };
}

/** The addresses of a kernel world. */
export interface KernelAddresses extends KernelPeers {
  readonly resolver: string;
}

/** This function gives the plan of the agent in a world. The scope has the three lab hosts only. */
export function kernelPlan(addresses: KernelAddresses): AgentPlan {
  return {
    target: KERNEL_TARGET_NAME,
    port: KERNEL_PORT,
    references: [KERNEL_REFERENCE_NAME],
    resolver: addresses.resolver,
    resolverPort: 53,
    grants: [addresses.target, addresses.reference, addresses.resolver].map((address) => `${address}/32`),
    pingCount: KERNEL_PING_COUNT,
    mtrCycles: 0,
    root: KERNEL_ROOT_PATH,
    dnsTimeoutMs: DNS_TIMEOUT_MS,
    httpTimeoutMs: HTTP_TIMEOUT_MS,
  };
}

/** The HTTPS host of the target on the stock Node image, with its script as a file. */
export function kernelTarget(script: string, pems: Pems): Target {
  return {
    image: NODE_IMAGE,
    port: KERNEL_PORT,
    ready: HTTPS_READY,
    files: { "/srv/https.ts": script },
    command: ["node", "/srv/https.ts", ...httpsArgs({ port: KERNEL_PORT, ...pems })],
  };
}

/** A started kernel world: the lab of the harness, the reference host and the resolver. */
export interface KernelWorld {
  readonly lab: Lab;
  readonly reference: Sibling;
  readonly resolver: Sibling;
  readonly addresses: KernelAddresses;
}

/** This function starts a kernel world. On a failure, it stops each part that started. */
export async function openKernelWorld(trust: KernelTrust, image: BuildImage = labImage()): Promise<KernelWorld> {
  const tag = await imageOf(image);
  const script = readFileSync(new URL("./https.ts", import.meta.url), "utf8");
  const client: ClientImage = { image, command: ["node", "packages/lab/src/kernel/agent.ts"] };
  const lab = await openLab(kernelTarget(script, trust.target), client, KERNEL_TOPOLOGY);
  try {
    const reference = await lab.sibling(tag, ["node", "packages/lab/src/kernel/https.ts", ...httpsArgs({ port: KERNEL_PORT, ...trust.reference })], HTTPS_READY);
    const zone = kernelZone({ target: lab.targetIp, reference: reference.ip });
    const resolver = await lab.sibling(tag, ["node", "packages/lab/src/kernel/resolver.ts", zoneArg(zone)], RESOLVER_READY);
    return { lab, reference, resolver, addresses: { target: lab.targetIp, reference: reference.ip, resolver: resolver.ip } };
  } catch (thrown) {
    await lab.close();
    throw thrown;
  }
}

/**
 * This function adds the fault of a case to a world, starts the agent and waits for its last line. Then it removes the
 * fault. A wait that ends with no last line gives a problem, not a throw.
 */
export async function visitKernel(world: KernelWorld, labCase: KernelCase, trust: KernelTrust): Promise<Visit> {
  const plan = faultPlan(labCase.fault, world.addresses);
  try {
    await applySteps(world.lab, plan.apply);
    const probe = await world.lab.probe(agentArgs(kernelPlan(world.addresses)), [{ content: trust.root, target: KERNEL_ROOT_PATH }]);
    let ended: string | undefined;
    try {
      await probe.until(["done", "fail"], AGENT_LIMIT_MS);
    } catch (thrown) {
      ended = errorMessage(thrown);
    } finally {
      await probe.stop();
    }
    return visitOf(probe.events, ended);
  } finally {
    await applySteps(world.lab, plan.lift);
  }
}

/** This function starts the world of a round. Each case of the round uses it, and the round closes it. */
export async function startKernelRound(trust: KernelTrust, image: BuildImage = labImage()): Promise<LabRound<KernelCase>> {
  const world = await openKernelWorld(trust, image);
  return { visit: (labCase) => visitKernel(world, labCase, trust), close: () => world.lab.close() };
}
