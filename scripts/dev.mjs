// scripts/dev.mjs
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import * as esbuild from "esbuild";
import { rm, mkdir, cp } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const assetsDir = path.join(distDir, "assets");
const publicDir = path.join(projectRoot, "public");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

async function cleanDistOnce() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });
}

async function copyPublic() {
  await mkdir(distDir, { recursive: true });
  await cp(publicDir, distDir, { recursive: true });
}

function buildOptions(entryRelPath, outRelPath) {
  return {
    entryPoints: [path.join(projectRoot, entryRelPath)],
    outfile: path.join(projectRoot, outRelPath),
    bundle: true,
    format: "esm",
    target: ["es2020"],
    sourcemap: true,
    minify: false,
    platform: "browser",
    logLevel: "info",
  };
}

async function startEsbuildWatch() {
  // Create independent contexts for app + worklet
  const appCtx = await esbuild.context(
    buildOptions("src/main.ts", "dist/assets/app.js")
  );

  const workletCtx = await esbuild.context(
    buildOptions("src/audio/worklet.ts", "dist/assets/worklet.js")
  );

  // Do an initial build (so dist/assets exist before you load the page)
  await Promise.all([appCtx.rebuild(), workletCtx.rebuild()]);
  console.log("[esbuild] initial build complete");

  // Start watch mode for incremental rebuilds
  await Promise.all([appCtx.watch(), workletCtx.watch()]);
  console.log("[esbuild] watching for changes");

  // Keep process clean on exit
  const disposeAll = async () => {
    try {
      await Promise.all([appCtx.dispose(), workletCtx.dispose()]);
    } catch {
      // ignore
    }
  };
  process.on("SIGINT", async () => {
    await disposeAll();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await disposeAll();
    process.exit(0);
  });
}

function startPublicWatcher() {
  const watcher = chokidar.watch(publicDir, { ignoreInitial: true });

  const recopy = async () => {
    try {
      await copyPublic();
      console.log("[public] copied to dist/");
    } catch (err) {
      console.error("[public] copy failed:", err);
    }
  };

  watcher.on("add", recopy);
  watcher.on("change", recopy);
  watcher.on("unlink", recopy);
  watcher.on("addDir", recopy);
  watcher.on("unlinkDir", recopy);

  return watcher;
}

function startServer() {
  const app = express();

  // Avoid caching during dev
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(express.static(distDir));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`Dev server running at http://localhost:${PORT}`);
  });
}

async function main() {
  await cleanDistOnce();
  await copyPublic();
  await startEsbuildWatch();
  startPublicWatcher();
  startServer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
