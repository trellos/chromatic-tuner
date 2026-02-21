import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";

async function listWavs(rootDir) {
  const found = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".wav")) {
        found.push(fullPath);
      }
    }
  }
  return found.sort();
}

export async function verifyBundledAudioAssets(projectRoot) {
  const audioRoot = path.join(projectRoot, "public", "assets", "audio");
  const wavFiles = await listWavs(audioRoot);
  const problems = [];

  for (const wavPath of wavFiles) {
    const data = await readFile(wavPath);
    const header = data.subarray(0, 64).toString("utf8");
    if (header.startsWith(LFS_POINTER_PREFIX)) {
      problems.push(
        `${path.relative(projectRoot, wavPath)} is a Git LFS pointer in the working tree`
      );
      continue;
    }

    // We only need a lightweight guardrail for build-time correctness.
    // If this file is not a WAV header, runtime decode will fail and fall back.
    if (data.length < 12 || data.subarray(0, 4).toString("ascii") !== "RIFF") {
      problems.push(`${path.relative(projectRoot, wavPath)} is not a RIFF WAV file`);
    }
  }

  if (problems.length > 0) {
    const details = problems.map((line) => `  - ${line}`).join("\n");
    throw new Error(
      [
        "Bundled audio verification failed.",
        details,
        "Fix: ensure Git LFS objects are present before build (for example: git lfs pull --include='public/assets/audio/**').",
      ].join("\n")
    );
  }
}
