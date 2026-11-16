import { readFileSync } from "node:fs";

// The version of this package. `--version` shows it, and the User-Agent of the lookups of the owners sends it.

/** This function gives the version in `package.json` of this package. */
export function packageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const version = typeof manifest === "object" && manifest !== null && "version" in manifest ? manifest.version : undefined;
  return typeof version === "string" ? version : "0.0.0";
}
