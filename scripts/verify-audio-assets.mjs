import { readdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";
const LFS_AUDIO_INCLUDE = "public/assets/audio/**";

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

function isLfsPointer(data) {
  return data.subarray(0, 64).toString("utf8").startsWith(LFS_POINTER_PREFIX);
}

function isRiffWav(data) {
  return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF";
}

async function collectAudioProblems(projectRoot, wavFiles) {
  const pointerFiles = [];
  const invalidWavFiles = [];

  for (const wavPath of wavFiles) {
    const data = await readFile(wavPath);
    const relative = path.relative(projectRoot, wavPath);

    if (isLfsPointer(data)) {
      pointerFiles.push(relative);
      continue;
    }

    // Lightweight corruption guardrail: runtime decode expects RIFF header.
    if (!isRiffWav(data)) {
      invalidWavFiles.push(relative);
    }
  }

  return { pointerFiles, invalidWavFiles };
}

async function hydrateLfsAudio(projectRoot) {
  try {
    await execFileAsync("git", ["lfs", "pull", `--include=${LFS_AUDIO_INCLUDE}`], {
      cwd: projectRoot,
    });
    return null;
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    return stderr || stdout || String(error);
  }
}

export async function verifyBundledAudioAssets(projectRoot) {
  const audioRoot = path.join(projectRoot, "public", "assets", "audio");
  const wavFiles = await listWavs(audioRoot);

  let { pointerFiles, invalidWavFiles } = await collectAudioProblems(projectRoot, wavFiles);
  let hydrationError = null;

  // CI checkouts often skip LFS by default; auto-hydrate once before failing.
  if (pointerFiles.length > 0) {
    hydrationError = await hydrateLfsAudio(projectRoot);
    ({ pointerFiles, invalidWavFiles } = await collectAudioProblems(projectRoot, wavFiles));
  }

  const problems = [
    ...pointerFiles.map((file) => `${file} is a Git LFS pointer in the working tree`),
    ...invalidWavFiles.map((file) => `${file} is not a RIFF WAV file`),
  ];

  if (problems.length > 0) {
    const details = problems.map((line) => `  - ${line}`).join("\n");
    throw new Error(
      [
        "Bundled audio verification failed.",
        details,
        hydrationError
          ? `LFS hydration attempt failed: ${hydrationError}`
          : null,
        `Fix: ensure Git LFS objects are present before build (for example: git lfs pull --include='${LFS_AUDIO_INCLUDE}').`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}
