import { createSocket, type Socket } from "node:dgram";
import { isIP } from "node:net";

/** The answer of a DNS server for one name: a response code and records, or `silent` for no answer. */
export type ZoneEntry =
  | {
      /** The response code: 0 for no error, 2 for `SERVFAIL`, 3 for `NXDOMAIN`, 5 for `REFUSED`. */
      readonly rcode: number;
      /** The IPv4 addresses of the `A` records. */
      readonly a?: readonly string[];
      /** The IPv6 addresses of the `AAAA` records, as 32 hexadecimal digits. */
      readonly aaaa?: readonly string[];
      /** The `TXT` records. Each record is a list of strings of 255 bytes or fewer. */
      readonly txt?: readonly (readonly string[])[];
    }
  | "silent";

/** The answers of a DNS server: a table of names, or a function of the name. */
export type Zone = Readonly<Record<string, ZoneEntry>> | ((name: string) => ZoneEntry);

/** The options of a DNS server. */
export interface DnsServerOptions {
  readonly zone: Zone;
  /** The address of the server. The default is `127.0.0.1`. */
  readonly host?: string | undefined;
  /** The UDP port. The default is a free port. */
  readonly port?: number | undefined;
}

/** A DNS server on UDP for tests. */
export interface DnsServer {
  readonly host: string;
  readonly port: number;
  /** The names of the queries, in lower case, in the order of arrival. */
  readonly asked: readonly string[];
  close(): Promise<void>;
}

/** The answer to a name that is not in a table: `NXDOMAIN`. */
export const MISSING: ZoneEntry = { rcode: 3 };

function entryOf(zone: Zone, name: string): ZoneEntry {
  return typeof zone === "function" ? zone(name) : (zone[name] ?? MISSING);
}

/**
 * This function gives the response to one DNS query, or `undefined` for no response. The response has the records
 * of the zone for the type `A` (1), `AAAA` (28) or `TXT` (16), and no records for each other type. Each record has a
 * TTL of 300 seconds, minus 60 seconds for each record before it.
 */
export function dnsResponse(zone: Zone, query: Buffer): { readonly name: string; readonly response: Buffer | undefined } {
  let offset = 12;
  const labels: string[] = [];
  while ((query[offset] ?? 0) !== 0) {
    const length = query[offset] ?? 0;
    labels.push(query.subarray(offset + 1, offset + 1 + length).toString("ascii"));
    offset += 1 + length;
  }
  const type = query.readUInt16BE(offset + 1);
  const end = offset + 5;
  const name = labels.join(".").toLowerCase();
  const entry = entryOf(zone, name);
  if (entry === "silent") return { name, response: undefined };
  const v4 = (entry.a ?? []).filter((address) => isIP(address) === 4).map((address) => Buffer.from(address.split(".").map(Number)));
  const txt = (entry.txt ?? []).map((strings) => Buffer.concat(strings.map((text) => Buffer.concat([Buffer.from([Buffer.byteLength(text)]), Buffer.from(text)]))));
  const records = type === 1 ? v4 : type === 28 ? (entry.aaaa ?? []).map((hex) => Buffer.from(hex, "hex")) : type === 16 ? txt : [];
  const head = Buffer.alloc(12);
  head.writeUInt16BE(query.readUInt16BE(0), 0);
  head.writeUInt16BE(0x8180 | entry.rcode, 2);
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(records.length, 6);
  const answers = records.map((data, i) => {
    const record = Buffer.alloc(12);
    record.writeUInt16BE(0xc00c, 0);
    record.writeUInt16BE(type, 2);
    record.writeUInt16BE(1, 4);
    record.writeUInt32BE(300 - i * 60, 6);
    record.writeUInt16BE(data.length, 10);
    return Buffer.concat([record, data]);
  });
  return { name, response: Buffer.concat([head, query.subarray(12, end), ...answers]) };
}

/** This function starts a DNS server on UDP. It answers each query from its zone. */
export async function startDnsServer(options: DnsServerOptions): Promise<DnsServer> {
  const host = options.host ?? "127.0.0.1";
  const asked: string[] = [];
  const socket: Socket = createSocket(isIP(host) === 6 ? "udp6" : "udp4");
  socket.on("message", (message, peer) => {
    const { name, response } = dnsResponse(options.zone, message);
    asked.push(name);
    if (response !== undefined) socket.send(response, peer.port, peer.address);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(options.port ?? 0, host, () => {
      socket.off("error", reject);
      resolve();
    });
  });
  return {
    host,
    port: socket.address().port,
    asked,
    close: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}
