/**
 * The probe of the owners of the addresses of a path. It looks up the network of each public address in RDAP, at the
 * registry that the bootstrap of IANA gives.
 *
 * The probe sends each request through a port, `RdapGet`. Thus this module has no HTTP client and no module of Node.
 * The command-line tool gives a port over `send` of `polite-crawler/api`, which keeps the pace of each registry.
 *
 * @packageDocumentation
 */
import { addressClass, addressFamily, canonicalAddress, type AddressFamily } from "../address/index.ts";
import { observe, type Observation } from "../fact.ts";
import { PATH_OWNER, type PathOwner } from "../kinds.ts";
import { defineProbe, type Probe } from "../probe.ts";
import { canonicalHost, target, type Target } from "../target.ts";
import { networkQuery, RDAP_BOOTSTRAP, RDAP_REGISTRIES, readBootstrap, readNetwork, secureBase, serviceFor, type RdapBootstrap } from "./rdap.ts";

/** One GET request of the probe of the owners. */
export interface RdapRequest {
  /** The host of the URL. The port keeps one pace for each host. */
  readonly host: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** What the request asks for, in plain words, for example `the network of 192.0.2.1`. */
  readonly what: string;
}

/** The answer of a registry to one request. The names of the headers are in lower case. */
export interface RdapReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * The port of the probe of the owners. The port sends one GET request at the pace of its host, and gives the answer.
 *
 * - The port does not follow a redirect. The probe follows a redirect only to a permitted registry.
 * - The port gives each status. It throws when the registry gives no answer, and when the signal stops the request.
 */
export type RdapGet = (request: RdapRequest, signal: AbortSignal) => Promise<RdapReply>;

/** The input of the probe of the owners. */
export interface OwnerInput {
  /** The addresses to look up, for example the hops of a fact `path.trace`. The probe looks up each address one time. */
  readonly addresses: readonly string[];
  /** The hosts of the registries that the probe can send requests to. The default is `RDAP_REGISTRIES`. */
  readonly registries?: readonly string[] | undefined;
}

/** One exchange of the probe: a request and its answer. */
export interface OwnerExchange {
  readonly url: string;
  /** The status of the answer. An exchange with no answer has no status. */
  readonly status?: number | undefined;
  /** The header `location` of a redirect. */
  readonly location?: string | undefined;
  /** The body of an answer with the status 200. */
  readonly body?: string | undefined;
  /** The error of an exchange with no answer, or of a body that is too long. */
  readonly error?: string | undefined;
}

/** The raw output of the probe of the owners: the exchanges for the bootstrap files and for each address. */
export interface OwnerRaw {
  readonly bootstraps: readonly { readonly family: AddressFamily; readonly exchange: OwnerExchange }[];
  readonly lookups: readonly { readonly address: string; readonly exchanges: readonly OwnerExchange[] }[];
}

/** The options of the probe of the owners. */
export interface OwnerProbeOptions {
  /** The largest number of redirects for one address. The default is `DEFAULT_OWNER_REDIRECTS`. */
  readonly maxRedirects?: number | undefined;
  /** The largest length of a body, in UTF-16 code units. The default is `DEFAULT_RDAP_BODY`. */
  readonly maxBody?: number | undefined;
}

/** The default largest number of redirects for one address. */
export const DEFAULT_OWNER_REDIRECTS = 2;

/** The default largest length of a body of RDAP, in UTF-16 code units: 512 Ki. */
export const DEFAULT_RDAP_BODY = 524_288;

/** The largest number of different addresses of one run of the probe of the owners. */
export const MAX_OWNER_ADDRESSES = 64;

/** The id of the probe of the owners. */
export const OWNER_PROBE_ID = "rdap.owner";

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const RDAP_HEADERS: Readonly<Record<string, string>> = { accept: "application/rdap+json, application/json" };

const IANA_HOST = new URL(RDAP_BOOTSTRAP.ipv4).hostname;

/** This function gives the different addresses of an input in their canonical form, in the order of their first place. */
function addressesOf(input: OwnerInput): string[] {
  const addresses = [...new Set(input.addresses.map(canonicalAddress))];
  const bad = addresses.find((address) => addressFamily(address) === undefined);
  if (bad !== undefined) throw new RangeError(`"${bad}" is not an IP address.`);
  if (addresses.length > MAX_OWNER_ADDRESSES) throw new RangeError(`The input has ${addresses.length} addresses. The probe looks up ${MAX_OWNER_ADDRESSES} addresses or fewer.`);
  return addresses;
}

function registriesOf(input: OwnerInput): ReadonlySet<string> {
  return new Set((input.registries ?? RDAP_REGISTRIES).map(canonicalHost));
}

function familyName(family: AddressFamily): string {
  return family === "ipv4" ? "IPv4" : "IPv6";
}

/** This function tells if a URL is a URL of an permitted registry with the scheme `https`. */
function permitted(url: URL, registries: ReadonlySet<string>): boolean {
  return url.protocol === "https:" && registries.has(canonicalHost(url.hostname));
}

/** The decision for one public address and one bootstrap: the URL of the query, or the reason that the address is unlisted. */
type Query = { readonly url: URL } | { readonly unlisted: string };

/** This function gives the query of an address from a bootstrap. `run` and `parse` both use it, so they give the same decision. */
function queryOf(bootstrap: RdapBootstrap, address: string, registries: ReadonlySet<string>): Query {
  const service = serviceFor(bootstrap, address);
  if (service === undefined) return { unlisted: `The bootstrap of IANA gives no registry for ${address}.` };
  const base = secureBase(service);
  if (base === undefined) return { unlisted: `The registry of ${address} has no URL with https.` };
  if (!permitted(base, registries)) return { unlisted: `The registry ${base.hostname} of ${address} is not in the permitted registries.` };
  return { url: networkQuery(base, address) };
}

function header(reply: RdapReply, name: string): string | undefined {
  return reply.headers[name] ?? Object.entries(reply.headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

/** This function gives the next URL of a redirect to an permitted registry, or `undefined` when the exchange is not such a redirect. */
function redirectOf(exchange: OwnerExchange, registries: ReadonlySet<string>): URL | undefined {
  if (exchange.status === undefined || !REDIRECTS.has(exchange.status) || exchange.location === undefined) return undefined;
  if (!URL.canParse(exchange.location, exchange.url)) return undefined;
  const next = new URL(exchange.location, exchange.url);
  return permitted(next, registries) ? next : undefined;
}

/** This function gives the bootstrap of a family from the raw output, or the reason that it is not usable. */
function bootstrapOf(raw: OwnerRaw, family: AddressFamily): RdapBootstrap | string {
  const name = familyName(family);
  const exchange = raw.bootstraps.find((each) => each.family === family)?.exchange;
  if (exchange === undefined) return `The probe did not get the bootstrap of IANA for ${name}.`;
  if (exchange.error !== undefined) return `The bootstrap of IANA for ${name} gave no answer: ${exchange.error}`;
  if (exchange.status !== 200 || exchange.body === undefined) return `The bootstrap of IANA for ${name} gave the status ${exchange.status ?? 0}.`;
  const read = readBootstrap(exchange.body, family);
  return read.tag === "ok" ? read.value : read.error;
}

/** This function gives the fact value of the last exchange of a lookup. */
function ownerOf(address: string, exchanges: readonly OwnerExchange[], registries: ReadonlySet<string>, maxRedirects: number): PathOwner {
  const last = exchanges.at(-1);
  if (last === undefined) return { address, outcome: "failed", detail: `The probe did not look up ${address}.` };
  const registry = new URL(last.url).hostname;
  if (last.error !== undefined) return { address, outcome: "failed", registry, detail: last.error };
  if (last.status === 404) return { address, outcome: "unregistered", registry };
  if (last.status === 200 && last.body !== undefined) {
    const network = readNetwork(last.body);
    return network.tag === "ok" ? { address, outcome: "found", registry, network: network.value } : { address, outcome: "failed", registry, detail: network.error };
  }
  if (last.status !== undefined && REDIRECTS.has(last.status)) {
    const detail =
      redirectOf(last, registries) === undefined
        ? `${registry} sent the lookup to a place that is not an permitted registry: ${last.location ?? "no location"}.`
        : `${registry} gave more than ${maxRedirects} redirects for ${address}.`;
    return { address, outcome: "failed", registry, detail };
  }
  return { address, outcome: "failed", registry, detail: `${registry} gave the status ${last.status ?? 0}.` };
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * This function makes the probe of the owners. The probe is active: its peers are the host of the bootstrap of IANA
 * and each permitted registry. The user gives the permission for the lookups, because they send the addresses of the path to the registries.
 *
 * - A special-purpose address, for example a private address, gets the outcome `special` and no lookup.
 * - The probe gets the bootstrap of each family of the public addresses one time.
 * - The probe follows a redirect only to an permitted registry with `https`, and `maxRedirects` times or fewer.
 * - The probe sends each request after the answer to the request before it. The port keeps the pace of each registry.
 */
export function ownerProbe(get: RdapGet, options: OwnerProbeOptions = {}): Probe<OwnerInput, OwnerRaw> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_OWNER_REDIRECTS;
  const maxBody = options.maxBody ?? DEFAULT_RDAP_BODY;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) throw new RangeError("The largest number of redirects is not an integer of 0 or more.");
  if (!Number.isInteger(maxBody) || maxBody < 1) throw new RangeError("The largest length of a body is not a positive integer.");

  async function exchange(url: URL, headers: Readonly<Record<string, string>>, what: string, signal: AbortSignal): Promise<OwnerExchange> {
    let reply: RdapReply;
    try {
      reply = await get({ host: url.hostname, url: url.href, headers, what }, signal);
    } catch (thrown) {
      if (signal.aborted) throw thrown;
      return { url: url.href, error: messageOf(thrown) };
    }
    const location = header(reply, "location");
    if (reply.status !== 200) return { url: url.href, status: reply.status, location };
    if (reply.body.length > maxBody) return { url: url.href, status: reply.status, error: `The body has ${reply.body.length} code units, more than the limit of ${maxBody}.` };
    return { url: url.href, status: reply.status, body: reply.body };
  }

  return defineProbe<OwnerInput, OwnerRaw>({
    id: OWNER_PROBE_ID,
    version: "1",
    summary: "The registered network and the holder of each public address of a path, from a lookup in RDAP.",
    layer: "path",
    mode: "active",
    kinds: [PATH_OWNER],
    peers(input): readonly Target[] {
      addressesOf(input);
      return [target(IANA_HOST, 443), ...[...registriesOf(input)].map((host) => target(host, 443))];
    },
    available: () => Promise.resolve({ available: true }),
    async run(input, context): Promise<OwnerRaw> {
      const registries = registriesOf(input);
      const lookups = addressesOf(input).filter((address) => addressClass(address) === "public");
      const families = [...new Set(lookups.map((address) => addressFamily(address)).filter((family) => family !== undefined))];
      const bootstraps: { family: AddressFamily; exchange: OwnerExchange }[] = [];
      for (const family of families) {
        const url = new URL(RDAP_BOOTSTRAP[family]);
        bootstraps.push({ family, exchange: await exchange(url, { accept: "application/json" }, `the RDAP bootstrap of IANA for ${familyName(family)}`, context.signal) });
      }
      const raw: OwnerRaw = { bootstraps, lookups: [] };
      const done: { address: string; exchanges: OwnerExchange[] }[] = [];
      for (const address of lookups) {
        const family = addressFamily(address);
        const bootstrap = family === undefined ? "" : bootstrapOf(raw, family);
        if (typeof bootstrap === "string") continue;
        const query = queryOf(bootstrap, address, registries);
        if ("unlisted" in query) continue;
        const exchanges: OwnerExchange[] = [];
        let url: URL | undefined = query.url;
        while (url !== undefined && exchanges.length <= maxRedirects) {
          const answer = await exchange(url, RDAP_HEADERS, `the network of ${address}`, context.signal);
          exchanges.push(answer);
          url = redirectOf(answer, registries);
        }
        done.push({ address, exchanges });
      }
      return { bootstraps, lookups: done };
    },
    parse(raw, input): readonly Observation[] {
      const registries = registriesOf(input);
      return addressesOf(input).map((address) => {
        const subject = target(address);
        const kind = addressClass(address);
        if (kind !== "public") return observe(PATH_OWNER, subject, { address, outcome: "special", class: kind ?? "unknown" });
        const family = addressFamily(address);
        const bootstrap = family === undefined ? `"${address}" is not an IP address.` : bootstrapOf(raw, family);
        if (typeof bootstrap === "string") return observe(PATH_OWNER, subject, { address, outcome: "failed", detail: bootstrap });
        const query = queryOf(bootstrap, address, registries);
        if ("unlisted" in query) return observe(PATH_OWNER, subject, { address, outcome: "unlisted", detail: query.unlisted });
        const exchanges = raw.lookups.find((lookup) => lookup.address === address)?.exchanges ?? [];
        return observe(PATH_OWNER, subject, ownerOf(address, exchanges, registries, maxRedirects));
      });
    },
  });
}
