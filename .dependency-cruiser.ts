// The import boundaries of the workspace (@mark1russell7/boundaries): another package is imported only
// through an entry of its package.json. Start the check with `pnpm check:boundaries`.
import { boundaries, type Config } from "@mark1russell7/boundaries";

const config: Config = boundaries(import.meta.dirname, {
  forbidden: [
    {
      name: "pure-modules-import-no-node-module",
      severity: "error",
      comment: "The entry ./diagnosis and the fact kinds of netdiag import no node: module, so a browser can use them.",
      from: { path: "^packages/netdiag/src/(diagnosis/|kinds\\.ts$|fact\\.ts$|layer\\.ts$)" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "kinds-import-only-pure-modules",
      severity: "error",
      comment: "The fact kinds of the native probes import values only from fact.ts and layer.ts.",
      from: { path: "^packages/netdiag/src/kinds\\.ts$" },
      to: { path: "^packages/netdiag/src/(?!fact\\.ts$|layer\\.ts$)", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "diagnosis-imports-only-pure-modules",
      severity: "error",
      comment: "The entry ./diagnosis of netdiag imports only types from the modules of the runner.",
      from: { path: "^packages/netdiag/src/diagnosis/" },
      to: { path: "^packages/netdiag/src/(?!layer\\.ts$|diagnosis/)", dependencyTypesNot: ["type-only"] },
    },
  ],
});
export default config;
