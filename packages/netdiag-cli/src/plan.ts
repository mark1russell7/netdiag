import {
  canonicalHost,
  grantProblems,
  hostKind,
  namedGrant,
  parseTarget,
  type Grant,
  type Target,
  type VisitHost,
  type VisitInput,
  type VisitResolver,
} from "@mark1russell7/netdiag";
import { DEFAULT_PING_COUNT, MAX_PING_COUNT } from "@mark1russell7/netdiag/tools";
import { err, ok, type Result } from "@mark1russell7/optional";

// The plan of a check: the options of the command line, changed into the input of a visit. The plan is the scope rule
// of the command: it grants only the hosts that the user names, the DNS resolver and the ranges of `--grant`.

/** The schemes of the HTTP request of a check. */
export const SCHEMES: readonly ["http", "https"] = ["http", "https"];

/** A scheme of the HTTP request of a check. */
export type Scheme = (typeof SCHEMES)[number];

/** The options of the command `check`. Each field is a flag of the command line. */
export interface CheckOptions {
  /** The host to check: a DNS name, an IP address, `host:port` or a URL. */
  readonly target: string;
  /** The port of the HTTP request. The default is the port in the target, then the port of the scheme. */
  readonly port?: number | undefined;
  /** The scheme of the HTTP request. The default is the scheme of a URL target, then `https`. */
  readonly scheme?: Scheme | undefined;
  /** The path of the HTTP request. The default is the path of a URL target, then `/`. */
  readonly path?: string | undefined;
  /** The hosts that work, for a comparison with the target. */
  readonly reference?: readonly string[] | undefined;
  /** The address of the DNS resolver, with an optional port. The default is the first resolver of the computer. */
  readonly resolver?: string | undefined;
  /** The IP address of the default gateway. Without it, the check does not ping a gateway. */
  readonly gateway?: string | undefined;
  /** The CIDR ranges that the user owns. The check can probe each address in them. */
  readonly grant?: readonly string[] | undefined;
  /** The number of echo requests to each address. The default is `DEFAULT_PING_COUNT`. */
  readonly pingCount?: number | undefined;
}

/** The parts of the computer that a plan reads. */
export interface PlanSystem {
  /** The DNS resolvers of the computer, in the form of `getServers()` of `node:dns`. */
  readonly resolvers: readonly string[];
}

/** The plan of a check: the target, the HTTP request, the number of echo requests, and the input of the visit. */
export interface CheckPlan {
  /** The target, with the port of the HTTP request when the user gives one. */
  readonly target: Target;
  readonly scheme: Scheme;
  readonly path: string;
  readonly pingCount: number;
  /** The input of `visitTarget`, with the grants of the scope. */
  readonly visit: VisitInput;
}

interface Located {
  readonly target: Target;
  readonly scheme?: Scheme | undefined;
  readonly path?: string | undefined;
}

function isScheme(text: string): text is Scheme {
  return (SCHEMES as readonly string[]).includes(text);
}

/** This function reads a host of the user. A URL also gives a scheme and a path. Only a port in the text stays in the target. */
function locate(text: string, what: string): Result<Located, string> {
  const parsed = parseTarget(text);
  if (parsed.tag === "err") return err(`The ${what} is not valid. ${parsed.error}`);
  if (!text.includes("://")) return ok({ target: parsed.value });
  const url = new URL(text.trim());
  const scheme = url.protocol.slice(0, -1);
  if (!isScheme(scheme)) return err(`The ${what} "${text}" has the scheme ${scheme}. A check sends HTTP and HTTPS requests only.`);
  // `parseTarget` gives the port of the scheme to a URL with no port. The check keeps only a port that the URL names.
  const host = { host: parsed.value.host, kind: parsed.value.kind };
  const target = url.port === "" ? host : { ...host, port: Number(url.port) };
  return ok({ target, scheme, path: `${url.pathname}${url.search}` });
}

/** This function gives a grant of one IP address. */
function addressGrant(address: Target, basis: Grant["basis"], note: string): Grant {
  return { ...namedGrant(address, note), basis };
}

function visitHost(target: Target): VisitHost {
  return target.port === undefined ? { host: target.host } : { host: target.host, port: target.port };
}

function whole(value: number, low: number, high: number): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}

/**
 * This function gives the plan of a check from the options of the command line, or each problem of the options.
 *
 * The grants of the plan are the scope rule of the command. The plan grants only these hosts:
 *
 * - the target, and each reference host, with the basis `named`
 * - the DNS resolver, with the basis `named` from `--resolver`, or `configured` from the computer
 * - the gateway, when the user gives it, with the basis `named`
 * - each range of `--grant`, with the basis `owned`
 *
 * The visit also puts in the scope the addresses that the resolver gives for a named host.
 */
export function planCheck(options: CheckOptions, system: PlanSystem): Result<CheckPlan, readonly string[]> {
  const problems: string[] = [];
  const grants: Grant[] = [];

  const located = locate(options.target, "target");
  if (located.tag === "err") return err([located.error]);
  const scheme = options.scheme ?? located.value.scheme ?? "https";
  const path = options.path ?? located.value.path ?? "/";
  if (!isScheme(scheme)) problems.push(`The scheme ${String(scheme)} is not http or https.`);
  if (!path.startsWith("/")) problems.push(`The path "${path}" does not start with "/".`);
  const port = options.port ?? located.value.target.port;
  if (port !== undefined && !whole(port, 1, 65535)) problems.push(`The port ${port} is not an integer from 1 to 65535.`);
  const pingCount = options.pingCount ?? DEFAULT_PING_COUNT;
  if (!whole(pingCount, 0, MAX_PING_COUNT)) problems.push(`The ping count ${pingCount} is not an integer from 0 to ${MAX_PING_COUNT}.`);
  const target: Target = port === undefined ? { host: located.value.target.host, kind: located.value.target.kind } : { ...located.value.target, port };
  grants.push(namedGrant(target, "the target"));

  const references: VisitHost[] = [];
  for (const text of options.reference ?? []) {
    const reference = locate(text, "reference");
    if (reference.tag === "err") problems.push(reference.error);
    else {
      references.push(visitHost(reference.value.target));
      grants.push(namedGrant(reference.value.target, "a reference host"));
    }
  }

  let resolver: VisitResolver | undefined;
  const resolverText = options.resolver ?? system.resolvers[0];
  if (resolverText !== undefined) {
    const from = options.resolver === undefined ? "The DNS resolver of the computer" : "The DNS resolver";
    const parsed = parseTarget(resolverText);
    if (parsed.tag === "err") problems.push(`${from} is not valid. ${parsed.error}`);
    else if (parsed.value.kind === "name") problems.push(`${from} "${resolverText}" is not an IP address.`);
    else {
      resolver = parsed.value.port === undefined ? { address: parsed.value.host } : { address: parsed.value.host, port: parsed.value.port };
      grants.push(addressGrant(parsed.value, options.resolver === undefined ? "configured" : "named", "the DNS resolver"));
    }
  }

  let gateway: string | undefined;
  if (options.gateway !== undefined) {
    const host = canonicalHost(options.gateway);
    const kind = hostKind(host);
    if (kind === "name") problems.push(`The gateway "${options.gateway}" is not an IP address.`);
    else {
      gateway = host;
      grants.push(addressGrant({ host, kind }, "named", "the default gateway"));
    }
  }

  for (const cidr of options.grant ?? []) grants.push({ kind: "range", cidr: cidr.trim(), basis: "owned", note: "a range of --grant" });

  // A grant with a problem stops the plan, so a typing error cannot widen the scope.
  for (const grant of grants) {
    for (const problem of grantProblems(grant)) problems.push(grant.basis === "configured" ? `${problem} Give a resolver with --resolver <address>.` : problem);
  }
  if (problems.length > 0) return err(problems);

  const visit: VisitInput = {
    target: visitHost(target),
    references,
    ...(gateway === undefined ? {} : { gateway }),
    ...(resolver === undefined ? {} : { resolver }),
    grants,
  };
  return ok({ target, scheme, path, pingCount, visit });
}
