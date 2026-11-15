import { createServer as createHttpsServer, type ServerOptions } from "node:https";
import { createServer as createNetServer } from "node:net";
import { faultPlanOf } from "@mark1russell7/rigor-chaos";
import { startFaultProxy } from "@mark1russell7/rigor-proxy";
import { MISSING, authority, expiredValidity, listen, selfSigned, startDnsServer, type Authority, type Pems, type ZoneEntry } from "@netdiag/fixtures";
import {
  OTHER_NAME,
  PORTAL,
  PORTAL_NAME,
  REFERENCE_NAME,
  TARGET_NAME,
  type Certificate,
  type DnsSpec,
  type HostSpec,
  type LabCase,
  type LabHosts,
} from "./cases.ts";

/** The roots of trust of the lab, and the certificates of its hosts. */
export interface LabTrust {
  /** The root of the lab. The probes count it as a public root, so the lab hosts stand for hosts on the internet. */
  readonly lab: Authority;
  /** The root of the TLS proxy. The user trusts it, as the root of a company. */
  readonly proxy: Authority;
  /** This function gives the key and the certificate of a host. It keeps each pair for the next worlds. */
  pems(certificate: Certificate, name: string): Promise<Pems>;
}

/** This function makes the roots of the lab. */
export async function labTrust(): Promise<LabTrust> {
  const lab = await authority("netdiag lab root");
  const proxy = await authority("netdiag lab proxy root");
  const made = new Map<string, Promise<Pems>>();
  const make = (certificate: Certificate, name: string): Promise<Pems> => {
    switch (certificate) {
      case "valid":
        return lab.issue([name]);
      case "expired":
        return lab.issue([name], expiredValidity());
      case "wrong-name":
        return lab.issue([OTHER_NAME]);
      case "proxy":
        return proxy.issue([name]);
      case "self-signed":
        return selfSigned([name]);
    }
  };
  return {
    lab,
    proxy,
    pems: (certificate, name) => {
      const key = `${certificate} ${name}`;
      const pair = made.get(key) ?? make(certificate, name);
      made.set(key, pair);
      return pair;
    },
  };
}

/** An address and a port. */
export interface Endpoint {
  readonly host: string;
  readonly port: number;
}

/** The servers of one case. */
export interface World {
  readonly resolver: Endpoint;
  /** The HTTPS port of the target name. */
  readonly targetPort: number;
  /** The HTTPS port of the reference name. */
  readonly referencePort: number;
  /** This function stops each server of the world. */
  close(): Promise<void>;
}

/** The only cipher of a legacy server. The client does not accept it with the key of the lab certificates. */
export const LEGACY_CIPHER = "ECDHE-RSA-AES128-GCM-SHA256";
/** The time after the first byte of a reply in which a TLS proxy holds the bytes, in milliseconds. */
export const HOLD_WINDOW_MS = 5;

type Closer = () => Promise<void>;

/** This function gives a TCP port of the address with no program on it. */
async function freePort(address: string): Promise<number> {
  const probe = await listen(createNetServer(), address, 0);
  await probe.close();
  return probe.port;
}

/** This function gives a UDP port of the address with no program on it. */
async function freeUdpPort(address: string): Promise<number> {
  const probe = await startDnsServer({ host: address, zone: () => "silent" });
  await probe.close();
  return probe.port;
}

/**
 * This function starts an HTTPS host on the address, and gives its port. A port of 0 gives a free port. A delay of the
 * handshake puts a fault proxy in front of the server.
 */
async function startHost(address: string, name: string, spec: HostSpec, trust: LabTrust, closers: Closer[], port = 0): Promise<number> {
  if (spec.listening === false) return port === 0 ? freePort(address) : port;
  const pems = await trust.pems(spec.certificate ?? "valid", name);
  const options: ServerOptions = spec.legacy === true ? { ...pems, ciphers: LEGACY_CIPHER, maxVersion: "TLSv1.2" } : { ...pems };
  const server = createHttpsServer(options, (request, response) => {
    const reply = (): void => {
      response.writeHead(spec.status ?? 200, { "content-type": "text/plain" });
      response.end("lab\n");
    };
    const delay = spec.responseDelayMs ?? 0;
    if (delay <= 0) return reply();
    const timer = setTimeout(reply, delay);
    request.socket.once("close", () => clearTimeout(timer));
  });
  server.on("tlsClientError", () => undefined);
  const delay = spec.handshakeDelayMs ?? 0;
  if (delay <= 0) {
    const listening = await listen(server, address, port);
    closers.push(() => listening.close());
    return listening.port;
  }
  const backend = await listen(server, address, 0);
  closers.push(() => backend.close());
  const proxy = await startFaultProxy({
    target: { host: address, port: backend.port },
    listen: { host: address, port },
    plan: faultPlanOf([{ kind: "delay", ms: delay, forMs: HOLD_WINDOW_MS, connection: 0, direction: "down", at: { byte: 0 } }]),
  });
  closers.push(() => proxy.close());
  return proxy.port;
}

/** This function gives the zone of the lab resolver for a DNS spec. */
export function zoneOf(hosts: LabHosts, dns: DnsSpec): (name: string) => ZoneEntry {
  return (name) => {
    if (dns.mode === "silent") return "silent";
    if (dns.mode === "servfail") return { rcode: 2 };
    if (dns.portal === true) return { rcode: 0, a: [hosts.portal] };
    if (name === TARGET_NAME && dns.missing !== true) return { rcode: 0, a: [hosts.target] };
    if (name === REFERENCE_NAME) return { rcode: 0, a: [hosts.reference] };
    return MISSING;
  };
}

async function startResolver(hosts: LabHosts, dns: DnsSpec, closers: Closer[]): Promise<Endpoint> {
  if (dns.mode === "absent") return { host: hosts.resolver, port: await freeUdpPort(hosts.resolver) };
  const server = await startDnsServer({ host: hosts.resolver, zone: zoneOf(hosts, dns) });
  closers.push(() => server.close());
  return { host: server.host, port: server.port };
}

/**
 * This function starts the servers of a case: the resolver, the target, the reference host and the captive portal.
 * The portal listens on the ports of both names. When a server does not start, the function stops the others and throws.
 */
export async function startWorld(hosts: LabHosts, labCase: LabCase, trust: LabTrust): Promise<World> {
  const closers: Closer[] = [];
  const close = async (): Promise<void> => {
    await Promise.allSettled(closers.reverse().map((closer) => closer()));
  };
  try {
    const targetPort = await startHost(hosts.target, TARGET_NAME, labCase.target, trust, closers);
    const referencePort = await startHost(hosts.reference, REFERENCE_NAME, labCase.reference, trust, closers);
    if (labCase.dns.portal === true) {
      for (const port of new Set([targetPort, referencePort])) await startHost(hosts.portal, PORTAL_NAME, PORTAL, trust, closers, port);
    }
    const resolver = await startResolver(hosts, labCase.dns, closers);
    return { resolver, targetPort, referencePort, close };
  } catch (thrown) {
    await close();
    throw thrown;
  }
}
