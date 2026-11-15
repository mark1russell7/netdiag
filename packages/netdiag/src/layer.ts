/**
 * The layers of the network stack that netdiag examines, from the bottom to the top.
 *
 * - `link`: the network interface and its physical link.
 * - `wifi`: the Wi-Fi link: the signal, the channel and the rate.
 * - `ip`: the addresses of the interfaces.
 * - `route`: the routes of this computer and its gateway.
 * - `path`: the hops through the provider networks to the remote host.
 * - `dns`: the resolution of names to addresses.
 * - `tcp`: the connections to a port.
 * - `tls`: the handshake and the certificate of the server.
 * - `http`: the request and the response.
 */
export const LAYERS = ["link", "wifi", "ip", "route", "path", "dns", "tcp", "tls", "http"] as const;

/** A layer of the network stack. The list `LAYERS` gives each layer in its order. */
export type Layer = (typeof LAYERS)[number];

const RANKS: ReadonlyMap<string, number> = new Map(LAYERS.map((layer, rank) => [layer, rank]));

/** This function tells if a value is the name of a layer. */
export function isLayer(value: unknown): value is Layer {
  return typeof value === "string" && RANKS.has(value);
}

/** This function gives the position of a layer in `LAYERS`. The bottom layer `link` has the position 0. */
export function layerRank(layer: Layer): number {
  const rank = RANKS.get(layer);
  if (rank === undefined) throw new RangeError(`"${String(layer)}" is not a layer`);
  return rank;
}
