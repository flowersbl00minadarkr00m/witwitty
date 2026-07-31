import { build } from "esbuild";
import { resolve } from "node:path";

await build({
  entryPoints: [resolve("src/content/index.ts")],
  outfile: resolve("dist/content.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120", "edge120"],
  sourcemap: false,
  minify: false,
  legalComments: "none",
});
