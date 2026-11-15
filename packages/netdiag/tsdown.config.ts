import { defineConfig } from "tsdown";

// The build of the package for npm: an ES module and its declarations in build/. The workspace uses the source.
export default defineConfig({
  entry: { index: "src/index.ts", address: "src/address/index.ts", diagnosis: "src/diagnosis/index.ts" },
  outDir: "build",
  format: "esm",
  platform: "node",
  // The node platform gives .mjs files by default. The exports of package.json name .js files.
  fixedExtension: false,
  sourcemap: true,
  publint: true,
});
