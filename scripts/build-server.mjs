// Bundles the backend into a single dist/server.js so production needs no node_modules.
import { build } from "esbuild";

await build({
  entryPoints: ["server/src/index.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: "linked",
  legalComments: "none",
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});
