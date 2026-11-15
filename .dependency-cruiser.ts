// The import boundaries of the workspace (@mark1russell7/boundaries): another package is imported only
// through an entry of its package.json. Start the check with `pnpm check:boundaries`.
import { boundaries, type Config } from "@mark1russell7/boundaries";

const config: Config = boundaries(import.meta.dirname, {
  forbidden: [
    {
      name: "diagnosis-imports-no-node-module",
      severity: "error",
      comment: "The entry ./diagnosis of netdiag imports no node: module, so a browser can use it.",
      from: { path: "^packages/netdiag/src/diagnosis/" },
      to: { dependencyTypes: ["core"] },
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
