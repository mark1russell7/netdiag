import { createHmac } from "node:crypto";
import type { HistoryHasher } from "./history.ts";

// The keyed hash of a history on Node. The key stays on the machine, so a hash of a value tells nothing without it.

/** The least length of the key of a machine, in bytes. */
export const HISTORY_KEY_BYTES = 32;

/**
 * This function gives the hasher of a history with a key of the machine: HMAC-SHA256 of each value, as hexadecimal text.
 * The id of the key is the first 16 digits of the HMAC of a fixed text. The key has `HISTORY_KEY_BYTES` bytes or more.
 */
export function machineHasher(key: Uint8Array): HistoryHasher {
  if (key.length < HISTORY_KEY_BYTES) throw new RangeError(`The key of a history has ${key.length} bytes. It needs ${HISTORY_KEY_BYTES} bytes or more.`);
  const copy = Uint8Array.from(key);
  const hash = (value: string): string => createHmac("sha256", copy).update(value, "utf8").digest("hex");
  return { id: hash("netdiag history key id").slice(0, 16), hash };
}
