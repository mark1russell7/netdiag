import { startDnsServer, type ZoneEntry } from "@netdiag/fixtures";
import { z } from "zod";

// The DNS resolver of the kernel lab, a sibling of the harness. It answers from a fixed zone on the port 53. The zone
// comes as one argument: JSON in base64, because a sibling of the harness gets no files.
//
//   node packages/lab/src/kernel/resolver.ts <zone in base64>

/** The text that the resolver writes when it listens. The harness waits for it. */
export const RESOLVER_READY = "netdiag resolver ready";

/** A zone of the kernel lab: a table of names. */
export type KernelZone = Readonly<Record<string, ZoneEntry>>;

const ENTRY = z.union([
  z.literal("silent"),
  z.object({ rcode: z.number().int().min(0).max(15), a: z.array(z.string()).optional(), aaaa: z.array(z.string()).optional() }),
]);
const ZONE = z.record(z.string(), ENTRY);

/** This function gives the argument of the resolver for a zone. */
export function zoneArg(zone: KernelZone): string {
  return Buffer.from(JSON.stringify(zone), "utf8").toString("base64");
}

/** This function reads the argument of the resolver. It throws a `RangeError` for a zone that is not valid. */
export function parseZoneArg(arg: string | undefined): KernelZone {
  if (arg === undefined) throw new RangeError("The resolver needs a zone in base64.");
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(arg, "base64").toString("utf8"));
  } catch {
    throw new RangeError("The zone of the resolver is not JSON in base64.");
  }
  const parsed = ZONE.safeParse(json);
  if (!parsed.success) throw new RangeError(`The zone of the resolver is not valid: ${z.prettifyError(parsed.error)}`);
  const entry = (each: (typeof parsed.data)[string]): ZoneEntry =>
    each === "silent" ? each : { rcode: each.rcode, ...(each.a === undefined ? {} : { a: each.a }), ...(each.aaaa === undefined ? {} : { aaaa: each.aaaa }) };
  return Object.fromEntries(Object.entries(parsed.data).map(([name, each]) => [name, entry(each)]));
}

if (import.meta.main) {
  const server = await startDnsServer({ zone: parseZoneArg(process.argv[2]), host: "0.0.0.0", port: 53 });
  process.stdout.write(`${RESOLVER_READY} on ${server.host}:${server.port}\n`);
}
