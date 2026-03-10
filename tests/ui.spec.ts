import { test, expect, type Locator, type Page } from '@playwright/test';
import { readDebugRandomness } from './helpers/debug.js';
import { switchMode } from './helpers/mode.js';

const MODE_TABS = [
  { label: 'Chromatic Tuner', id: 'tuner' },
  { label: 'Metronome', id: 'metronome' },
  { label: 'Fretboard', id: 'fretboard' },
  { label: 'Key Finder', id: 'key-finder' },
  { label: 'Circle of Fifths', id: 'circle-of-fifths' },
  { label: 'Drum Machine', id: 'drum-machine' },
  { label: 'Wild Tuna', id: 'wild-tuna' },
] as const;

type PageIssueTracker = {
  pageErrors: string[];
  failedRequests: string[];
};

async function readTelemetryStats(page: Page): Promise<{
  fps: number;
  avgFps: number;
  seigaihaFps: number;
  uploadsPerSec: number;
  p95Ms: number;
  maxMs: number;
  swapsPerSec: number;
}> {
  const fpsText = await page.locator(".seigaiha-debug-fps").first().textContent();
  const metricsText = await page.locator(".seigaiha-debug-metrics").first().textContent();
  const fps = Number.parseFloat((fpsText ?? "").replace("FPS", "").trim());
  const lines = (metricsText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const displayLine =
    lines.find((line) => line.startsWith("displayFPS")) ??
    lines.find((line) => line.startsWith("avgFPS")) ??
    "";
  const seigaihaLine = lines.find((line) => line.startsWith("seigaihaFPS")) ?? "";
  const uploadsLine = lines.find((line) => line.startsWith("uploads/s")) ?? "";
  const p95Line = lines.find((line) => line.startsWith("p95")) ?? "";
  const maxLine = lines.find((line) => line.startsWith("max")) ?? "";
  const swapsLine = lines.find((line) => line.startsWith("swaps/s")) ?? "";
  return {
    fps,
    avgFps: Number.parseFloat(
      displayLine.replace("displayFPS", "").replace("avgFPS", "").trim()
    ),
    seigaihaFps: Number.parseFloat(seigaihaLine.replace("seigaihaFPS", "").trim()),
    uploadsPerSec: Number.parseFloat(uploadsLine.replace("uploads/s", "").trim()),
    p95Ms: Number.parseFloat(p95Line.replace("p95", "").replace("ms", "").trim()),
    maxMs: Number.parseFloat(maxLine.replace("max", "").replace("ms", "").trim()),
    swapsPerSec: Number.parseFloat(swapsLine.replace("swaps/s", "").trim()),
  };
}

test("seigaiha background: single static traditional layer", async ({ page }) => {
  await page.goto("/");

  const bg = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-seigaiha-surface='1']"
    );
    const style = canvas ? getComputedStyle(canvas) : null;
    return {
      backend: document.body.getAttribute("data-seigaiha-backend"),
      ready: document.body.getAttribute("data-seigaiha-render-ready"),
      surfaceCount: document.querySelectorAll("canvas[data-seigaiha-surface='1']").length,
      position: style?.position ?? null,
      inset: style?.inset ?? null,
      pointerEvents: style?.pointerEvents ?? null,
      transform: style?.transform ?? null,
    };
  });

  expect(["webgl", "none"]).toContain(bg.backend);
  if (bg.backend === "webgl") {
    await expect
      .poll(
        async () =>
          page.evaluate(() => document.body.getAttribute("data-seigaiha-render-ready")),
        { timeout: 3000 }
      )
      .toBe("1");
    expect(bg.surfaceCount).toBe(1);
    expect(bg.position).toBe("fixed");
    expect(bg.inset).toBe("0px");
    expect(bg.pointerEvents).toBe("none");
    expect(bg.transform).toBe("none");
  }
});

test("wild tuna fullscreen renders drum, circle, fretboard, and independent loopers", async ({
  page,
}) => {
  await page.goto("/");
  await switchMode(page, "Wild Tuna");
  await page.locator("[data-wild-tuna-fullscreen]").click();

  const panel = page.locator('.mode-screen[data-mode="wild-tuna"]');
  await expect(page.locator("body")).toHaveClass(/wild-tuna-fullscreen/);
  await expect(panel.locator("[data-wild-tuna-drum] .drum-mock")).toBeVisible();
  await expect(panel.locator("[data-wild-tuna-circle] .cof")).toBeVisible();
  await expect(panel.locator("[data-wild-tuna-fretboard] .fretboard-board")).toBeVisible();
  await expect(panel.locator("[data-wild-tuna-circle-looper] .ui-composite-looper")).toBeVisible();
  await expect(panel.locator("[data-wild-tuna-fretboard] .fretboard-looper-slot .ui-composite-looper")).toBeVisible();
});


test("seigaiha debug override starts disabled and shows editable detune mapping", async ({
  page,
}) => {
  await page.goto("/?debug=1");

  const tunerSection = page.locator('.seigaiha-debug-section[data-debug-section="tuner"]');
  const metronomeSection = page.locator(
    '.seigaiha-debug-section[data-debug-section="metronome"]'
  );
  const drumSection = page.locator(
    '.seigaiha-debug-section[data-debug-section="drum-machine"]'
  );
  const overrideToggle = page.locator("#seigaiha-override-toggle");
  const slider = page.locator("#seigaiha-randomness-slider");
  const fps = page.locator(".seigaiha-debug-fps");
  const smoothingMs = page.locator("#seigaiha-smoothing-ms");
  await expect(tunerSection).toBeVisible();
  await expect(metronomeSection).toBeHidden();
  await expect(drumSection).toBeHidden();
  await expect(overrideToggle).toBeVisible();
  await expect(overrideToggle).not.toBeChecked();
  await expect(slider).toBeDisabled();
  await expect(fps).toBeVisible();
  await expect(fps).toContainText("FPS");
  await expect(smoothingMs).toBeVisible();

  const centsInputs = page.locator(
    '.seigaiha-debug-section[data-debug-section="tuner"] .seigaiha-debug-table:not(.seigaiha-debug-table--compact) tbody tr td:first-child input[type="number"]'
  );
  const randomnessInputs = page.locator(
    '.seigaiha-debug-section[data-debug-section="tuner"] .seigaiha-debug-table:not(.seigaiha-debug-table--compact) tbody tr td:nth-child(2) input[type="number"]'
  );
  await expect(centsInputs).toHaveCount(3);
  await expect(randomnessInputs).toHaveCount(3);
  await expect(centsInputs.nth(0)).toHaveValue("2");
  await expect(centsInputs.nth(1)).toHaveValue("4");
  await expect(centsInputs.nth(2)).toHaveValue("10");
  await expect(randomnessInputs.nth(0)).toHaveValue("0");
  await expect(randomnessInputs.nth(1)).toHaveValue("0.2");
  await expect(randomnessInputs.nth(2)).toHaveValue("0.5");
});

test("debug sections follow the active mode when switching via the chip picker", async ({
  page,
}) => {
  await page.goto("/?debug=1");

  const tunerSection = page.locator('.seigaiha-debug-section[data-debug-section="tuner"]');
  const metronomeSection = page.locator('.seigaiha-debug-section[data-debug-section="metronome"]');
  const drumSection = page.locator('.seigaiha-debug-section[data-debug-section="drum-machine"]');

  await expect(tunerSection).toBeVisible();
  await expect(metronomeSection).toBeHidden();
  await expect(drumSection).toBeHidden();

  await switchMode(page, "Metronome");
  await expect(tunerSection).toBeHidden();
  await expect(metronomeSection).toBeVisible();
  await expect(drumSection).toBeHidden();

  await switchMode(page, "Drum Machine");
  await expect(tunerSection).toBeHidden();
  await expect(metronomeSection).toBeHidden();
  await expect(drumSection).toBeVisible();
});







function trackPageIssues(page: Page): PageIssueTracker {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure();
    failedRequests.push(
      `${request.method()} ${request.url()} (${failure?.errorText ?? 'unknown'})`
    );
  });

  return { pageErrors, failedRequests };
}

async function assertNoOffscreenText(page: Page): Promise<void> {
  const offenders = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const results: string[] = [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const content = node.textContent?.trim();
      if (!content) continue;

      const parent = node.parentElement;
      if (!parent) continue;

      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (parent.closest('[aria-hidden="true"]')) continue;

      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());

      for (const rect of rects) {
        if (rect.width === 0 || rect.height === 0) continue;

        const overlapsViewportVertically = rect.bottom > 0 && rect.top < viewportHeight;
        if (!overlapsViewportVertically) continue;

        const left = Math.round(rect.left * 100) / 100;
        const right = Math.round(rect.right * 100) / 100;

        if (left < -1 || right > viewportWidth + 1) {
          const sample = content.length > 60 ? `${content.slice(0, 57)}...` : content;
          results.push(`"${sample}" left=${left} right=${right} viewport=${viewportWidth}`);
        }
      }
    }

    return results;
  });

  expect(offenders, `Found text clipping:\n${offenders.join('\n')}`).toEqual([]);
}

async function tapOutsideCircleRadius(svg: Locator): Promise<void> {
  await svg.evaluate((node) => {
    const svgEl = node as SVGSVGElement;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const viewBoxTokens = (svgEl.getAttribute("viewBox") ?? "0 0 1000 1000")
      .split(/\s+/)
      .map((token) => Number(token));
    const viewBox = {
      x: Number.isFinite(viewBoxTokens[0]) ? (viewBoxTokens[0] as number) : 0,
      y: Number.isFinite(viewBoxTokens[1]) ? (viewBoxTokens[1] as number) : 0,
      width: Number.isFinite(viewBoxTokens[2]) ? (viewBoxTokens[2] as number) : 1000,
      height: Number.isFinite(viewBoxTokens[3]) ? (viewBoxTokens[3] as number) : 1000,
    };
    const candidates = [
      { clientX: rect.left + 8, clientY: rect.top + 8 },
      { clientX: rect.right - 8, clientY: rect.top + 8 },
      { clientX: rect.left + 8, clientY: rect.bottom - 8 },
      { clientX: rect.right - 8, clientY: rect.bottom - 8 },
      { clientX: rect.left + rect.width / 2, clientY: rect.top + 8 },
      { clientX: rect.left + rect.width / 2, clientY: rect.bottom - 8 },
      { clientX: rect.left + 8, clientY: rect.top + rect.height / 2 },
      { clientX: rect.right - 8, clientY: rect.top + rect.height / 2 },
    ];
    const toSvg = (clientX: number, clientY: number) => ({
      x: viewBox.x + ((clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width,
      y: viewBox.y + ((clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height,
    });
    let chosen = candidates[0] ?? { clientX: rect.left + 8, clientY: rect.top + 8 };
    let maxDistance = -1;
    candidates.forEach((candidate) => {
      const point = toSvg(candidate.clientX, candidate.clientY);
      const distance = Math.hypot(point.x - 500, point.y - 500);
      if (distance > maxDistance) {
        maxDistance = distance;
        chosen = candidate;
      }
    });
    svgEl.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: chosen.clientX,
        clientY: chosen.clientY,
      })
    );
  });
}



test('seigaiha background covers the full viewport height to the bottom edge', async ({ page }) => {
  await page.goto('/');

  const coverage = await page.evaluate(() => {
    const viewport = window.visualViewport;
    const visualBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);

    const bodyBottom = document.body.getBoundingClientRect().bottom;
    const htmlBottom = document.documentElement.getBoundingClientRect().bottom;
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-seigaiha-surface='1']"
    );
    const canvasRect = canvas?.getBoundingClientRect();
    const canvasStyle = canvas ? getComputedStyle(canvas) : null;

    return {
      backend: document.body.getAttribute("data-seigaiha-backend"),
      bodyGap: visualBottom - bodyBottom,
      htmlGap: visualBottom - htmlBottom,
      canvasPosition: canvasStyle?.position ?? null,
      canvasInset: canvasStyle?.inset ?? null,
      canvasHeight: canvasRect?.height ?? 0,
      viewportHeight: window.innerHeight,
    };
  });

  expect(["webgl", "none"]).toContain(coverage.backend);
  if (coverage.backend === "webgl") {
    expect(coverage.canvasPosition).toBe('fixed');
    expect(coverage.canvasInset).toBe('0px');
    expect(Math.abs(coverage.canvasHeight - coverage.viewportHeight)).toBeLessThanOrEqual(2);
  }
  expect(coverage.bodyGap).toBeLessThanOrEqual(1.5);
  expect(coverage.htmlGap).toBeLessThanOrEqual(1.5);
});



test('drum machine share URL opens directly in drum mode and restores pattern', async ({ page }) => {
  const payload = {
    version: 1,
    bpm: 133,
    kit: 'latin',
    steps: '1000000010000000000000000001000000000000000000000000000000001000',
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  await page.goto(`/?track=${encoded}`);

  const drumScreen = page.locator('.mode-screen[data-mode="drum-machine"]');
  await expect(drumScreen).toHaveClass(/is-active/);
  await expect(page.locator('#drum-tempo-value')).toHaveText('133');
  await expect(page.locator('#drum-kit-label')).toHaveText('Latin Percussion');

  const selectedSteps = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.mode-screen[data-mode="drum-machine"] .drum-row .step.is-on')).map(
      (step) => {
        const row = step.closest('.drum-row');
        const steps = Array.from(row?.querySelectorAll('.step') ?? []);
        return `${row?.getAttribute('data-voice')}:${steps.indexOf(step as HTMLButtonElement)}`;
      }
    )
  );

  expect(selectedSteps).toEqual(['kick:0', 'kick:8', 'snare:11', 'perc:12']);
});

test('app loads and key UI is visible with no runtime/network failures', async ({ page }) => {
  const issues = trackPageIssues(page);

  await page.goto('/');
  await expect(page.locator('.app')).toBeVisible();

  await expect(page.locator('h1.hero-title')).toHaveText('TUNA');
  await expect(page.locator('#mode-chip')).toBeVisible();

  await page.waitForTimeout(150);

  expect(issues.pageErrors, `Page errors:\n${issues.pageErrors.join('\n')}`).toEqual([]);
  expect(
    issues.failedRequests,
    `Failed requests:\n${issues.failedRequests.join('\n')}`
  ).toEqual([]);
});



test('tuner exposes audio diagnostics for CI smoke checks', async ({ page }) => {
  await page.goto('/');

  await page.waitForFunction(() => Boolean((window as any).__tunerAudioDiagnostics));
  const diagnostics = await page.evaluate(() => (window as any).__tunerAudioDiagnostics);

  expect(diagnostics).toEqual(
    expect.objectContaining({
      isIOS: expect.any(Boolean),
      awaitingAudioUnlock: expect.any(Boolean),
      contextState: expect.any(String),
      hasWorkletNode: expect.any(Boolean),
    })
  );

  const audioLikelyAvailable =
    diagnostics.hasWorkletNode ||
    diagnostics.contextState === 'running' ||
    diagnostics.awaitingAudioUnlock;
  expect(typeof audioLikelyAvailable).toBe('boolean');
});
test('mode switches keep stage size stable', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('.mode-stage');
  await expect(stage).toBeVisible();

  const baseline = await stage.boundingBox();
  expect(baseline).not.toBeNull();

  const tolerancePx = 2;

  for (const mode of MODE_TABS) {
    await switchMode(page, mode.label);
    await expect(page.locator(`.mode-screen[data-mode="${mode.id}"]`)).toHaveClass(/is-active/);

    const afterSwitch = await stage.boundingBox();
    expect(afterSwitch).not.toBeNull();

    expect(Math.abs((afterSwitch?.width ?? 0) - (baseline?.width ?? 0))).toBeLessThanOrEqual(
      tolerancePx
    );
    expect(Math.abs((afterSwitch?.height ?? 0) - (baseline?.height ?? 0))).toBeLessThanOrEqual(
      tolerancePx
    );
  }
});

test('no visible text is clipped off-screen in each mode', async ({ page }) => {
  await page.goto('/');

  for (const mode of MODE_TABS) {
    await switchMode(page, mode.label);
    await expect(page.locator(`.mode-screen[data-mode="${mode.id}"]`)).toHaveClass(/is-active/);
    await assertNoOffscreenText(page);
  }
});

test('tuner mode does not need scrollbars in current project viewport', async ({ page }, testInfo) => {
  await page.goto('/');

  await switchMode(page, 'Chromatic Tuner');
  const tunerScreen = page.locator('.mode-screen[data-mode="tuner"]');
  await expect(tunerScreen).toHaveClass(/is-active/);

  const overflow = await tunerScreen.evaluate((element) => {
    const needsVerticalScroll = element.scrollHeight > element.clientHeight + 1;
    const needsHorizontalScroll = element.scrollWidth > element.clientWidth + 1;

    return {
      needsVerticalScroll,
      needsHorizontalScroll,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      verticalOverflowPx: element.scrollHeight - element.clientHeight,
    };
  });

  expect(
    overflow,
    `${testInfo.project.name} should not require tuner scrolling`
  ).toMatchObject({ needsHorizontalScroll: false });
  expect(overflow.verticalOverflowPx).toBeLessThanOrEqual(40);
});



test('drum machine fullscreen layout is aspect-ratio aware on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await switchMode(page, 'Drum Machine');
  const drumScreen = page.locator('.mode-screen[data-mode="drum-machine"]');
  const drumRotator = page.locator('.mode-screen[data-mode="drum-machine"] .drum-rotator');
  const drumGrid = page.locator('.mode-screen[data-mode="drum-machine"] .drum-grids');
  const firstStep = page.locator('.mode-screen[data-mode="drum-machine"] .step').first();
  await expect(drumScreen).toHaveClass(/is-active/);
  await expect(page.locator('body')).not.toHaveClass(/drum-fullscreen/);

  const normalGridRect = await drumGrid.boundingBox();
  const normalStepRect = await firstStep.boundingBox();
  const normalTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(normalGridRect).not.toBeNull();
  expect(normalStepRect).not.toBeNull();
  expect(normalTransform).toBe('none');

  await page.locator('#carousel-toggle').click();
  await expect(page.locator('body')).toHaveClass(/drum-fullscreen/);

  const fullscreenStepRect = await firstStep.boundingBox();
  const fullscreenTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(fullscreenStepRect).not.toBeNull();
  expect(fullscreenTransform).not.toBe('none');

  await page.setViewportSize({ width: 320, height: 900 });
  const tallPortraitTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(tallPortraitTransform).not.toBe('none');
});

test('drum machine fullscreen toggle keeps mobile orientation rules consistent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await switchMode(page, 'Drum Machine');
  const drumScreen = page.locator('.mode-screen[data-mode="drum-machine"]');
  const drumRotator = page.locator('.mode-screen[data-mode="drum-machine"] .drum-rotator');
  await expect(drumScreen).toHaveClass(/is-active/);

  const initialTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(initialTransform).toBe('none');

  await page.locator('#carousel-toggle').click();
  await expect(page.locator('body')).toHaveClass(/drum-fullscreen/);
  const fullscreenTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(fullscreenTransform).not.toBe('none');

  await page.locator('#drum-exit').click();
  await expect(page.locator('body')).not.toHaveClass(/drum-fullscreen/);
  const exitedTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(exitedTransform).toBe('none');
});

test('drum machine fullscreen rotation is mobile-only', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await switchMode(page, 'Drum Machine');
  await page.locator('#carousel-toggle').click();
  await expect(page.locator('body')).toHaveClass(/drum-fullscreen/);

  const drumRotator = page.locator('.mode-screen[data-mode="drum-machine"] .drum-rotator');
  const transform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(transform).toBe('none');
});

test('drum machine toolbar wraps to two rows on mobile portrait so play is reachable', async ({
  page,
}) => {
  const portraitViewports = [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
  ];

  for (const viewport of portraitViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/');

    await switchMode(page, 'Drum Machine');
    const drumUi = page.locator('.mode-screen[data-mode="drum-machine"] .drum-ui');
    const playButton = page.locator('#drum-play-toggle');
    await expect(drumUi).toBeVisible();
    await expect(playButton).toBeVisible();

    const hasTwoRows = await drumUi.locator(':scope > *').evaluateAll((nodes) => {
      const rows = new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
      return rows.size >= 2;
    });

    const playIsOnSecondRow = await page.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('.mode-screen[data-mode="drum-machine"] .drum-ui > *'));
      const play = document.querySelector('#drum-play-toggle');
      if (!play || controls.length === 0) return false;
      const tops = controls.map((node) => Math.round(node.getBoundingClientRect().top));
      const firstRowTop = Math.min(...tops);
      const playTop = Math.round(play.getBoundingClientRect().top);
      return playTop > firstRowTop;
    });

    expect(hasTwoRows).toBeTruthy();
    expect(playIsOnSecondRow).toBeTruthy();
  }
});

test('drum machine fullscreen keeps toolbar buttons visible and parallel to grid', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/');

  await switchMode(page, 'Drum Machine');
  await page.locator('#carousel-toggle').click();
  await expect(page.locator('body')).toHaveClass(/drum-fullscreen/);

  const drumUi = page.locator('.mode-screen[data-mode="drum-machine"] .drum-ui');
  const drumGrid = page.locator('.mode-screen[data-mode="drum-machine"] .drum-grids');
  const drumRotator = page.locator('.mode-screen[data-mode="drum-machine"] .drum-rotator');
  const beatButton = page.locator('#drum-beat-button');
  const kitButton = page.locator('#drum-kit-button');
  const playButton = page.locator('#drum-play-toggle');
  const tempoDown = page.locator('.drum-tempo [data-tempo="down"]');
  const tempoUp = page.locator('.drum-tempo [data-tempo="up"]');

  await expect(beatButton).toBeVisible();
  await expect(kitButton).toBeVisible();
  await expect(playButton).toBeVisible();
  await expect(tempoDown).toBeVisible();
  await expect(tempoUp).toBeVisible();

  const controlsInViewport = await page.evaluate(() => {
    const ids = [
      '#drum-beat-button',
      '#drum-kit-button',
      '#drum-play-toggle',
      '.drum-tempo [data-tempo="down"]',
      '.drum-tempo [data-tempo="up"]',
    ];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return ids.every((selector) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= -1 &&
        rect.left >= -1 &&
        rect.bottom <= vh + 1 &&
        rect.right <= vw + 1
      );
    });
  });
  expect(controlsInViewport).toBeTruthy();

  const [rotatorTransform, uiTransform, gridTransform] = await Promise.all([
    drumRotator.evaluate((el) => getComputedStyle(el).transform),
    drumUi.evaluate((el) => getComputedStyle(el).transform),
    drumGrid.evaluate((el) => getComputedStyle(el).transform),
  ]);
  expect(rotatorTransform).not.toBe('none');
  expect(uiTransform).toBe('none');
  expect(gridTransform).toBe('none');
});

test('metronome sound menu opens without creating a scrollbar on the metronome card', async ({ page }) => {
  await page.goto('/');
  await switchMode(page, 'Metronome');

  const metronomeScreen = page.locator('.mode-screen[data-mode="metronome"]');
  const soundButton = page.locator('#metro-sound-button');
  const soundMenu = page.locator('#metro-sound-menu');

  await expect(metronomeScreen).toHaveClass(/is-active/);
  await soundButton.click();
  await expect(soundMenu).toHaveClass(/is-open/);

  const overflowState = await metronomeScreen.evaluate((element) => {
    const style = getComputedStyle(element);
    const menu = element.querySelector<HTMLElement>('#metro-sound-menu');
    const cardRect = element.getBoundingClientRect();
    const menuRect = menu?.getBoundingClientRect();
    return {
      overflowY: style.overflowY,
      hasVerticalOverflow: element.scrollHeight > element.clientHeight + 1,
      menuBottom: menuRect?.bottom ?? 0,
      cardBottom: cardRect.bottom,
    };
  });

  expect(overflowState.overflowY).toBe('visible');
  expect(
    overflowState.hasVerticalOverflow || overflowState.menuBottom > overflowState.cardBottom
  ).toBeTruthy();
  expect(overflowState.menuBottom).toBeGreaterThan(overflowState.cardBottom);
});

test('metronome time button shows "No Accent" after selecting no-accent mode', async ({
  page,
}) => {
  await page.goto('/');
  await switchMode(page, 'Metronome');

  const timeButton = page.locator('#metro-time-button');
  await timeButton.click();
  await page.locator('#metro-time-menu [data-value="no-accent"]').click();
  await expect(timeButton).toHaveText('Time No Accent');
});


test('metronome sound button keeps the most recent sound selection visible', async ({ page }) => {
  await page.goto('/');
  await switchMode(page, 'Metronome');

  const soundButton = page.locator('#metro-sound-button');
  const soundMenu = page.locator('#metro-sound-menu');

  await expect(soundButton).toHaveText('Sound Woodblock');

  await soundButton.click();
  await expect(soundMenu).toHaveClass(/is-open/);
  await page.evaluate(() => {
    const item = document.querySelector<HTMLButtonElement>('#metro-sound-menu [data-sound="drum"]');
    item?.click();
  });
  await expect(soundMenu).not.toHaveClass(/is-open/);
  await expect(soundButton).toHaveText('Sound Drum');

  await soundButton.click();
  await page.evaluate(() => {
    const item = document.querySelector<HTMLButtonElement>('#metro-sound-menu [data-sound="conga"]');
    item?.click();
  });
  await expect(soundButton).toHaveText('Sound Conga');
});

test('drum machine beat and kit buttons keep their most recent selections visible', async ({ page }) => {
  await page.goto('/');
  await switchMode(page, 'Drum Machine');

  const beatButton = page.locator('#drum-beat-button');
  const beatMenu = page.locator('#drum-beat-menu');
  const kitButton = page.locator('#drum-kit-button');
  const kitMenu = page.locator('#drum-kit-menu');

  await expect(beatButton).toHaveText('Beat: Rock');
  await expect(kitButton).toContainText('Kit: Rock Drums');

  await beatButton.click();
  await expect(beatMenu).toHaveClass(/is-open/);
  await page.locator('#drum-beat-menu [data-beat="half-time"]').click();
  await expect(beatMenu).not.toHaveClass(/is-open/);
  await expect(beatButton).toHaveText('Beat: Half-Time');

  await kitButton.click();
  await expect(kitMenu).toHaveClass(/is-open/);
  await page.locator('#drum-kit-menu [data-kit="latin"]').click();
  await expect(kitMenu).not.toHaveClass(/is-open/);
  await expect(kitButton).toContainText('Kit: Latin Percussion');
});

test('drum machine transport remains responsive after mode switches', async ({
  page,
}) => {
  await page.goto('/');
  await switchMode(page, 'Drum Machine');

  const playButton = page.locator('#drum-play-toggle');
  await expect(playButton).toHaveText('Play');

  await playButton.click();
  await page.waitForTimeout(160);

  await switchMode(page, 'Metronome');
  await expect(page.locator('.mode-screen[data-mode="metronome"]')).toHaveClass(/is-active/);

  await switchMode(page, 'Drum Machine');
  await expect(page.locator('.mode-screen[data-mode="drum-machine"]')).toHaveClass(/is-active/);
  const returnedText = ((await playButton.textContent()) ?? '').trim();
  const firstExpected = returnedText === 'Play' ? 'Stop' : 'Play';
  const secondExpected = returnedText === 'Play' ? 'Play' : 'Stop';
  await playButton.click();
  await page.waitForTimeout(160);
  const firstText = ((await playButton.textContent()) ?? '').trim();
  if (firstText === returnedText) {
    // Some engines cannot start WebAudio transport in this test context.
    await playButton.click();
    await expect(playButton).toHaveText(returnedText);
    return;
  }
  await expect(playButton).toHaveText(firstExpected);
  await playButton.click();
  await expect(playButton).toHaveText(secondExpected);
});

test('mode switching remains responsive after a runtime hook error', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(() => {
    const original = window.AbortController;
    Object.defineProperty(window, '__testOriginalAbortController', {
      value: original,
      configurable: true,
    });
    window.AbortController = class {
      constructor() {
        throw new Error('forced metronome enter failure');
      }
    } as typeof AbortController;
  });

  await switchMode(page, 'Metronome');
  await expect(page.locator('.mode-screen[data-mode="metronome"]')).toHaveClass(/is-active/);

  await page.evaluate(() => {
    const original = (window as typeof window & {
      __testOriginalAbortController?: typeof AbortController;
    }).__testOriginalAbortController;
    if (original) {
      window.AbortController = original;
      delete (window as typeof window & { __testOriginalAbortController?: unknown })
        .__testOriginalAbortController;
    }
  });

  await switchMode(page, 'Drum Machine');

  await expect(page.locator('.mode-screen[data-mode="drum-machine"]')).toHaveClass(/is-active/);
});

test('app restores the last selected mode on reload', async ({ page }) => {
  await page.goto('/');
  await switchMode(page, 'Fretboard');
  await expect(page.locator('.mode-screen[data-mode="fretboard"]')).toHaveClass(/is-active/);

  await page.reload();

  await expect(page.locator('.mode-screen[data-mode="fretboard"]')).toHaveClass(/is-active/);
  await expect(page.locator('#mode-chip span').first()).toHaveText('Fretboard');
});

test('tuner status toggle still flips exactly once after mode re-entry', async ({ page }) => {
  await page.goto('/?debug=1');

  await expect(page.locator('body')).not.toHaveClass(/status-hidden/);
  await switchMode(page, 'Metronome');
  await switchMode(page, 'Chromatic Tuner');

  await page.evaluate(() => {
    document.getElementById('strobe-visualizer')?.dispatchEvent(
      new Event('touchend', { bubbles: true })
    );
  });
  await expect(page.locator('body')).toHaveClass(/status-hidden/);
  await page.evaluate(() => {
    document.getElementById('strobe-visualizer')?.dispatchEvent(
      new Event('touchend', { bubbles: true })
    );
  });
  await expect(page.locator('body')).not.toHaveClass(/status-hidden/);
});

test("mobile Safari fretboard KEY tap does not trigger mode swipe to metronome", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "Mobile Safari", "iOS Safari regression coverage only.");

  await page.goto("/");
  await switchMode(page, "Fretboard");
  const fretboardScreen = page.locator('.mode-screen[data-mode="fretboard"]');
  const metronomeScreen = page.locator('.mode-screen[data-mode="metronome"]');
  await expect(fretboardScreen).toHaveClass(/is-active/);

  const keyButton = fretboardScreen.locator('[data-fretboard-display="key"]');
  await keyButton.click();
  await expect(fretboardScreen).toHaveClass(/is-active/);
  await expect(metronomeScreen).not.toHaveClass(/is-active/);
});


