import { BlockList, isIP } from "node:net";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ADDRESS_CLASSES,
  addressClass,
  addressFamily,
  addressKind,
  canonicalAddress,
  cidrContains,
  cidrSet,
  formatCidr,
  ipVersion,
  parseCidr,
  type Cidr,
} from "./index.ts";

function cidr(text: string): Cidr {
  const range = parseCidr(text);
  if (range.tag === "err") throw new Error(range.error);
  return range.value;
}

describe("the family of an address", () => {
  it("tells IPv4, IPv6 and a text that is not an address", () => {
    expect(["192.0.2.1", " 192.0.2.1 ", "::ffff:192.0.2.1", "::FFFF:192.0.2.1"].map(addressFamily)).toEqual(Array(4).fill("ipv4"));
    expect(["2001:db8::1", "[2001:DB8::1]", "::1", "::"].map(addressFamily)).toEqual(Array(4).fill("ipv6"));
    expect(["example.com", "", "192.0.2", "1.2.3.4.5", "2001:db8::g"].map(addressFamily)).toEqual(Array(5).fill(undefined));
  });

  it("gives the canonical form", () => {
    expect(canonicalAddress(" [2001:DB8::1] ")).toBe("2001:db8::1");
    expect(canonicalAddress("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(canonicalAddress("192.0.2.1")).toBe("192.0.2.1");
  });
});

describe("CIDR ranges", () => {
  it("reads a range and an address alone", () => {
    expect(cidr("192.0.2.0/24")).toEqual({ address: "192.0.2.0", prefix: 24, family: "ipv4" });
    expect(cidr("2001:DB8::/32")).toEqual({ address: "2001:db8::", prefix: 32, family: "ipv6" });
    expect(cidr("192.0.2.7")).toEqual({ address: "192.0.2.7", prefix: 32, family: "ipv4" });
    expect(cidr("::1")).toEqual({ address: "::1", prefix: 128, family: "ipv6" });
    expect(cidr("0.0.0.0/0").prefix).toBe(0);
  });

  it("refuses a text that is not a range", () => {
    expect(parseCidr("example.com/24")).toEqual({ tag: "err", error: '"example.com/24" is not an IP address or a CIDR range.' });
    expect(parseCidr("192.0.2.0/33")).toEqual({ tag: "err", error: '"192.0.2.0/33" has no prefix from 0 to 32.' });
    expect(parseCidr("2001:db8::/129").tag).toBe("err");
    expect(parseCidr("192.0.2.0/").tag).toBe("err");
    expect(parseCidr("192.0.2.0/2a").tag).toBe("err");
    expect(parseCidr("192.0.2.0/-1").tag).toBe("err");
  });

  it("writes a range back as text", () => {
    for (const text of ["192.0.2.0/24", "2001:db8::/32", "10.0.0.1/32"]) expect(formatCidr(cidr(text))).toBe(text);
  });

  it("tells if an address is in a range or a set", () => {
    const lab = cidr("203.0.113.0/24");
    expect(cidrContains(lab, "203.0.113.200")).toBe(true);
    expect(cidrContains(lab, "::ffff:203.0.113.200")).toBe(true);
    expect(cidrContains(lab, "203.0.114.1")).toBe(false);
    expect(cidrContains(lab, "2001:db8::1")).toBe(false);
    expect(cidrContains(lab, "www.example.com")).toBe(false);
    const set = cidrSet([lab, cidr("2001:db8::/32"), cidr("192.168.250.80")]);
    expect(["203.0.113.9", "[2001:db8::9]", "192.168.250.80"].map((address) => set.has(address))).toEqual([true, true, true]);
    expect(["192.168.250.81", "2001:db9::1", "not an address"].map((address) => set.has(address))).toEqual([false, false, false]);
    expect(set.ranges).toHaveLength(3);
    expect(cidrSet([]).has("192.0.2.1")).toBe(false);
  });

  it("puts an IPv4 address in an IPv6 range of its IPv6 form, and the reverse", () => {
    expect(cidrSet([cidr("::ffff:0:0/96")]).has("192.0.2.1")).toBe(true);
    expect(cidrSet([cidr("192.0.2.0/24")]).has("::ffff:c000:201")).toBe(true);
    expect(cidrSet([cidr("::/0")]).has("192.0.2.1")).toBe(true);
    expect(cidrSet([cidr("0.0.0.0/0")]).has("2001:db8::1")).toBe(false);
    expect(cidrSet([cidr("fe80::/10")]).has("fe80::1%eth0")).toBe(true);
  });
});

// The parser of this module replaces `isIP` and `BlockList` of `node:net`, so a browser can import it. These tests
// compare the two on the Node.js of the test.
describe("the parser of addresses with no module of Node", () => {
  const SEED = 20261115;

  it("gives the version of each address as isIP", () => {
    const texts = [
      "1.2.3.4", "01.2.3.4", "256.1.1.1", "1.2.3", "1.2.3.4 ", "::", "::1", "1::", "1:2:3:4:5:6:7::", "::2:3:4:5:6:7:8",
      "1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8:9", "1::2::3", ":::", "1:2:3:4:5:6:1.2.3.4", "1:2:3:4:5:6::1.2.3.4", "::1.2.3.4",
      "::ffff:1.2.3.4", "1.2.3.4::", "fe80::1%eth0", "fe80::1%", "fe80::1%a b", "fe80::1%a_b", "fe80::1%a-b.c:d", "1.2.3.4%eth0",
      "FE80::ABCD", "12345::", "::01.2.3.4", "[::1]", "::1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8%z", "", "example.com",
    ];
    for (const text of texts) expect(ipVersion(text), JSON.stringify(text)).toBe(isIP(text));
  });

  it("gives the version of a random text as isIP", () => {
    const zone = fc.constantFrom("", "%eth0", "%a-b.c:d", "%", "%a b", "%1");
    const text = fc.oneof(
      fc.ipV4(),
      fc.ipV4Extended(),
      fc.tuple(fc.ipV6(), zone).map(([address, suffix]) => address + suffix),
      fc.string({ unit: fc.constantFrom(..."0123456789abcdefABCDEF:.%"), maxLength: 45 }),
    );
    fc.assert(
      fc.property(text, (value) => ipVersion(value) === isIP(value)),
      { seed: SEED, numRuns: 3000 },
    );
  });

  it("puts a random address in a random range as BlockList", () => {
    const address = fc.oneof(fc.ipV4(), fc.ipV6(), fc.ipV4().map((v4) => `::ffff:${v4}`));
    const cases = address.chain((network) => fc.tuple(fc.constant(network), fc.nat(128), fc.oneof(address, fc.constant(network))));
    fc.assert(
      fc.property(cases, ([network, bits, host]) => {
        const family = isIP(network) === 4 ? "ipv4" : "ipv6";
        const range = parseCidr(`${network}/${bits % (family === "ipv4" ? 33 : 129)}`);
        const canonical = canonicalAddress(host);
        const hostFamily = addressFamily(canonical);
        if (range.tag === "err" || hostFamily === undefined) return true;
        const list = new BlockList();
        list.addSubnet(range.value.address, range.value.prefix, range.value.family);
        return cidrSet([range.value]).has(host) === list.check(canonical, hostFamily);
      }),
      { seed: SEED, numRuns: 3000 },
    );
  });
});

describe("the class of an address", () => {
  it("gives the class of the first address of each special-purpose range", () => {
    for (const entry of ADDRESS_CLASSES) expect(addressClass(cidr(entry.cidr).address), entry.cidr).toBe(entry.class);
  });

  it("gives the class of an address in a range, at its edges and outside it", () => {
    expect(addressClass("172.31.255.255")).toBe("private");
    expect(addressClass("172.32.0.0")).toBe("public");
    expect(addressClass("100.127.255.255")).toBe("shared");
    expect(addressClass("100.128.0.0")).toBe("public");
    expect(addressClass("255.255.255.255")).toBe("reserved");
    expect(addressClass("fdff:ffff::1")).toBe("unique-local");
    expect(addressClass("febf::1")).toBe("link-local");
    expect(addressClass("fec0::1")).toBe("public");
    expect(addressClass("::ffff:10.1.2.3")).toBe("private");
    expect(addressClass("93.184.216.34")).toBe("public");
    expect(addressClass("2606:4700::1111")).toBe("public");
    expect(addressClass("example.com")).toBeUndefined();
  });

  it("tells if the internet routes to an address", () => {
    expect(["10.1.2.3", "172.31.0.1", "192.168.1.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "0.0.0.0"].map(addressKind)).toEqual(Array(7).fill("private"));
    expect(["fd00::1", "fe80::1", "::1", "::", "::ffff:192.168.1.1"].map(addressKind)).toEqual(Array(5).fill("private"));
    expect(["93.184.216.34", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"].map(addressKind)).toEqual(Array(4).fill("public"));
    // The lab uses documentation addresses for hosts on the internet.
    expect(["203.0.113.10", "198.51.100.1", "192.0.2.1", "2001:db8::1", "198.18.0.1", "224.0.0.1"].map(addressKind)).toEqual(Array(6).fill("public"));
    expect(addressKind("example.com")).toBeUndefined();
  });
});
