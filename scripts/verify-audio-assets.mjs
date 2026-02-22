import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";

async function listWavFiles(rootDir) {
  const results = [];
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
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}

function isLfsPointer(data) {
  return data.subarray(0, 96).toString("utf8").startsWith(LFS_POINTER_PREFIX);
}

function isRiffWav(data) {
  return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF";
}

export async function verifyBundledAudioAssets(projectRoot) {
  const audioRoot = path.join(projectRoot, "public", "assets", "audio");
  const wavFiles = await listWavFiles(audioRoot);
  const issues = [];

  for (const file of wavFiles) {
    const data = await readFile(file);
    const relativePath = path.relative(projectRoot, file);
    if (isLfsPointer(data)) {
      issues.push(`${relativePath} is a Git LFS pointer`);
      continue;
    }
    if (!isRiffWav(data)) {
      issues.push(`${relativePath} is not a RIFF WAV file`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      [
        "Bundled audio verification failed:",
        ...issues.map((line) => `  - ${line}`),
        "Fix: ensure Git LFS objects are checked out before building (e.g. checkout with lfs: true).",
      ].join("\n")
    );
  }
}
