import { X509Certificate } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { createServer, connect } from "node:net";
import { describe, expect, it } from "vitest";
import { authority, dnsResponse, expiredValidity, listen, selfSigned, startDnsServer } from "./index.ts";

function query(name: string, type: number): Buffer {
  const labels = name.split(".").map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, "ascii")]));
  const tail = Buffer.alloc(5);
  tail.writeUInt16BE(type, 1);
  tail.writeUInt16BE(1, 3);
  return Buffer.concat([Buffer.from([0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]), ...labels, tail]);
}

describe("dnsResponse", () => {
  it("answers A records with their TTLs, and NXDOMAIN for a name that is not in the table", () => {
    const zone = { "a.example": { rcode: 0, a: ["192.0.2.1", "192.0.2.2"] } };
    const found = dnsResponse(zone, query("A.Example", 1));
    expect(found.name).toBe("a.example");
    expect(found.response?.readUInt16BE(0)).toBe(0x1234);
    expect(found.response?.readUInt16BE(6)).toBe(2);
    expect((found.response?.readUInt16BE(2) ?? 0) & 0xf).toBe(0);
    const missing = dnsResponse(zone, query("b.example", 1));
    expect((missing.response?.readUInt16BE(2) ?? 0) & 0xf).toBe(3);
  });

  it("gives no response for a silent name, and takes a zone as a function", () => {
    expect(dnsResponse({ "s.example": "silent" }, query("s.example", 1)).response).toBeUndefined();
    const each = dnsResponse(() => ({ rcode: 2 }), query("any.example", 1));
    expect((each.response?.readUInt16BE(2) ?? 0) & 0xf).toBe(2);
  });
});

describe("startDnsServer", () => {
  it("answers a resolver of Node.js, and records the names", async () => {
    const server = await startDnsServer({ zone: { "a.example": { rcode: 0, a: ["192.0.2.1"] } } });
    try {
      const resolver = new Resolver({ timeout: 1000, tries: 1 });
      resolver.setServers([`127.0.0.1:${server.port}`]);
      expect(await resolver.resolve4("a.example")).toEqual(["192.0.2.1"]);
      await expect(resolver.resolve4("b.example")).rejects.toMatchObject({ code: "ENOTFOUND" });
      expect(server.asked).toEqual(["a.example", "b.example"]);
    } finally {
      await server.close();
    }
  });
});

describe("the certificates", () => {
  it("issues a certificate that the root signs, for names and addresses", async () => {
    const root = await authority("fixture root");
    const leaf = new X509Certificate((await root.issue(["www.example", "192.0.2.1"])).cert);
    expect(leaf.subjectAltName).toBe("DNS:www.example, IP Address:192.0.2.1");
    expect(leaf.checkIssued(new X509Certificate(root.cert))).toBe(true);
    expect(new Date(leaf.validTo).getTime()).toBeGreaterThan(Date.now());
  }, 30_000);

  it("issues an expired certificate, and a self-signed certificate", async () => {
    const root = await authority("fixture root");
    const old = new X509Certificate((await root.issue(["www.example"], expiredValidity())).cert);
    expect(new Date(old.validTo).getTime()).toBeLessThan(Date.now());
    const own = new X509Certificate((await selfSigned(["www.example"])).cert);
    expect(own.issuer).toBe(own.subject);
    expect(own.verify(own.publicKey)).toBe(true);
  }, 30_000);
});

describe("listen", () => {
  it("gives the port, and closes the server with its open connections", async () => {
    const server = await listen(createServer());
    const socket = connect(server.port, "127.0.0.1");
    await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
    const ended = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await server.close();
    await ended;
    expect(socket.destroyed).toBe(true);
  });
});
