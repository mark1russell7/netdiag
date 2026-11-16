import type { RdapRequest } from "@mark1russell7/netdiag";
import type { Exchange, Pace, Reply, Transport } from "polite-crawler/api";
import { HostScheduler } from "polite-crawler/politeness";
import { describe, expect, it } from "vitest";
import { RDAP_SOURCE, rdapPort, userAgentOf } from "./rdap.ts";

// The port over `polite-crawler/api` with a fake transport and a clock that does not wait. No test sends a packet.

/** A pace on a clock that moves forward at each wait, so a rest of a host ends at once. */
function fakePace(): Pace {
  let time = 0;
  const clock = {
    now: () => time,
    sleep: (ms: number) => {
      time += ms;
      return Promise.resolve();
    },
  };
  return { scheduler: new HostScheduler(clock, 2), now: clock.now };
}

function fakeTransport(reply: Reply | Error): { readonly transport: Transport; readonly exchanges: Exchange[] } {
  const exchanges: Exchange[] = [];
  const transport: Transport = (exchange) => {
    exchanges.push(exchange);
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  };
  return { transport, exchanges };
}

const REQUEST: RdapRequest = {
  host: "rdap.arin.net",
  url: "https://rdap.arin.net/registry/ip/8.8.4.4",
  headers: { Accept: "application/rdap+json, application/json" },
  what: "the network of 8.8.4.4",
};

const signal = new AbortController().signal;

describe("the port of RDAP over polite-crawler", () => {
  it("sends one GET with the headers in lower case, and gives the status, the headers and the body", async () => {
    const fake = fakeTransport({ status: 200, statusText: "OK", headers: { "content-type": "application/rdap+json" }, body: "{}" });
    const reply = await rdapPort(fakePace(), fake.transport)(REQUEST, signal);
    expect(reply).toEqual({ status: 200, headers: { "content-type": "application/rdap+json" }, body: "{}" });
    expect(fake.exchanges).toEqual([{ method: "GET", url: REQUEST.url, headers: { accept: "application/rdap+json, application/json" }, body: null }]);
  });

  it("gives a status 404 and a redirect as answers, not as errors", async () => {
    const missing = fakeTransport({ status: 404, statusText: "Not Found", headers: {}, body: "" });
    expect((await rdapPort(fakePace(), missing.transport)(REQUEST, signal)).status).toBe(404);
    const moved = fakeTransport({ status: 302, statusText: "Found", headers: { location: "https://rdap.db.ripe.net/ip/8.8.4.4" }, body: "" });
    expect(await rdapPort(fakePace(), moved.transport)(REQUEST, signal)).toMatchObject({ status: 302, headers: { location: "https://rdap.db.ripe.net/ip/8.8.4.4" } });
  });

  it("throws when the registry gives no answer", async () => {
    const down = fakeTransport(new Error("connect ECONNREFUSED"));
    await expect(rdapPort(fakePace(), down.transport)(REQUEST, signal)).rejects.toThrow();
    expect(RDAP_SOURCE).toBe("RDAP");
  });

  it("names netdiag, its version and its page in the User-Agent", () => {
    expect(userAgentOf("0.5.2")).toBe("netdiag/0.5.2 (+https://github.com/mark1russell7/netdiag)");
  });
});
