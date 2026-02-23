import { DRUM_MACHINE_SAMPLE_URLS } from "../audio/embedded-samples.js";
import { WOODBLOCK_SAMPLE_URLS } from "../audio/woodblock-samples.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getDrumSoundingBeatIndicesFromFlags(
  beatHasSoundByBeat: boolean[]
): number[] {
  return beatHasSoundByBeat.reduce<number[]>((indices, hasSound, beatIndex) => {
    if (hasSound) indices.push(beatIndex);
    return indices;
  }, []);
}

export function getDrumRandomnessForBeat(options: {
  beatIndex: number;
  soundingBeatIndices: number[];
  target: number;
}): number | null {
  const { beatIndex, soundingBeatIndices, target } = options;
  const soundingRank = soundingBeatIndices.indexOf(beatIndex);
  if (soundingRank < 0) return null;
  if (soundingRank === 0 || soundingBeatIndices.length <= 1) return 0;
  const progress = clamp(soundingRank / (soundingBeatIndices.length - 1), 0, 1);
  return clamp(target, 0, 1) * progress;
}

export type DrumMachineUiOptions = {
  onTransportStart?: () => void;
  onTransportStop?: () => void;
  onBeatBoundary?: (event: {
    beatIndex: number;
    beatHasSound: boolean;
    soundingBeatIndices: number[];
    beatsPerBar: number;
  }) => void;
};

export type DrumMachineUi = {
  enter: () => Promise<void>;
  exit: () => void;
  getShareUrl: () => string;
  destroy: () => void;
};

// Reusable Drum Machine UI object: pattern editing, transport scheduling,
// kit loading, and lifecycle-managed listener wiring for a host element.
export function createDrumMachineUi(
  rootEl: HTMLElement,
  options: DrumMachineUiOptions = {}
): DrumMachineUi {
  // Lifecycle overview:
  // 1) `enterMode` syncs UI state, wires listeners, and seeds the initial pattern.
  // 2) UI interactions mutate pattern/tempo/kit and can start/stop transport.
  // 3) `startTransport` owns scheduler startup; `scheduleSteps` drives playback.
  // 4) `exitMode` stops transport and tears down observers/listeners.
  const drumMockEl = rootEl.querySelector<HTMLElement>(".drum-mock");
  const drumGridsEl = drumMockEl?.querySelector<HTMLElement>(".drum-grids") ?? null;
  const playheadEl = drumMockEl?.querySelector<HTMLElement>(".drum-playhead") ?? null;
  const playButton = rootEl.querySelector<HTMLButtonElement>("#drum-play-toggle");
  const beatButton = rootEl.querySelector<HTMLButtonElement>("#drum-beat-button");
  const beatMenu = rootEl.querySelector<HTMLElement>("#drum-beat-menu");
  const kitButton = rootEl.querySelector<HTMLButtonElement>("#drum-kit-button");
  const kitMenu = rootEl.querySelector<HTMLElement>("#drum-kit-menu");
  const kitLabel = rootEl.querySelector<HTMLElement>("#drum-kit-label");
  const tempoValueEl = rootEl.querySelector<HTMLElement>("#drum-tempo-value");
  const tempoButtons =
    drumMockEl?.querySelectorAll<HTMLButtonElement>("[data-tempo]") ?? [];

  const BPM_MIN = 60;
  const BPM_MAX = 180;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.1;
  type KitId = "rock" | "electro" | "house" | "lofi" | "latin" | "woodblock";
  type VoiceId = "kick" | "snare" | "hat" | "perc";

  type DrumKit = {
    name: string;
    urls: Record<VoiceId, string>;
  };

  // Local, bundled kit samples (generated in-repo) so playback works offline too.
  // If decode fails for any reason, synth fallback in playVoice() still works.
  const DRUM_KITS: Record<KitId, DrumKit> = {
    rock: {
      name: "Rock Drums",
      urls: {
        kick: DRUM_MACHINE_SAMPLE_URLS.rock.kick,
        snare: DRUM_MACHINE_SAMPLE_URLS.rock.snare,
        hat: DRUM_MACHINE_SAMPLE_URLS.rock.hat,
        perc: DRUM_MACHINE_SAMPLE_URLS.rock.perc,
      },
    },
    electro: {
      name: "Electro Drum Machine",
      urls: {
        kick: DRUM_MACHINE_SAMPLE_URLS.electro.kick,
        snare: DRUM_MACHINE_SAMPLE_URLS.electro.snare,
        hat: DRUM_MACHINE_SAMPLE_URLS.electro.hat,
        perc: DRUM_MACHINE_SAMPLE_URLS.electro.perc,
      },
    },
    house: {
      name: "House Drums",
      urls: {
        kick: DRUM_MACHINE_SAMPLE_URLS.house.kick,
        snare: DRUM_MACHINE_SAMPLE_URLS.house.snare,
        hat: DRUM_MACHINE_SAMPLE_URLS.house.hat,
        perc: DRUM_MACHINE_SAMPLE_URLS.house.perc,
      },
    },
    lofi: {
      name: "Lo-Fi Pocket",
      urls: {
        kick: DRUM_MACHINE_SAMPLE_URLS.lofi.kick,
        snare: DRUM_MACHINE_SAMPLE_URLS.lofi.snare,
        hat: DRUM_MACHINE_SAMPLE_URLS.lofi.hat,
        perc: DRUM_MACHINE_SAMPLE_URLS.lofi.perc,
      },
    },
    latin: {
      name: "Latin Percussion",
      urls: {
        kick: DRUM_MACHINE_SAMPLE_URLS.latin.kick,
        snare: DRUM_MACHINE_SAMPLE_URLS.latin.snare,
        hat: DRUM_MACHINE_SAMPLE_URLS.latin.hat,
        perc: DRUM_MACHINE_SAMPLE_URLS.latin.perc,
      },
    },
    woodblock: {
      name: "Woodblock Ensemble",
      urls: {
        kick: WOODBLOCK_SAMPLE_URLS.drumMachine.kick,
        snare: WOODBLOCK_SAMPLE_URLS.drumMachine.snare,
        hat: WOODBLOCK_SAMPLE_URLS.drumMachine.hat,
        perc: WOODBLOCK_SAMPLE_URLS.drumMachine.perc,
      },
    },
  };

  let signature = "4/4";
  let bpm = 120;
  let currentBeat = "rock";
  let isPlaying = false;
  let currentKit: KitId = "rock";
  let audioContext: AudioContext | null = null;
  let buffers: Record<VoiceId, AudioBuffer | null> = {
    kick: null,
    snare: null,
    hat: null,
    perc: null,
  };
  const kitBufferCache: Partial<Record<KitId, Record<VoiceId, AudioBuffer | null>>> = {};
  let kitLoadPromise: Promise<void> | null = null;
  let schedulerId: number | null = null;
  let nextStepTime = 0;
  let currentStep = 0;
  let lastStepIndex: number | null = null;
  let uiAbort: AbortController | null = null;
  let playheadTimeouts: number[] = [];
  let resizeObserver: ResizeObserver | null = null;
  let bodyClassObserver: MutationObserver | null = null;
  let detachVisualViewportListeners: (() => void) | null = null;
  let hasSeedPattern = false;

  type SharedTrackPayload = {
    version: number;
    bpm: number;
    kit: KitId;
    steps: string;
  };

  // Shared URL format: ?mode=drum-machine&track=<base64url(JSON)>
  // JSON payload (v1): { version: 1, bpm: number, kit: KitId, steps: string }
  // `steps` is a 64-char row-major bitstring for the 4x16 grid; parser also accepts legacy `v`.
  const TRACK_PARAM_KEY = "track";
  const TRACK_FORMAT_VERSION = 1;

  const toBase64Url = (value: string) =>
    btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  const fromBase64Url = (value: string) => {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return atob(padded);
  };

  const isKitId = (value: string): value is KitId => value in DRUM_KITS;
  const setKitLabel = () => {
    if (kitLabel) {
      kitLabel.textContent = DRUM_KITS[currentKit].name;
    }
  };

  const formatBeatLabel = (beat: string) =>
    beat
      .split("-")
      .map((segment) =>
        segment
          ? segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
          : ""
      )
      .join("-");

  const setBeatLabel = () => {
    if (!beatButton) return;
    beatButton.textContent = `Beat: ${formatBeatLabel(currentBeat)}`;
  };

  const loadKit = async (kitId: KitId) => {
    if (!audioContext) return;
    if (kitBufferCache[kitId]) return;
    const kit = DRUM_KITS[kitId];

    const loadSample = async (url: string) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.arrayBuffer();
        return await audioContext!.decodeAudioData(data);
      } catch {
        return null;
      }
    };

    const [kick, snare, hat, perc] = await Promise.all([
      loadSample(kit.urls.kick),
      loadSample(kit.urls.snare),
      loadSample(kit.urls.hat),
      loadSample(kit.urls.perc),
    ]);

    kitBufferCache[kitId] = { kick, snare, hat, perc: perc ?? snare ?? hat };
  };

  const applyKitBuffers = (kitId: KitId) => {
    const cached = kitBufferCache[kitId];
    buffers = cached ?? {
      kick: null,
      snare: null,
      hat: null,
      perc: null,
    };
  };

  const ensureAllKitsLoaded = async () => {
    if (!audioContext) return;
    if (kitLoadPromise) {
      await kitLoadPromise;
      return;
    }
    const kitIds = Object.keys(DRUM_KITS) as KitId[];
    kitLoadPromise = Promise.all(kitIds.map((kitId) => loadKit(kitId))).then(
      () => undefined
    );
    try {
      await kitLoadPromise;
    } finally {
      kitLoadPromise = null;
    }
    applyKitBuffers(currentKit);
  };

  const setKit = (kitId: KitId) => {
    currentKit = kitId;
    setKitLabel();
    if (kitBufferCache[kitId]) {
      applyKitBuffers(kitId);
      return;
    }
    if (audioContext) {
      void loadKit(kitId).then(() => {
        if (currentKit === kitId) {
          applyKitBuffers(kitId);
        }
      });
    }
  };

  const getStepsPerBar = () => 16;

  const getBeatsPerBar = () => 4;

  const syncLayout = () => {
    if (!drumMockEl || !drumGridsEl) return;
    const activeGrid = drumMockEl.querySelector<HTMLElement>(
      `.drum-grid[data-signature="${signature}"]`
    );
    const stepsEl = activeGrid?.querySelector<HTMLElement>(".drum-steps");
    if (!stepsEl) return;
    const gridsRect = drumGridsEl.getBoundingClientRect();
    const stepsRect = stepsEl.getBoundingClientRect();
    const stepsPerBar = getStepsPerBar();
    const stepWidth = stepsRect.width / stepsPerBar;
    const leftOffset = Math.max(0, stepsRect.left - gridsRect.left);
    drumMockEl.style.setProperty(
      "--drum-grid-width",
      `${drumGridsEl.offsetWidth}px`
    );
    drumGridsEl.style.setProperty("--playhead-left", `${leftOffset}px`);
    drumGridsEl.style.setProperty("--playhead-width", `${stepWidth}px`);
  };

  const scheduleLayoutSync = () => {
    window.requestAnimationFrame(syncLayout);
  };

  const syncResponsiveLayout = () => {
    scheduleLayoutSync();
  };

  const setSignature = (value: string) => {
    signature = value;
    if (drumMockEl) {
      drumMockEl.dataset.signature = value;
    }
    if (drumGridsEl) {
      drumGridsEl.style.setProperty("--playhead-count", "16");
      drumGridsEl.style.setProperty("--playhead-index", "0");
    }
    drumMockEl?.querySelectorAll(".step.is-current").forEach((step) => {
      step.classList.remove("is-current");
    });
    playheadEl?.classList.remove("is-active");
    lastStepIndex = null;
    currentStep = 0;
    if (audioContext) {
      nextStepTime = audioContext.currentTime + 0.05;
    }
    scheduleLayoutSync();
  };

  const clearRow = (row: HTMLElement) => {
    row.querySelectorAll<HTMLButtonElement>(".step").forEach((step) => {
      step.classList.remove("is-on");
    });
  };

  const setStep = (row: HTMLElement, index: number, on: boolean) => {
    const steps = row.querySelectorAll<HTMLButtonElement>(".step");
    const step = steps[index];
    if (!step) return;
    step.classList.toggle("is-on", on);
  };

  const beatContainsAnySound = (
    grid: HTMLElement | null,
    beatStartStep: number,
    stepsPerBeat: number
  ) => {
    if (!grid) return false;
    const rows = grid.querySelectorAll<HTMLElement>(".drum-row");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const steps = row.querySelectorAll<HTMLButtonElement>(".step");
      for (let offset = 0; offset < stepsPerBeat; offset++) {
        if (steps[beatStartStep + offset]?.classList.contains("is-on")) {
          return true;
        }
      }
    }
    return false;
  };

  const getSoundingBeatIndices = (
    grid: HTMLElement | null,
    beatsPerBar: number,
    stepsPerBeat: number
  ): number[] => {
    if (!grid) return [];
    const beatHasSoundByBeat = new Array<boolean>(beatsPerBar).fill(false);
    // Build an ordered list of beats that contain any event so progression
    // is based on musical activity, not fixed beat index.
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const beatStartStep = beat * stepsPerBeat;
      beatHasSoundByBeat[beat] = beatContainsAnySound(
        grid,
        beatStartStep,
        stepsPerBeat
      );
    }
    return getDrumSoundingBeatIndicesFromFlags(beatHasSoundByBeat);
  };

  const applyBeat = (beat: string) => {
    currentBeat = beat;
    setBeatLabel();
    setSignature("4/4");
    const grid = drumMockEl?.querySelector<HTMLElement>(
      '.drum-grid[data-signature="4/4"]'
    );
    if (!grid) return;

    const rows = grid.querySelectorAll<HTMLElement>(".drum-row");
    rows.forEach(clearRow);

    const kick = rows[0];
    const snare = rows[1];
    const hat = rows[2];
    const perc = rows[3];

    const applyPattern = (row: HTMLElement | undefined, indices: number[]) => {
      if (!row) return;
      indices.forEach((index) => setStep(row, index, true));
    };

    switch (beat) {
      case "rock":
        applyPattern(kick, [0, 6, 8, 10]);
        applyPattern(snare, [4, 12]);
        applyPattern(hat, [0, 2, 4, 6, 8, 10, 12, 14]);
        applyPattern(perc, [11]);
        break;
      case "shuffle":
        applyPattern(kick, [0, 6, 12]);
        applyPattern(snare, [4, 12]);
        applyPattern(hat, [0, 3, 4, 7, 8, 11, 12, 15]);
        applyPattern(perc, [10]);
        break;
      case "disco":
        applyPattern(kick, [0, 4, 8, 12]);
        applyPattern(snare, [4, 12]);
        applyPattern(hat, [0, 2, 4, 6, 8, 10, 12, 14]);
        applyPattern(perc, [2, 6, 10, 14]);
        break;
      case "half-time":
        applyPattern(kick, [0, 7, 10]);
        applyPattern(snare, [8]);
        applyPattern(hat, [0, 2, 4, 6, 8, 10, 12, 14]);
        applyPattern(perc, [3, 11]);
        break;
      case "breakbeat":
        applyPattern(kick, [0, 6, 7, 10, 12]);
        applyPattern(snare, [4, 12, 14]);
        applyPattern(hat, [0, 2, 3, 6, 8, 10, 11, 14]);
        applyPattern(perc, [2, 10]);
        break;
      case "afrobeat":
        applyPattern(kick, [0, 5, 8, 11, 15]);
        applyPattern(snare, [4, 10, 12]);
        applyPattern(hat, [0, 2, 4, 6, 8, 10, 12, 14]);
        applyPattern(perc, [3, 7, 11, 15]);
        break;
      case "minimal":
        applyPattern(kick, [0, 8]);
        applyPattern(snare, [12]);
        applyPattern(hat, [2, 6, 10, 14]);
        break;
      default:
        applyPattern(kick, [0, 6, 8, 10]);
        applyPattern(snare, [4, 12]);
        applyPattern(hat, [0, 2, 4, 6, 8, 10, 12, 14]);
        break;
    }
  };


  const getActiveGrid = () =>
    drumMockEl?.querySelector<HTMLElement>(`.drum-grid[data-signature="${signature}"]`) ?? null;

  const getTrackStepBits = (grid: HTMLElement | null): string => {
    if (!grid) return "";
    const rows = Array.from(grid.querySelectorAll<HTMLElement>(".drum-row"));
    return rows
      .map((row) =>
        Array.from(row.querySelectorAll<HTMLButtonElement>(".step"))
          .map((step) => (step.classList.contains("is-on") ? "1" : "0"))
          .join("")
      )
      .join("");
  };

  const applyTrackStepBits = (grid: HTMLElement | null, bits: string) => {
    if (!grid) return false;
    const rows = Array.from(grid.querySelectorAll<HTMLElement>(".drum-row"));
    const expectedLength = rows.length * getStepsPerBar();
    if (bits.length !== expectedLength || /[^01]/.test(bits)) return false;
    rows.forEach((row, rowIndex) => {
      const rowBits = bits.slice(
        rowIndex * getStepsPerBar(),
        (rowIndex + 1) * getStepsPerBar()
      );
      clearRow(row);
      Array.from(row.querySelectorAll<HTMLButtonElement>(".step")).forEach(
        (step, stepIndex) => {
          step.classList.toggle("is-on", rowBits[stepIndex] === "1");
        }
      );
    });
    return true;
  };

  const getShareUrl = () => {
    const activeGrid = getActiveGrid();
    const payload: SharedTrackPayload = {
      version: TRACK_FORMAT_VERSION,
      bpm,
      kit: currentKit,
      steps: getTrackStepBits(activeGrid),
    };
    const encoded = toBase64Url(JSON.stringify(payload));
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "drum-machine");
    url.searchParams.set(TRACK_PARAM_KEY, encoded);
    return url.toString();
  };

  const hydrateTrackFromUrl = async () => {
    const params = new URLSearchParams(window.location.search);
    const encodedTrack = params.get(TRACK_PARAM_KEY);
    if (!encodedTrack) return false;
    try {
      const raw = fromBase64Url(encodedTrack);
      const parsed = JSON.parse(raw) as Partial<SharedTrackPayload> & { v?: number };
      const parsedVersion =
        typeof parsed.version === "number"
          ? parsed.version
          : typeof parsed.v === "number"
            ? parsed.v
            : null;
      if (parsedVersion !== TRACK_FORMAT_VERSION || typeof parsed.steps !== "string") return false;
      if (typeof parsed.bpm === "number") setBpm(parsed.bpm);
      if (typeof parsed.kit === "string" && isKitId(parsed.kit)) {
        await setKit(parsed.kit);
      }
      return applyTrackStepBits(getActiveGrid(), parsed.steps);
    } catch {
      return false;
    }
  };

  const applyStandardRock = () => {
    setSignature("4/4");
    const grid = drumMockEl?.querySelector<HTMLElement>(
      '.drum-grid[data-signature="4/4"]'
    );
    if (!grid) return;
    const rows = grid.querySelectorAll<HTMLElement>(".drum-row");
    rows.forEach(clearRow);
    const kick = rows[0];
    const snare = rows[1];
    const hat = rows[2];
    if (kick) {
      setStep(kick, 0, true);
      setStep(kick, 8, true);
    }
    if (snare) {
      setStep(snare, 4, true);
      setStep(snare, 12, true);
    }
    if (hat) {
      for (let i = 0; i < 16; i += 2) {
        setStep(hat, i, true);
      }
    }
  };

  const setBpm = (value: number) => {
    bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(value)));
    if (tempoValueEl) tempoValueEl.textContent = String(bpm);
  };

  const ensureAudio = async () => {
    if (audioContext) {
      await audioContext.resume();
    } else {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      audioContext = new AudioCtx({ latencyHint: "interactive" });
      await audioContext.resume();
    }

    await loadKit(currentKit);
    applyKitBuffers(currentKit);
    void ensureAllKitsLoaded();
  };

  const playBuffer = (
    buffer: AudioBuffer | null,
    time: number,
    gainValue: number
  ) => {
    if (!audioContext || !buffer) return;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gain = audioContext.createGain();
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start(time);
  };

  const playVoice = (voice: VoiceId, time: number) => {
    if (buffers[voice]) {
      const gainValue =
        voice === "kick" ? 1.0 : voice === "snare" ? 0.85 : 0.5;
      playBuffer(buffers[voice], time, gainValue);
      return;
    }

    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = currentKit === "electro" || currentKit === "house" ? "square" : "triangle";
    if (voice === "kick") osc.frequency.value = currentKit === "electro" ? 90 : currentKit === "rock" ? 78 : 120;
    if (voice === "snare") osc.frequency.value = currentKit === "lofi" ? 190 : currentKit === "rock" ? 210 : 240;
    if (voice === "hat") osc.frequency.value = currentKit === "house" ? 780 : currentKit === "rock" ? 620 : 520;
    if (voice === "perc") osc.frequency.value = currentKit === "latin" ? 400 : currentKit === "rock" ? 280 : 320;
    gain.gain.value = currentKit === "rock" ? 0.22 : 0.18;
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  };

  const scheduleSteps = () => {
    if (!audioContext) return;
    const stepsPerBar = getStepsPerBar();
    const beatsPerBar = Math.max(1, getBeatsPerBar());
    const stepsPerBeat = Math.max(1, Math.floor(stepsPerBar / beatsPerBar));
    const stepDuration = (60 / bpm) / stepsPerBeat;
    if (drumGridsEl) {
      drumGridsEl.style.setProperty(
        "--playhead-ms",
        `${Math.max(40, stepDuration * 1000)}ms`
      );
    }
    while (nextStepTime < audioContext.currentTime + SCHEDULE_AHEAD) {
      const activeGrid =
        drumMockEl?.querySelector<HTMLElement>(
          `.drum-grid[data-signature="${signature}"]`
        ) ?? null;
      const stepToHighlight = currentStep;
      const isBeatBoundary = stepToHighlight % stepsPerBeat === 0;
      if (activeGrid) {
        const delay = Math.max(
          0,
          (nextStepTime - audioContext.currentTime) * 1000
        );
        const timeout = window.setTimeout(() => {
          const rows = activeGrid.querySelectorAll<HTMLElement>(".drum-row");
          if (lastStepIndex !== null) {
            const previousStep = lastStepIndex;
            rows.forEach((row) => {
              const steps = row.querySelectorAll<HTMLButtonElement>(".step");
              steps[previousStep]?.classList.remove("is-current");
            });
          }
          rows.forEach((row) => {
            const steps = row.querySelectorAll<HTMLButtonElement>(".step");
            steps[stepToHighlight]?.classList.add("is-current");
          });
          if (drumGridsEl) {
            drumGridsEl.style.setProperty(
              "--playhead-index",
              String(stepToHighlight)
            );
          }
          playheadEl?.classList.add("is-active");
          lastStepIndex = stepToHighlight;
        }, delay);
        playheadTimeouts.push(timeout);
      }
      if (activeGrid) {
        const rows = activeGrid.querySelectorAll<HTMLElement>(".drum-row");
        rows.forEach((row) => {
          const voice = (row.dataset.voice as VoiceId | undefined) ?? "perc";
          const steps = row.querySelectorAll<HTMLButtonElement>(".step");
          const stepEl = steps[currentStep];
          if (stepEl?.classList.contains("is-on")) {
            playVoice(voice, nextStepTime);
          }
        });
      }

      if (isBeatBoundary) {
        const beatIndex = Math.floor(stepToHighlight / stepsPerBeat);
        const beatStartStep = beatIndex * stepsPerBeat;
        const beatHasSound = beatContainsAnySound(
          activeGrid,
          beatStartStep,
          stepsPerBeat
        );
        const soundingBeatIndices = getSoundingBeatIndices(
          activeGrid,
          beatsPerBar,
          stepsPerBeat
        );
        options.onBeatBoundary?.({
          beatIndex,
          beatHasSound,
          soundingBeatIndices,
          beatsPerBar,
        });
      }
      currentStep = (currentStep + 1) % stepsPerBar;
      nextStepTime += stepDuration;
    }
  };

  const startTransport = async () => {
    if (isPlaying) return;
    await ensureAudio();
    if (!audioContext) return;
    isPlaying = true;
    currentStep = 0;
    options.onTransportStart?.();
    nextStepTime = audioContext.currentTime + 0.05;
    schedulerId = window.setInterval(scheduleSteps, LOOKAHEAD_MS);
    if (playButton) playButton.textContent = "Stop";
  };

  const stopTransport = () => {
    if (!isPlaying) return;
    isPlaying = false;
    if (schedulerId !== null) {
      window.clearInterval(schedulerId);
      schedulerId = null;
    }
    playheadTimeouts.forEach((id) => window.clearTimeout(id));
    playheadTimeouts = [];
    if (lastStepIndex !== null) {
      const activeGrid = drumMockEl?.querySelector<HTMLElement>(
        `.drum-grid[data-signature="${signature}"]`
      );
      const rows = activeGrid?.querySelectorAll<HTMLElement>(".drum-row");
      const previousStep = lastStepIndex;
      rows?.forEach((row) => {
        const steps = row.querySelectorAll<HTMLButtonElement>(".step");
        steps[previousStep]?.classList.remove("is-current");
      });
      lastStepIndex = null;
    }
    playheadEl?.classList.remove("is-active");
    options.onTransportStop?.();
    if (playButton) playButton.textContent = "Play";
  };

  const attachUi = () => {
    if (!drumMockEl) return;
    uiAbort?.abort();
    uiAbort = new AbortController();
    const { signal } = uiAbort;

    scheduleLayoutSync();
    syncResponsiveLayout();

    if (drumGridsEl && "ResizeObserver" in window) {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => scheduleLayoutSync());
      resizeObserver.observe(drumGridsEl);
    } else {
      window.addEventListener("resize", scheduleLayoutSync, { signal });
    }
    window.addEventListener("resize", syncResponsiveLayout, { signal });
    detachVisualViewportListeners?.();
    detachVisualViewportListeners = null;
    if (window.visualViewport) {
      const onViewportChange = () => syncResponsiveLayout();
      window.visualViewport.addEventListener("resize", onViewportChange);
      window.visualViewport.addEventListener("scroll", onViewportChange);
      detachVisualViewportListeners = () => {
        window.visualViewport?.removeEventListener("resize", onViewportChange);
        window.visualViewport?.removeEventListener("scroll", onViewportChange);
      };
    }

    if ("MutationObserver" in window) {
      bodyClassObserver?.disconnect();
      bodyClassObserver = new MutationObserver(() => {
        syncResponsiveLayout();
      });
      bodyClassObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    tempoButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const direction = button.dataset.tempo;
          if (direction === "down") setBpm(bpm - 1);
          if (direction === "up") setBpm(bpm + 1);
        },
        { signal }
      );
    });

    drumMockEl.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target?.classList.contains("step")) return;
        target.classList.toggle("is-on");
      },
      { signal }
    );

    if (playButton) {
      playButton.addEventListener(
        "click",
        () => {
          if (isPlaying) stopTransport();
          else void startTransport();
        },
        { signal }
      );
    }

    if (beatButton && beatMenu) {
      const toggleBeatMenu = (open: boolean) => {
        beatMenu.classList.toggle("is-open", open);
        beatButton.setAttribute("aria-expanded", String(open));
      };

      beatButton.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
          const isOpen = beatMenu.classList.contains("is-open");
          toggleBeatMenu(!isOpen);
        },
        { signal }
      );

      beatMenu.addEventListener(
        "click",
        (event) => {
          const target = event.target as HTMLElement | null;
          const beat = target?.getAttribute("data-beat");
          if (!beat) return;
          applyBeat(beat);
          toggleBeatMenu(false);
        },
        { signal }
      );

      document.addEventListener(
        "click",
        (event) => {
          if (beatMenu.contains(event.target as Node)) return;
          if (beatButton.contains(event.target as Node)) return;
          toggleBeatMenu(false);
        },
        { signal }
      );
    }

    if (kitButton && kitMenu) {
      const toggleKitMenu = (open: boolean) => {
        kitMenu.classList.toggle("is-open", open);
        kitButton.setAttribute("aria-expanded", String(open));
      };

      kitButton.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
          const isOpen = kitMenu.classList.contains("is-open");
          toggleKitMenu(!isOpen);
        },
        { signal }
      );

      kitMenu.addEventListener(
        "click",
        (event) => {
          const target = event.target as HTMLElement | null;
          const button = target?.closest<HTMLButtonElement>("button[data-kit]");
          const kit = button?.dataset.kit;
          if (!kit || !(kit in DRUM_KITS)) return;
          setKit(kit as KitId);
          toggleKitMenu(false);
        },
        { signal }
      );

      document.addEventListener(
        "click",
        (event) => {
          if (kitMenu.contains(event.target as Node)) return;
          if (kitButton.contains(event.target as Node)) return;
          toggleKitMenu(false);
        },
        { signal }
      );
    }

  };

  const enter = async () => {
    setSignature(signature);
    setBpm(bpm);
    setBeatLabel();
    setKitLabel();
    attachUi();
    syncResponsiveLayout();
    scheduleLayoutSync();
    if (!hasSeedPattern) {
      const hydrated = await hydrateTrackFromUrl();
      if (!hydrated) {
        applyStandardRock();
      }
      hasSeedPattern = true;
    }
  };

  const exit = () => {
    stopTransport();
    uiAbort?.abort();
    uiAbort = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    detachVisualViewportListeners?.();
    detachVisualViewportListeners = null;
    bodyClassObserver?.disconnect();
    bodyClassObserver = null;
    options.onTransportStop?.();
  };

  return {
    enter,
    exit,
    getShareUrl,
    destroy() {
      exit();
    },
  };
}
