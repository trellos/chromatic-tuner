// Carousel bridge: lets modes request fullscreen changes without importing main.ts.
// main.ts registers the handler on init; modes call setCarouselHidden() directly.

let _handler: ((hidden: boolean) => void) | null = null;

export function registerCarouselHiddenHandler(fn: (hidden: boolean) => void): void {
  _handler = fn;
}

export function setCarouselHidden(hidden: boolean): void {
  _handler?.(hidden);
}
