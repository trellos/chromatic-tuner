const TILE_SIZE = 384;
const DEBUG = false;

const q = (value: number): number => Math.round(value * 2) / 2;

let initialized = false;

function buildSeigaihaDataUrl(radius: number): string {
  const dx = radius * 2;
  const dy = radius;
  const columns = Math.ceil(TILE_SIZE / dx) + 4;
  const rows = Math.ceil(TILE_SIZE / dy) + 4;
  const ringCount = 4;
  const strokeWidth = 2;
  const strokeColor = "rgba(222, 231, 242, 0.18)";

  const paths: string[] = [];

  for (let row = -2; row < rows; row += 1) {
    const xOffset = (row & 1) * radius;
    for (let col = -2; col < columns; col += 1) {
      const cx = col * dx + xOffset;
      const cy = row * dy;

      for (let ring = 1; ring <= ringCount; ring += 1) {
        const currentRadius = (radius / ringCount) * ring;
        const left = cx - currentRadius;
        const right = cx + currentRadius;
        paths.push(
          `<path d=\"M ${left} ${cy} A ${currentRadius} ${currentRadius} 0 0 0 ${right} ${cy}\" />`
        );
      }
    }
  }

  const svg = [
    `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ${TILE_SIZE} ${TILE_SIZE}\" width=\"${TILE_SIZE}\" height=\"${TILE_SIZE}\">`,
    `<g fill=\"none\" stroke=\"${strokeColor}\" stroke-width=\"${strokeWidth}\" vector-effect=\"non-scaling-stroke\">`,
    paths.join(""),
    "</g>",
    "</svg>",
  ].join("");

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function initializeSeigaihaBackground(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  const rootStyle = document.documentElement.style;

  const smallImage = `url(\"${buildSeigaihaDataUrl(32)}\")`;
  const mediumImage = `url(\"${buildSeigaihaDataUrl(48)}\")`;
  const largeImage = `url(\"${buildSeigaihaDataUrl(64)}\")`;

  rootStyle.setProperty("--seigaiha-small-image", smallImage);
  rootStyle.setProperty("--seigaiha-medium-image", mediumImage);
  rootStyle.setProperty("--seigaiha-large-image", largeImage);

  rootStyle.setProperty("--seigaiha-small-size", "384px 384px");
  rootStyle.setProperty("--seigaiha-medium-size", "384px 384px");
  rootStyle.setProperty("--seigaiha-large-size", "384px 384px");

  const setPositions = (
    waveLPos: string,
    waveMPos: string,
    waveSPos: string,
    cardWaveLPos: string,
    cardWaveMPos: string
  ): void => {
    rootStyle.setProperty("--waveL-pos", waveLPos);
    rootStyle.setProperty("--waveM-pos", waveMPos);
    rootStyle.setProperty("--waveS-pos", waveSPos);
    rootStyle.setProperty("--cardWaveL-pos", cardWaveLPos);
    rootStyle.setProperty("--cardWaveM-pos", cardWaveMPos);
  };

  let debugTicks = 0;
  let lastDebugAt = -1;

  const update = (timeMs: number): void => {
    const time = timeMs / 1000;

    const largeX = q(Math.sin(time * 0.17) * 16);
    const largeY = q(Math.cos(time * 0.13) * 12);

    const mediumX = q(Math.sin(time * 0.31 + 0.7) * 26);
    const mediumY = q(Math.cos(time * 0.27 + 0.35) * 20);

    const smallX = q(Math.sin(time * 0.48 + 1.2) * 38);
    const smallY = q(Math.cos(time * 0.41 + 0.9) * 30);

    const waveLPos = `${largeX}px ${largeY}px`;
    const waveMPos = `${mediumX}px ${mediumY}px`;
    const waveSPos = `${smallX}px ${smallY}px`;
    const cardWaveLPos = `${q(largeX * 0.6)}px ${q(largeY * 0.6)}px`;
    const cardWaveMPos = `${q(mediumX * 0.6)}px ${q(mediumY * 0.6)}px`;

    setPositions(waveLPos, waveMPos, waveSPos, cardWaveLPos, cardWaveMPos);

    if (DEBUG && debugTicks < 5) {
      const second = Math.floor(time);
      if (second !== lastDebugAt) {
        lastDebugAt = second;
        debugTicks += 1;
        console.debug("seigaiha", { waveLPos, waveMPos, waveSPos });
      }
    }

    requestAnimationFrame(update);
  };

  setPositions("0px 0px", "0px 0px", "0px 0px", "0px 0px", "0px 0px");
  requestAnimationFrame(update);
}
