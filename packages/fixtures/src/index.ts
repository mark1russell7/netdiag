/**
 * The test fixtures of netdiag: a DNS server, roots of trust and server certificates, and a server that listens.
 * The probe tests and the lab use them.
 */
export { MISSING, dnsResponse, startDnsServer, type DnsServer, type DnsServerOptions, type Zone, type ZoneEntry } from "./dns.ts";
export { authority, expiredValidity, selfSigned, type Authority, type Pems, type Validity } from "./certificates.ts";
export { listen, type Listening } from "./listen.ts";
