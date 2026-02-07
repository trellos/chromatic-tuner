import type { ModeDefinition } from "./types.js";

export function createMetronomeMode(): ModeDefinition {
  const metronomeEl = document.querySelector<HTMLElement>(
    '.mode-screen[data-mode="metronome"]'
  );
  const tempoDialEl = document.getElementById("tempo-dial");
  const tempoValueEl = document.getElementById("tempo-value");
  const timeButtonEl = document.getElementById("metro-time-button");
  const timeMenuEl = document.getElementById("metro-time-menu");
  const accentToggleEl = document.getElementById("metro-accent-toggle");
  const controlsEl =
    metronomeEl?.querySelector<HTMLElement>(".metro-controls") ?? null;

  const BPM_MIN = 40;
  const BPM_MAX = 220;
  const ROTATION_MIN = -135;
  const ROTATION_RANGE = 270;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.1;
  const REGULAR_URL = "https://bigsoundbank.com/UPLOAD/bwf-en/2338.wav";
  const ACCENT_URL = "https://bigsoundbank.com/UPLOAD/bwf-en/2304.wav";

  let bpm = 120;
  let timeSignature = "4/4";
  let accentEnabled = true;
  let isPlaying = false;
  let audioContext: AudioContext | null = null;
  let regularBuffer: AudioBuffer | null = null;
  let accentBuffer: AudioBuffer | null = null;
  let schedulerId: number | null = null;
  let nextNoteTime = 0;
  let currentBeat = 0;
  let uiAbort: AbortController | null = null;

  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  const getBeatsPerBar = () =>
    Number.parseInt(timeSignature.split("/")[0] ?? "4", 10);

  const setDialRotation = (value: number) => {
    if (!tempoDialEl) return;
    const ratio = (value - BPM_MIN) / (BPM_MAX - BPM_MIN);
    const rotation = ROTATION_MIN + ratio * ROTATION_RANGE;
    tempoDialEl.style.setProperty("--dial-rotation", `${rotation}deg`);
    tempoDialEl.style.setProperty("--dial-rotation-inverse", `${-rotation}deg`);
    tempoDialEl.setAttribute("aria-valuenow", String(Math.round(value)));
  };

  const setBpm = (value: number) => {
    bpm = clamp(Math.round(value), BPM_MIN, BPM_MAX);
    if (tempoValueEl) {
      tempoValueEl.textContent = String(bpm);
    }
    setDialRotation(bpm);
  };

  const setTimeSignature = (value: string) => {
    timeSignature = value;
    if (timeButtonEl) {
      timeButtonEl.textContent = `Time ${value}`;
    }
  };

  const setAccentEnabled = (enabled: boolean) => {
    accentEnabled = enabled;
    if (accentToggleEl) {
      accentToggleEl.classList.toggle("is-on", enabled);
      accentToggleEl.setAttribute("aria-pressed", String(enabled));
    }
  };

  const ensureAudio = async () => {
    if (audioContext) {
      await audioContext.resume();
      return;
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    audioContext = new AudioCtx({ latencyHint: "interactive" });
    await audioContext.resume();

    const loadSample = async (url: string) => {
      try {
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        return await audioContext!.decodeAudioData(data);
      } catch {
        return null;
      }
    };

    [regularBuffer, accentBuffer] = await Promise.all([
      loadSample(REGULAR_URL),
      loadSample(ACCENT_URL),
    ]);
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

  const playClick = (time: number, accent: boolean) => {
    if (regularBuffer || accentBuffer) {
      playBuffer(accent ? accentBuffer : regularBuffer, time, accent ? 1 : 0.75);
      return;
    }

    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 980 : 740;
    gain.gain.value = accent ? 0.25 : 0.18;
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  };

  const schedule = () => {
    if (!audioContext) return;
    const beatsPerBar = getBeatsPerBar();
    while (nextNoteTime < audioContext.currentTime + SCHEDULE_AHEAD) {
      const isAccent = accentEnabled && currentBeat === 0;
      playClick(nextNoteTime, isAccent);
      currentBeat = (currentBeat + 1) % beatsPerBar;
      nextNoteTime += 60 / bpm;
    }
  };

  const start = async () => {
    if (isPlaying) return;
    await ensureAudio();
    if (!audioContext) return;
    isPlaying = true;
    currentBeat = 0;
    nextNoteTime = audioContext.currentTime + 0.05;
    schedulerId = window.setInterval(schedule, LOOKAHEAD_MS);
    const toggleButton =
      controlsEl?.querySelector<HTMLButtonElement>('[data-action="toggle"]');
    if (toggleButton) toggleButton.textContent = "Stop";
  };

  const stop = () => {
    if (!isPlaying) return;
    isPlaying = false;
    if (schedulerId !== null) {
      window.clearInterval(schedulerId);
      schedulerId = null;
    }
    const toggleButton =
      controlsEl?.querySelector<HTMLButtonElement>('[data-action="toggle"]');
    if (toggleButton) toggleButton.textContent = "Start";
  };

  const toggleMenu = (open: boolean) => {
    if (!timeMenuEl || !timeButtonEl) return;
    timeMenuEl.classList.toggle("is-open", open);
    timeButtonEl.setAttribute("aria-expanded", String(open));
  };

  const angleFromEvent = (event: PointerEvent) => {
    const rect = tempoDialEl?.getBoundingClientRect();
    if (!rect) return 0;
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const degrees = (Math.atan2(y, x) * 180) / Math.PI;
    return (degrees + 450) % 360;
  };

  const attachUi = () => {
    if (!metronomeEl) return;
    uiAbort?.abort();
    uiAbort = new AbortController();
    const { signal } = uiAbort;

    if (controlsEl) {
      controlsEl.addEventListener(
        "click",
        (event) => {
          const target = event.target as HTMLElement | null;
          const action = target?.getAttribute("data-action");
          if (!action) return;
          if (action === "decrease") setBpm(bpm - 1);
          if (action === "increase") setBpm(bpm + 1);
          if (action === "toggle") {
            if (isPlaying) stop();
            else void start();
          }
        },
        { signal }
      );
    }

    if (tempoDialEl) {
      let dragStartAngle = 0;
      let dragStartBpm = bpm;
      let dragging = false;

      tempoDialEl.addEventListener(
        "pointerdown",
        (event) => {
          dragStartAngle = angleFromEvent(event);
          dragStartBpm = bpm;
          dragging = true;
          tempoDialEl.setPointerCapture(event.pointerId);
        },
        { signal }
      );

      tempoDialEl.addEventListener(
        "pointermove",
        (event) => {
          if (!dragging) return;
          const angle = angleFromEvent(event);
          let delta = angle - dragStartAngle;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          setBpm(dragStartBpm + delta * 0.6);
        },
        { signal }
      );

      tempoDialEl.addEventListener(
        "pointerup",
        (event) => {
          dragging = false;
          tempoDialEl.releasePointerCapture(event.pointerId);
        },
        { signal }
      );

      tempoDialEl.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          const delta = event.deltaY > 0 ? -1 : 1;
          setBpm(bpm + delta);
        },
        { passive: false, signal }
      );

      tempoDialEl.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            setBpm(bpm + 1);
          } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            setBpm(bpm - 1);
          }
        },
        { signal }
      );
    }

    if (timeButtonEl && timeMenuEl) {
      timeButtonEl.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
          const isOpen = timeMenuEl.classList.contains("is-open");
          toggleMenu(!isOpen);
        },
        { signal }
      );

      timeMenuEl.addEventListener(
        "click",
        (event) => {
          const target = event.target as HTMLElement | null;
          const value = target?.getAttribute("data-value");
          if (!value) return;
          setTimeSignature(value);
          toggleMenu(false);
        },
        { signal }
      );

      document.addEventListener(
        "click",
        (event) => {
          if (timeMenuEl.contains(event.target as Node)) return;
          if (timeButtonEl.contains(event.target as Node)) return;
          toggleMenu(false);
        },
        { signal }
      );
    }

    if (accentToggleEl) {
      accentToggleEl.addEventListener(
        "click",
        () => {
          setAccentEnabled(!accentEnabled);
        },
        { signal }
      );
    }
  };

  const enter = async () => {
    setBpm(bpm);
    setTimeSignature(timeSignature);
    setAccentEnabled(accentEnabled);
    attachUi();
  };

  const exit = () => {
    stop();
    uiAbort?.abort();
    uiAbort = null;
  };

  return {
    id: "metronome",
    title: "Metronome",
    icon: "MT",
    preserveState: false,
    canFullscreen: false,
    onEnter: enter,
    onExit: exit,
  };
}
