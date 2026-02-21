function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/%0A/g, "")
    .replace(/%09/g, "")
    .replace(/%20/g, " ");
  return `url("data:image/svg+xml,${encoded}")`;
}

function semiAnnulusPath(cx: number, cy: number, rOuter: number, rInner: number): string {
  return [
    `M ${cx - rOuter} ${cy}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${cx + rOuter} ${cy}`,
    `L ${cx + rInner} ${cy}`,
    `A ${rInner} ${rInner} 0 0 0 ${cx - rInner} ${cy}`,
    "Z",
  ].join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hash01(x: number, y: number, seed: number): number {
  let h = ((x | 0) * 374761393) ^ ((y | 0) * 668265263) ^ ((seed | 0) * 1442695041);
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

type SeigaihaState = {
  randomness: number;
  seed: number;
};

const seigaihaState: SeigaihaState = {
  randomness: 0.12,
  seed: 1337,
};

function generateTraditionalSeigaihaSvg(options: {
  radius: number;
  paperColor: string;
  inkColor: string;
  accentInkColor?: string;
  randomness?: number;
  seed?: number;
}): { svg: string; tileWidth: number; tileHeight: number } {
  const {
    radius: r,
    paperColor,
    inkColor,
    accentInkColor = "#7c3aed",
    randomness = 0,
    seed = 1337,
  } = options;

  // Slight horizontal overlap between neighbors.
  const stepX = r * 1.65;
  // Upper-row centers sit inside the largest band of the row below.
  const stepY = r * 0.55;
  const randomnessClamped = clamp(randomness, 0, 1);
  const rowPeriod = 20;
  const colPeriod = 12;

  const tileWidth = stepX * colPeriod;
  const tileHeight = stepY * rowPeriod;

  // Equal-width alternating rings:
  // white, blue, white, blue, white, blue, white, blue(center).
  // This keeps all white bands equal and all blue bands equal.
  const ringStep = 1 / 8;
  const whiteBands: Array<[number, number]> = [
    [1 - ringStep * 0, 1 - ringStep * 1],
    [1 - ringStep * 2, 1 - ringStep * 3],
    [1 - ringStep * 4, 1 - ringStep * 5],
    [1 - ringStep * 6, 1 - ringStep * 7],
  ];
  const blueBands: Array<[number, number]> = [
    [1 - ringStep * 1, 1 - ringStep * 2],
    [1 - ringStep * 3, 1 - ringStep * 4],
    [1 - ringStep * 5, 1 - ringStep * 6],
    [1 - ringStep * 7, 0],
  ];

  const maxRadiusShrink = 0.46 * randomnessClamped;
  const activeShrinkChance = randomnessClamped;
  const maxNeighborPull = stepX * 0.42;
  const minX = -stepX * 2;
  const minY = -stepY * 2;
  const maxX = tileWidth + stepX * 2;
  const maxY = tileHeight + stepY * 2;
  const rows = Math.ceil((maxY - minY) / stepY) + 1;
  const cycleMin = -2;
  const cycleMax = 2;

  let allRows = "";

  // Paint top->bottom so each lower row sits in front.
  for (let row = 0; row < rows; row++) {
    const cy = minY + row * stepY;
    const xOffset = (row % 2) * (stepX * 0.5);
    const periodicRow = mod(row, rowPeriod);
    const shrinkByCol = new Array<number>(colPeriod).fill(0);
    const radiusByCol = new Array<number>(colPeriod).fill(r);
    const edgeCompaction = new Array<number>(colPeriod).fill(0);
    const localStepByCol = new Array<number>(colPeriod).fill(stepX);
    const centerByCol = new Array<number>(colPeriod).fill(0);
    let rowBluePaths = "";
    let rowWhitePaths = "";
    let rowAccentPaths = "";

    // Build a periodic row pattern so background tiling seams stay clean.
    for (let col = 0; col < colPeriod; col++) {
      const activation = hash01(periodicRow, col, seed + 401);
      const shrinkShape = hash01(periodicRow, col, seed + 947);
      const isActive = activation < activeShrinkChance;
      const shrink = isActive ? maxRadiusShrink * shrinkShape : 0;
      shrinkByCol[col] = shrink;
      radiusByCol[col] = r * (1 - shrink);
    }

    for (let col = 0; col < colPeriod; col++) {
      const nextCol = (col + 1) % colPeriod;
      const pairShrink = (shrinkByCol[col] + shrinkByCol[nextCol]) * 0.5;
      edgeCompaction[col] = clamp(stepX * (0.72 * pairShrink), 0, maxNeighborPull);
      localStepByCol[col] = stepX - edgeCompaction[col];
    }

    const rawPeriodWidth = localStepByCol.reduce((sum, value) => sum + value, 0);
    const widthCorrection = (tileWidth - rawPeriodWidth) / colPeriod;
    for (let col = 0; col < colPeriod; col++) {
      localStepByCol[col] += widthCorrection;
    }

    let cursorX = 0;
    for (let col = 0; col < colPeriod; col++) {
      centerByCol[col] = cursorX;
      cursorX += localStepByCol[col];
    }

    const waves: Array<{ cx: number; radius: number; col: number }> = [];
    for (let cycle = cycleMin; cycle <= cycleMax; cycle++) {
      for (let col = 0; col < colPeriod; col++) {
        const cx = centerByCol[col] + cycle * tileWidth + xOffset;
        const waveR = radiusByCol[col];
        if (cx + waveR < minX || cx - waveR > maxX) continue;
        waves.push({ cx, radius: waveR, col });
      }
    }

    // Paint right->left so each wave overdraws the right neighbor corner.
    waves.sort((a, b) => b.cx - a.cx);
    for (const wave of waves) {
      rowBluePaths += `<path fill="${inkColor}" d="${semiAnnulusPath(wave.cx, cy, wave.radius, 0)}" />`;
      for (const [kOuter, kInner] of whiteBands) {
        rowWhitePaths += `<path d="${semiAnnulusPath(wave.cx, cy, wave.radius * kOuter, wave.radius * kInner)}" />`;
      }
      for (let bandIndex = 0; bandIndex < blueBands.length; bandIndex++) {
        const [kOuter, kInner] = blueBands[bandIndex];
        const activationThreshold =
          hash01(periodicRow, wave.col * 41 + bandIndex, seed + 1777) * 1.35;
        const fade = clamp((randomnessClamped - activationThreshold) / 0.22, 0, 1);
        if (fade <= 0) continue;
        rowAccentPaths += `<path fill="${accentInkColor}" fill-opacity="${fade.toFixed(3)}" d="${semiAnnulusPath(wave.cx, cy, wave.radius * kOuter, wave.radius * kInner)}" />`;
      }
    }

    allRows += `<g><g>${rowBluePaths}</g><g fill="${paperColor}">${rowWhitePaths}</g><g>${rowAccentPaths}</g></g>`;
  }

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${tileHeight}" viewBox="0 0 ${tileWidth} ${tileHeight}">
  <rect width="100%" height="100%" fill="${paperColor}"/>
  ${allRows}
</svg>`.trim();

  return { svg, tileWidth, tileHeight };
}

function setRootVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

export function installSeigaihaBackground(): void {
  const { svg, tileWidth, tileHeight } = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    accentInkColor: "#7c3aed",
    randomness: seigaihaState.randomness,
    seed: seigaihaState.seed,
  });

  setRootVar("--seigaiha-url", svgToDataUrl(svg));
  setRootVar("--seigaiha-size-x", `${tileWidth}px`);
  setRootVar("--seigaiha-size-y", `${tileHeight}px`);
  setRootVar("--seigaiha-pos", "0px 0px");
}

export function setSeigaihaRandomness(value: number): void {
  seigaihaState.randomness = clamp(value, 0, 1);
  installSeigaihaBackground();
}

export function getSeigaihaRandomness(): number {
  return seigaihaState.randomness;
}
