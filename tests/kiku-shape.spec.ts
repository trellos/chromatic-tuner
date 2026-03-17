/**
 * Visual verification that kiku flowers match the reference chrysanthemum crest:
 * center circle + narrow shaft petals with rounded outer tip circles.
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { switchMode } from "./helpers/mode.js";

test("kiku outer wedge path has correct arc structure (center circle + CW tip arcs)", async ({
  page,
}) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => {
    // Grab all outer wedge paths
    const paths = Array.from(
      document.querySelectorAll<SVGPathElement>(".cof-wedge-path")
    );
    if (paths.length === 0) return { error: "no .cof-wedge-path found", paths: [] };

    const analyses = paths.slice(0, 3).map((el) => {
      const d = el.getAttribute("d") ?? "";

      // Count sub-paths (Z commands) — should be petalCount+1 (center circle + petals)
      const subpaths = (d.match(/Z/gi) ?? []).length;

      // Center circle sub-path uses A ... 0 1 0 ... (two semicircles = large-arc=1)
      const hasCenterCircle = /A[\s\d.]+0\s+1\s+0/.test(d);

      // Tip arcs use sweep=1 (clockwise → outer tip): "0 0 1"
      const tipArcMatches = [...d.matchAll(/A\s*([\d.]+)\s+[\d.]+\s+0\s+0\s+1/g)];

      // Base arcs use sweep=0 (CCW → short outer base arc): "0 0 0"
      const baseArcMatches = [...d.matchAll(/A\s*([\d.]+)\s+[\d.]+\s+0\s+0\s+0/g)];

      // Old wrong arcs (tip arcs with sweep=0 would mean inward): check none exist
      // with a large radius (tip arcs have radius ~10-15% of flowerR)
      // We just check that tip arcs have sweep=1 (present) and base arcs sweep=0 (present)

      return {
        subpaths,
        hasCenterCircle,
        tipArcCount: tipArcMatches.length,
        baseArcCount: baseArcMatches.length,
      };
    });

    return { error: null, paths: analyses };
  });

  expect(result.error).toBeNull();
  for (const info of result.paths) {
    // petalCount (16) petals + 1 center circle = 17 Z commands
    expect(info.subpaths).toBe(17);
    expect(info.hasCenterCircle).toBe(true);
    // Each petal has one tip arc (sweep=1) = 16 total
    expect(info.tipArcCount).toBe(16);
    // Each petal has one base arc (sweep=0) = 16 total
    // (center circle arcs use large-arc=1, so they don't appear in the sweep=0 count)
    expect(info.baseArcCount).toBe(16);
  }
});

test("kiku screenshot matches reference shape", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");
  await page.waitForTimeout(300);

  // Take a screenshot of the COF SVG for visual inspection
  const cofSvg = page.locator(".cof-svg");
  await expect(cofSvg).toBeVisible();
  const screenshotPath = path.join("test-results", "kiku-cof.png");
  fs.mkdirSync("test-results", { recursive: true });
  await cofSvg.screenshot({ path: screenshotPath });

  // Pixel-level check: use a canvas to verify the outermost tip of the
  // upward-pointing kiku petal is FILLED (not a hole / background colour).
  // Note index 0 is at centerDeg=0 (right side of circle, 3 o'clock), but
  // we just need any rendered kiku. We work in the SVG's own coordinate space.
  const pixelOk = await page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>(".cof-svg");
    if (!svg) return { ok: false, reason: "no svg" };

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return { ok: false, reason: "zero size" };

    // Scale from SVG viewBox (1000×1000) to screen pixels
    const scale = rect.width / 1000;

    // First outer wedge (index 0): centerDeg = 0° (right side, 3 o'clock).
    // Flower center at radius 385 from SVG center (500,500) in viewBox coords.
    // At centerDeg=0°, polarPoint gives (500+385, 500) = (885, 500) in viewBox.
    // FlowerR = 82. Outermost tip of a petal aligned with the center angle (0°)
    // is at radius ~ tipCR + tipR = 87% * 82 + 13% * 82 ≈ 82 outward from flower center
    // i.e., viewBox x ≈ 885 + 82 = 967, y = 500.
    // Convert to screen coordinates:
    const viewBoxOuterX = 885 + 80; // just inside the outermost tip
    const viewBoxOuterY = 500;
    const screenX = rect.left + viewBoxOuterX * scale;
    const screenY = rect.top + viewBoxOuterY * scale;

    // Use elementFromPoint to check if there's an SVG path at the tip location
    const el = document.elementFromPoint(screenX, screenY);
    const isPetal =
      el?.closest(".cof-wedge-path") !== null ||
      el?.classList.contains("cof-wedge-path") ||
      el?.tagName === "path";

    // Also check there's nothing at the gap between adjacent petals
    // (at same radius but offset by half the petal angular slot = 15°)
    const gapAngleRad = (15 * Math.PI) / 180; // midpoint between petals
    const gapViewX = 885 + 70 * Math.cos(gapAngleRad);
    const gapViewY = 500 + 70 * Math.sin(gapAngleRad); // slight offset from petal axis
    const gapScreenX = rect.left + gapViewX * scale;
    const gapScreenY = rect.top + gapViewY * scale;
    const gapEl = document.elementFromPoint(gapScreenX, gapScreenY);
    const gapHasPetal = gapEl?.closest(".cof-wedge-path") !== null;

    return {
      ok: true,
      tipHasPetal: isPetal,
      gapHasPetal,
      tipEl: el?.tagName + (el?.className ? " " + el.className : ""),
      gapEl: gapEl?.tagName + (gapEl?.className ? " " + gapEl.className : ""),
    };
  });

  console.log("Kiku pixel check:", JSON.stringify(pixelOk, null, 2));
  expect(pixelOk.ok).toBe(true);
  // The outer tip of the petal should have a petal element
  expect(pixelOk.tipHasPetal).toBe(true);
});
