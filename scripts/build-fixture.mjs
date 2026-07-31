import { build } from "esbuild";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(import.meta.dirname, "..");
const fixturesRoot = resolve(appRoot, "fixtures");
const outputRoot = resolve(fixturesRoot, "dist");
const siteSource = resolve(fixturesRoot, "site");
const siteOutput = resolve(outputRoot, "site");
const extensionOutput = resolve(outputRoot, "extension");
const productionDist = resolve(appRoot, "dist");
const requiredPages = ["index.html", "long-form.html", "protected.html", "ambiguous-missing.html", "excluded.html", "performance.html"];

const assertProductionExclusion = async () => {
  const files = await readdir(productionDist, { recursive: true });
  if (files.some((file) => String(file).toLowerCase().includes("fixture"))) {
    throw new Error("Production dist contains fixture-only output.");
  }
  const manifest = await readFile(resolve(productionDist, "manifest.json"), "utf8");
  if (/fixture-seed|fixture/i.test(manifest)) throw new Error("Production manifest contains fixture-only configuration.");
};

export const buildFixture = async () => {
  await assertProductionExclusion();
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(siteOutput, { recursive: true });
  await cp(siteSource, siteOutput, { recursive: true });
  await mkdir(extensionOutput, { recursive: true });
  await cp(productionDist, extensionOutput, { recursive: true });
  await cp(resolve(fixturesRoot, "extension", "fixture-seed.html"), resolve(extensionOutput, "fixture-seed.html"));
  await build({
    entryPoints: [resolve(appRoot, "src", "fixture", "seed-page.ts")],
    outfile: resolve(extensionOutput, "fixture-seed.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120", "edge120"],
    sourcemap: false,
    legalComments: "none",
  });
  for (const page of requiredPages) {
    await readFile(resolve(siteOutput, page), "utf8");
  }
  await writeFile(resolve(outputRoot, "fixture-manifest.json"), `${JSON.stringify({
    fixtureSite: { host: "127.0.0.1", port: 4173, pages: requiredPages },
    extensionSeed: { page: "fixture-seed.html", stores: ["terms", "senses", "sources", "encounters", "relationships", "reviewStates", "preferences"] },
    productionExclusionVerified: true,
  }, null, 2)}\n`);
};

export const serveFixture = async ({ port = 4173 } = {}) => {
  const root = siteOutput;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^[/]+/, "");
    const file = resolve(root, relative);
    if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
    try { response.writeHead(200); response.end(await readFile(file)); } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise((resolveServer, rejectServer) => server.once("error", rejectServer).listen(port, "127.0.0.1", resolveServer));
  return server;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildFixture();
  console.log("Fixture build complete: fixtures/dist/site (serve at http://127.0.0.1:4173) and fixtures/dist/extension/fixture-seed.html.");
}
