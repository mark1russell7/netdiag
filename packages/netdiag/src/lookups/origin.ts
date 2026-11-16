/**
 * The probe of the origins of the addresses of a path. It asks the DNS of Team Cymru for the BGP prefix of each public
 * address and the AS numbers that announce it. This is the source of `mtr -z`.
 *
 * The probe sends each TXT query through a port, `TxtResolve`. Thus this module has no DNS client and no module of Node.
 * The root entry gives `nodeResolveTxt`, a port over `node:dns`.
 *
 * The queries do not go through `polite-crawler`, because `polite-crawler` has no DNS transport. Team Cymru asks for DNS
 * or bulk queries at volume. The probe keeps the load small: one query for each address, and few queries at a time.
 *
 * @packageDocumentation
 */
import { addressClass, addressFamily, canonicalAddress, ipVersion, type AddressFamily } from "../address/index.ts";
import { observe, type Observation } from "../fact.ts";
import { PATH_ORIGIN, type DnsOutcome, type PathOrigin } from "../kinds.ts";
import { defineProbe, type Probe } from "../probe.ts";
import { formatTarget, target, type Target } from "../target.ts";
import { CYMRU_ZONES, originQuery, readOrigin } from "./cymru.ts";
import { MAX_OWNER_ADDRESSES } from "./owner.ts";

/** One TXT query of the probe of the origins. */
export interface TxtQuery {
  /** The name of the query, for example `31.108.90.216.origin.asn.cymru.com`. */
  readonly name: string;
  /** The IP address of the resolver. */
  readonly resolver: string;
  /** The port of the resolver. */
  readonly port: number;
  /** The time limit of the query, in milliseconds. */
  readonly timeoutMs: number;
}

/** The answer of a resolver to one TXT query. */
export interface TxtAnswer {
  readonly outcome: DnsOutcome;
  /** The TXT records of the outcome `ok`. Each record is a list of strings, as `resolveTxt` of `node:dns` gives it. */
  readonly records: readonly (readonly string[])[];
  /** The error code of a query with no records, for example `ENOTFOUND`. */
  readonly code?: string | undefined;
}

/**
 * The port of the probe of the origins. The port sends one TXT query to the resolver, and gives the answer.
 *
 * The port gives each outcome of the query as data. It throws only when the signal stops the query.
 */
export type TxtResolve = (query: TxtQuery, signal: AbortSignal) => Promise<TxtAnswer>;

/** The input of the probe of the origins. */
export interface OriginInput {
  /** The addresses to look up, for example the hops of a fact `path.report`. The probe looks up each address one time. */
  readonly addresses: readonly string[];
  /** The IP address of the DNS resolver. */
  readonly resolver: string;
  /** The port of the resolver. The default is 53. */
  readonly port?: number | undefined;
  /** The time limit of each query, in milliseconds. The default is `DEFAULT_ORIGIN_TIMEOUT_MS`. */
  readonly timeoutMs?: number | undefined;
}

/** One lookup of the probe: the query of an address and its answer. */
export interface OriginLookup {
  readonly address: string;
  /** The name of the TXT query. */
  readonly name: string;
  /** The answer of the port. A lookup with no answer has an error. */
  readonly answer?: TxtAnswer | undefined;
  /** The error of a lookup with no answer, or of an answer that is too long. */
  readonly error?: string | undefined;
}

/** The raw output of the probe of the origins: the lookup of each public address. */
export interface OriginRaw {
  /** The resolver, as `address:port`. */
  readonly resolver: string;
  readonly lookups: readonly OriginLookup[];
}

/** The id of the probe of the origins. */
export const ORIGIN_PROBE_ID = "dns.origin";

/** The largest number of queries of the probe of the origins at one time. */
export const ORIGIN_CONCURRENCY = 4;

/** The default time limit of each TXT query, in milliseconds. */
export const DEFAULT_ORIGIN_TIMEOUT_MS = 5000;

/** The largest length of all the strings of one answer, in UTF-16 code units. An answer of Team Cymru is much shorter. */
const MAX_ANSWER = 4096;

/** This function gives the different addresses of an input in their canonical form, in the order of their first place. */
function addressesOf(input: OriginInput): string[] {
  const addresses = [...new Set(input.addresses.map(canonicalAddress))];
  const bad = addresses.find((address) => addressFamily(address) === undefined);
  if (bad !== undefined) throw new RangeError(`"${bad}" is not an IP address.`);
  if (addresses.length > MAX_OWNER_ADDRESSES) throw new RangeError(`The input has ${addresses.length} addresses. The probe looks up ${MAX_OWNER_ADDRESSES} addresses or fewer.`);
  return addresses;
}

/** This function gives the resolver of an input as a target. It throws for a resolver that is not an IP address, and for a bad port. */
function resolverOf(input: OriginInput): Target {
  const address = canonicalAddress(input.resolver);
  if (ipVersion(address) === 0) throw new TypeError(`"${input.resolver}" is not an IP address of a resolver.`);
  const port = input.port ?? 53;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError(`${port} is not a port from 1 to 65535.`);
  return target(address, port);
}

function timeoutOf(input: OriginInput): number {
  const limit = input.timeoutMs ?? DEFAULT_ORIGIN_TIMEOUT_MS;
  if (!Number.isFinite(limit) || limit <= 0) throw new RangeError(`The time limit ${limit} is not a positive number of milliseconds.`);
  return limit;
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** This function gives the fact value of the lookup of a public address. */
function originOf(address: string, lookup: OriginLookup | undefined): PathOrigin {
  if (lookup === undefined) return { address, outcome: "failed", detail: `The probe did not look up ${address}.` };
  const answer = lookup.answer;
  if (lookup.error !== undefined || answer === undefined) return { address, outcome: "failed", detail: lookup.error ?? `The query ${lookup.name} gave no answer.` };
  if (answer.outcome === "nxdomain") return { address, outcome: "unrouted" };
  if (answer.outcome !== "ok") {
    const code = answer.code === undefined ? "" : ` (${answer.code})`;
    return { address, outcome: "failed", detail: `The query ${lookup.name} gave the outcome ${answer.outcome}${code}.` };
  }
  const origin = readOrigin(answer.records, address);
  return origin.tag === "ok" ? { address, outcome: "found", ...origin.value } : { address, outcome: "failed", detail: origin.error };
}

/**
 * This function makes the probe of the origins. The probe is active. Its peers are the resolver and the zone of Team
 * Cymru of each family of the public addresses.
 *
 * - The zones are peers because the names of the queries carry the addresses of the path to Team Cymru. Thus the user gives the permission.
 * - A special-purpose address, for example a private address, gets the outcome `special` and no query.
 * - The probe sends one query for each public address, and `ORIGIN_CONCURRENCY` queries at a time or fewer.
 */
export function originProbe(resolve: TxtResolve): Probe<OriginInput, OriginRaw> {
  return defineProbe<OriginInput, OriginRaw>({
    id: ORIGIN_PROBE_ID,
    version: "1",
    summary: "The BGP prefix and the origin AS of each public address of a path, from TXT queries to the DNS of Team Cymru.",
    layer: "path",
    mode: "active",
    kinds: [PATH_ORIGIN],
    peers(input): readonly Target[] {
      timeoutOf(input);
      const families = new Set<AddressFamily>();
      for (const address of addressesOf(input)) {
        const family = addressFamily(address);
        if (family !== undefined && addressClass(address) === "public") families.add(family);
      }
      const zones = (["ipv4", "ipv6"] as const).filter((family) => families.has(family)).map((family) => target(CYMRU_ZONES[family], 53));
      return [resolverOf(input), ...zones];
    },
    available: () => Promise.resolve({ available: true }),
    async run(input, context): Promise<OriginRaw> {
      const resolver = resolverOf(input);
      const timeoutMs = timeoutOf(input);
      const port = resolver.port ?? 53;
      const lookup = async (address: string): Promise<OriginLookup> => {
        const name = originQuery(address);
        try {
          const answer = await resolve({ name, resolver: resolver.host, port, timeoutMs }, context.signal);
          const length = answer.records.reduce((sum, record) => sum + record.reduce((total, part) => total + part.length, 0), 0);
          if (length > MAX_ANSWER) return { address, name, error: `The answer has ${length} code units, more than the limit of ${MAX_ANSWER}.` };
          return { address, name, answer };
        } catch (thrown) {
          if (context.signal.aborted) throw thrown;
          return { address, name, error: messageOf(thrown) };
        }
      };
      const lookups = addressesOf(input).filter((address) => addressClass(address) === "public");
      const done: OriginLookup[] = [];
      // A batch of ORIGIN_CONCURRENCY queries at a time. The worker pool of `@mark1russell7/service/channel` is the home of
      // such pools, but it needs Node 22.19, and netdiag supports Node 22.12. When netdiag raises its Node version, the probe uses it.
      for (let at = 0; at < lookups.length; at += ORIGIN_CONCURRENCY) {
        done.push(...(await Promise.all(lookups.slice(at, at + ORIGIN_CONCURRENCY).map(lookup))));
      }
      return { resolver: formatTarget(resolver), lookups: done };
    },
    parse(raw, input): readonly Observation[] {
      return addressesOf(input).map((address) => {
        const subject = target(address);
        const kind = addressClass(address);
        if (kind !== "public") return observe(PATH_ORIGIN, subject, { address, outcome: "special", class: kind ?? "unknown" });
        return observe(PATH_ORIGIN, subject, originOf(address, raw.lookups.find((lookup) => lookup.address === address)));
      });
    },
  });
}
