import type { ModeId } from "../modes/types.js";

export type SwipeGestureOptions = {
  modeStageEl: HTMLElement;
  modeScreens: NodeListOf<HTMLElement>;
  getActiveModeId: () => ModeId;
  getModeByOffset: (offset: number) => ModeId | null;
  getIsSwitching: () => boolean;
  onSwitchRequest: (modeId: ModeId) => void;
  onClearFullscreen: () => void;
};

function isSwipeGestureExcludedTarget(target: EventTarget | null): boolean {
  const elementTarget =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (!elementTarget) return false;
  return Boolean(
    elementTarget.closest(
      [
        "button",
        "input",
        "select",
        "textarea",
        "label",
        "[role='button']",
        "[role='slider']",
        "[data-no-mode-swipe]",
      ].join(",")
    )
  );
}

// Drives touch swipe gesture handling for mode changes, including
// drag-follow visuals and commit/cancel behavior.
export function bindModeSwipe(opts: SwipeGestureOptions): void {
  const { modeStageEl, modeScreens } = opts;

  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeDx = 0;
  let swipeDirection: 1 | -1 | null = null;
  let swipeActiveScreen: HTMLElement | null = null;
  let swipeTargetScreen: HTMLElement | null = null;
  let swipeTargetMode: ModeId | null = null;
  let isSwipeDragging = false;
  let suppressSwipeUntilTouchEnd = false;

  function getScreenByMode(modeId: ModeId): HTMLElement | null {
    return Array.from(modeScreens).find((s) => s.dataset.mode === modeId) ?? null;
  }

  function clearSwipeState(): void {
    swipeStartX = 0;
    swipeStartY = 0;
    swipeDx = 0;
    swipeDirection = null;
    swipeTargetMode = null;
    isSwipeDragging = false;
    modeStageEl.classList.remove("is-swiping");
    [swipeActiveScreen, swipeTargetScreen].forEach((screen) => {
      if (!screen) return;
      screen.classList.remove("is-swipe-active");
      screen.style.transition = "";
      screen.style.transform = "";
    });
    swipeActiveScreen = null;
    swipeTargetScreen = null;
  }

  // Prepares the active and incoming panels so horizontal drag can
  // render both screens together during a mode swipe.
  function setupSwipeScreens(direction: 1 | -1): void {
    const nextMode = opts.getModeByOffset(direction);
    const activeScreen = getScreenByMode(opts.getActiveModeId());
    if (!nextMode || !activeScreen) {
      clearSwipeState();
      return;
    }
    const nextScreen = getScreenByMode(nextMode);
    if (!nextScreen) {
      clearSwipeState();
      return;
    }
    swipeDirection = direction;
    swipeTargetMode = nextMode;
    swipeActiveScreen = activeScreen;
    swipeTargetScreen = nextScreen;
    modeStageEl.classList.add("is-swiping");
    swipeActiveScreen.classList.add("is-swipe-active");
    swipeTargetScreen.classList.add("is-swipe-active");
    swipeActiveScreen.style.transition = "none";
    swipeTargetScreen.style.transition = "none";
  }

  function renderSwipe(dx: number): void {
    if (!swipeDirection || !swipeActiveScreen || !swipeTargetScreen) return;
    const width = modeStageEl.getBoundingClientRect().width;
    const clampedDx = Math.max(-width, Math.min(width, dx));
    swipeDx = clampedDx;
    const targetOffset = swipeDirection === 1 ? width : -width;
    swipeActiveScreen.style.transform = `translate3d(${clampedDx}px, 0, 0)`;
    swipeTargetScreen.style.transform = `translate3d(${clampedDx + targetOffset}px, 0, 0)`;
  }

  async function animateSwipe(commit: boolean): Promise<void> {
    if (!swipeDirection || !swipeActiveScreen || !swipeTargetScreen) return;
    const width = modeStageEl.getBoundingClientRect().width;
    const targetOffset = swipeDirection === 1 ? width : -width;
    const activeTargetX = commit ? (swipeDirection === 1 ? -width : width) : 0;
    const targetTargetX = commit ? 0 : targetOffset;
    swipeActiveScreen.style.transition = "transform 220ms ease";
    swipeTargetScreen.style.transition = "transform 220ms ease";
    swipeActiveScreen.style.transform = `translate3d(${activeTargetX}px, 0, 0)`;
    swipeTargetScreen.style.transform = `translate3d(${targetTargetX}px, 0, 0)`;
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 260);
      swipeTargetScreen?.addEventListener(
        "transitionend",
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );
    });
  }

  function requestModeSwitchFromSwipe(nextMode: ModeId): void {
    // Intentionally non-blocking: touchend should finish immediately,
    // while the switch handles async lifecycle and error reporting.
    void opts.onSwitchRequest(nextMode);
    opts.onClearFullscreen();
  }

  modeStageEl.addEventListener(
    "touchstart",
    (event) => {
      suppressSwipeUntilTouchEnd = false;
      if (document.body.classList.contains("drum-fullscreen") || opts.getIsSwitching()) {
        clearSwipeState();
        return;
      }
      if (isSwipeGestureExcludedTarget(event.target)) {
        suppressSwipeUntilTouchEnd = true;
        clearSwipeState();
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
      swipeDx = 0;
      swipeDirection = null;
      swipeTargetMode = null;
      isSwipeDragging = false;
    },
    { passive: true, capture: true }
  );

  modeStageEl.addEventListener(
    "touchmove",
    (event) => {
      if (document.body.classList.contains("drum-fullscreen")) return;
      if (suppressSwipeUntilTouchEnd) return;
      if (isSwipeGestureExcludedTarget(event.target)) {
        suppressSwipeUntilTouchEnd = true;
        clearSwipeState();
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - swipeStartX;
      const dy = touch.clientY - swipeStartY;
      if (!isSwipeDragging) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) <= Math.abs(dy)) return;
        isSwipeDragging = true;
      }
      event.preventDefault();
      const direction: 1 | -1 = dx < 0 ? 1 : -1;
      if (!swipeDirection || swipeDirection !== direction) {
        setupSwipeScreens(direction);
      }
      renderSwipe(dx);
    },
    { passive: false, capture: true }
  );

  modeStageEl.addEventListener(
    "touchcancel",
    () => {
      suppressSwipeUntilTouchEnd = false;
      clearSwipeState();
    },
    { passive: true, capture: true }
  );

  modeStageEl.addEventListener(
    "touchend",
    async (event) => {
      if (document.body.classList.contains("drum-fullscreen")) {
        suppressSwipeUntilTouchEnd = false;
        clearSwipeState();
        return;
      }
      if (suppressSwipeUntilTouchEnd) {
        suppressSwipeUntilTouchEnd = false;
        clearSwipeState();
        return;
      }
      const touch = event.changedTouches[0];
      if (!touch) {
        suppressSwipeUntilTouchEnd = false;
        clearSwipeState();
        return;
      }
      const dx = touch.clientX - swipeStartX;
      const dy = touch.clientY - swipeStartY;
      if (!isSwipeDragging || !swipeTargetMode || !swipeDirection) {
        clearSwipeState();
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
        const nextMode = opts.getModeByOffset(dx < 0 ? 1 : -1);
        if (!nextMode) return;
        requestModeSwitchFromSwipe(nextMode);
        return;
      }

      const width = modeStageEl.getBoundingClientRect().width;
      const shouldCommit = Math.abs(swipeDx) > width * 0.22;
      await animateSwipe(shouldCommit);
      const nextMode = shouldCommit ? swipeTargetMode : null;
      clearSwipeState();
      if (nextMode) {
        requestModeSwitchFromSwipe(nextMode);
      }
    },
    { passive: true, capture: true }
  );
}
