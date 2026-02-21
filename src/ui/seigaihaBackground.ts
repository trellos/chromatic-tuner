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

function generateTraditionalSeigaihaSvg(options: {
  radius: number;
  paperColor: string;
  inkColor: string;
}): { svg: string; tileWidth: number; tileHeight: number } {
  const { radius: r, paperColor, inkColor } = options;

  // Slight horizontal overlap between neighbors.
  const stepX = r * 1.65;
  // Upper-row centers sit inside the largest band of the row below.
  const stepY = r * 0.55;

  const tileWidth = stepX * 12;
  const tileHeight = stepY * 20;

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

  const minX = -stepX * 2;
  const minY = -stepY * 2;
  const maxX = tileWidth + stepX * 2;
  const maxY = tileHeight + stepY * 2;
  const cols = Math.ceil((maxX - minX) / stepX) + 1;
  const rows = Math.ceil((maxY - minY) / stepY) + 1;

  let allRows = "";

  // Paint top->bottom so each lower row sits in front.
  for (let row = 0; row < rows; row++) {
    const cy = minY + row * stepY;
    const xOffset = (row % 2) * (stepX * 0.5);
    let rowBluePaths = "";
    let rowWhitePaths = "";

    // Paint right->left so each wave overdraws the right neighbor corner.
    for (let col = cols - 1; col >= 0; col--) {
      const cx = minX + col * stepX + xOffset;
      rowBluePaths += `<path d="${semiAnnulusPath(cx, cy, r, 0)}" />`;
      for (const [kOuter, kInner] of whiteBands) {
        rowWhitePaths += `<path d="${semiAnnulusPath(cx, cy, r * kOuter, r * kInner)}" />`;
      }
    }

    allRows += `<g><g fill="${inkColor}">${rowBluePaths}</g><g fill="${paperColor}">${rowWhitePaths}</g></g>`;
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
  });

  setRootVar("--seigaiha-url", svgToDataUrl(svg));
  setRootVar("--seigaiha-size-x", `${tileWidth}px`);
  setRootVar("--seigaiha-size-y", `${tileHeight}px`);
  setRootVar("--seigaiha-pos", "0px 0px");
}
