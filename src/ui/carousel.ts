import type { ModeId } from "../modes/types.js";

export type CarouselOptions = {
  carouselShowEl: HTMLElement | null;
  modeDots: NodeListOf<HTMLButtonElement>;
  modeScreens: NodeListOf<HTMLElement>;
  getActiveModeId: () => ModeId;
  getSyncDebugPanel: () => (() => void) | null;
  onSwitchRequest: (modeId: ModeId) => void;
  // Called after carousel-hidden state changes. Caller is responsible for
  // any mode-specific body classes (e.g. drum-fullscreen, wild-tuna-fullscreen).
  onHiddenChange?: (hidden: boolean) => void;
};

export type CarouselController = {
  updateCarouselState: () => void;
  setActiveScreen: (id: ModeId) => void;
  // No activeModeId arg — mode-specific fullscreen policy lives in the caller.
  setCarouselHidden: (hidden: boolean) => void;
};

// Manages carousel dot selection, screen visibility, and keyboard navigation.
export function initializeCarouselUi(opts: CarouselOptions): CarouselController {
  const { carouselShowEl, modeDots, modeScreens } = opts;
  const dotsArray = Array.from(modeDots);
  // The tablist element wrapping the dots (for arrow-key navigation).
  const dotContainer = dotsArray[0]?.closest<HTMLElement>("[role=tablist]") ?? null;

  // Sync dot active classes, aria-selected, and roving tabIndex.
  function updateCarouselState(): void {
    const activeModeId = opts.getActiveModeId();
    dotsArray.forEach((dot) => {
      const isActive = dot.dataset.mode === activeModeId;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-selected", String(isActive));
      // Roving tabIndex: only the active dot is reachable via Tab.
      dot.tabIndex = isActive ? 0 : -1;
    });
  }

  // Show/hide mode screens. Uses both aria-hidden (semantics) and inert
  // (prevents keyboard/pointer access into off-screen panels).
  function setActiveScreen(id: ModeId): void {
    modeScreens.forEach((screen) => {
      const isActive = screen.dataset.mode === id;
      screen.classList.toggle("is-active", isActive);
      screen.setAttribute("aria-hidden", String(!isActive));
      if (isActive) {
        screen.removeAttribute("inert");
      } else {
        screen.setAttribute("inert", "");
      }
    });
    document.body.setAttribute("data-active-mode", id);
    opts.getSyncDebugPanel()?.();
  }

  function setCarouselHidden(hidden: boolean): void {
    document.body.classList.toggle("carousel-hidden", hidden);
    if (carouselShowEl) {
      carouselShowEl.setAttribute("aria-hidden", hidden ? "false" : "true");
    }
    opts.onHiddenChange?.(hidden);
    if (hidden) {
      // Move focus to the show button so keyboard users don't land on a hidden element.
      carouselShowEl?.focus();
    } else {
      // Return focus to the active dot when the carousel reappears.
      const activeDot = dotsArray.find((dot) => dot.dataset.mode === opts.getActiveModeId());
      activeDot?.focus();
    }
  }

  // Dot click: request a mode switch. The mode transition's applyUiState is
  // responsible for calling setCarouselHidden when the new mode isn't fullscreen-capable.
  // We do NOT call setCarouselHidden here to avoid racing with an in-progress transition.
  dotsArray.forEach((dot) => {
    dot.addEventListener("click", () => {
      const modeId = dot.dataset.mode as ModeId | undefined;
      if (!modeId) return;
      opts.onSwitchRequest(modeId);
    });
  });

  // Arrow-key navigation within the tablist (ARIA tab pattern).
  if (dotContainer) {
    dotContainer.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const currentIndex = dotsArray.findIndex((d) => d === document.activeElement);
      if (currentIndex === -1) return;
      const dir = event.key === "ArrowRight" ? 1 : -1;
      const nextDot = dotsArray[(currentIndex + dir + dotsArray.length) % dotsArray.length];
      nextDot?.focus();
      event.preventDefault();
    });
  }

  if (carouselShowEl) {
    carouselShowEl.addEventListener("click", () => {
      setCarouselHidden(false);
    });
  }

  return { updateCarouselState, setActiveScreen, setCarouselHidden };
}
