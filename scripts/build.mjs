// scripts/build.mjs
import { build } from "esbuild";
import { rm, mkdir, cp } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const assetsDir = path.join(distDir, "assets");

async function cleanDist() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });
}

async function copyPublic() {
  const publicDir = path.join(projectRoot, "public");
  // Node 16+ supports fs.cp
  await cp(publicDir, distDir, { recursive: true });
}

async function bundleApp() {
  await build({
    entryPoints: [path.join(projectRoot, "src", "main.ts")],
    outfile: path.join(assetsDir, "app.js"),
    bundle: true,
    format: "esm",
    target: ["es2020"],
    sourcemap: true,
    minify: false,
    platform: "browser",
  });
}

async function bundleWorklet() {
  // Worklet must be a separate JS file that the browser can fetch.
  await build({
    entryPoints: [path.join(projectRoot, "src", "audio", "worklet.ts")],
    outfile: path.join(assetsDir, "worklet.js"),
    bundle: true,
    format: "esm",
    target: ["es2020"],
    sourcemap: true,
    minify: false,
    platform: "browser",
  });
}

async function main() {
  await cleanDist();
  await copyPublic();

  // Build app + worklet in parallel
  await Promise.all([bundleApp(), bundleWorklet()]);

  console.log("Build complete:");
  console.log(" - dist/");
  console.log("   - assets/app.js");
  console.log("   - assets/worklet.js");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
