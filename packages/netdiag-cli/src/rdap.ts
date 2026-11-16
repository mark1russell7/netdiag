import type { RdapGet } from "@mark1russell7/netdiag";
import { fetchTransport, send, type Pace, type Transport } from "polite-crawler/api";
import { HostScheduler, realClock } from "polite-crawler/politeness";

// The port of the lookups of the owners: each request goes through `send` of `polite-crawler/api`. The scheduler keeps
// one request in progress for each registry, and a rest between two requests. A registry that refuses netdiag, or
// that fails five times, stops for the rest of the check.

/** The name of the API in a message of `polite-crawler`. */
export const RDAP_SOURCE = "RDAP";

/** The number of registries that the scheduler of `systemRdap` sends requests to at the same time. */
export const RDAP_ACTIVE_HOSTS = 2;

/** This function gives the User-Agent of the requests of netdiag, with the version and the page of the project. */
export function userAgentOf(version: string): string {
  return `netdiag/${version} (+https://github.com/mark1russell7/netdiag)`;
}

/** This function makes the port of the lookups of the owners from a pace and a transport of `polite-crawler/api`. A test gives a fake transport. */
export function rdapPort(pace: Pace, transport: Transport): RdapGet {
  return async (request, signal) => {
    const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]));
    const exchange = { method: "GET", url: request.url, headers, body: null };
    const answer = await send(pace, transport, { source: RDAP_SOURCE, host: request.host, what: request.what, exchange }, signal);
    return { status: answer.reply.status, headers: answer.reply.headers, body: answer.reply.body };
  };
}

/** This function gives the port of this computer: the `fetch` of Node.js, with the pace of `polite-crawler` on the real clock. */
export function systemRdap(version: string): RdapGet {
  const scheduler = new HostScheduler(realClock, RDAP_ACTIVE_HOSTS);
  return rdapPort({ scheduler, now: realClock.now }, fetchTransport({ userAgent: userAgentOf(version) }));
}
