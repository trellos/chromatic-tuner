import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";

function listWavFiles(rootDir: string): string[] {
  const results: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = readdirSync(current, { withFileTypes: true });
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

test("bundled wav assets are hydrated and decodable files", () => {
  const rootDir = path.join(process.cwd(), "public", "assets", "audio");
  const wavFiles = listWavFiles(rootDir);
  expect(wavFiles.length).toBe(32);

  for (const wavPath of wavFiles) {
    const bytes = readFileSync(wavPath);
    const relativePath = path.relative(process.cwd(), wavPath);

    const pointerPrefix = bytes.subarray(0, 96).toString("utf8");
    expect(
      pointerPrefix.startsWith(LFS_POINTER_PREFIX),
      `${relativePath} should not be a Git LFS pointer`
    ).toBeFalsy();

    const riffHeader = bytes.subarray(0, 4).toString("ascii");
    expect(riffHeader, `${relativePath} should start with RIFF header`).toBe("RIFF");
  }
});
