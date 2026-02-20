# UI Agents Guide (src/ui)

This folder owns reusable UI infrastructure and styling hooks.
The app background is a layered system driven by CSS variables set on `document.body`
by `initializeSeigaihaBackground()`.

## Seigaiha Background Contract

The background is composed of layers:

1. Base (static) full-screen gradient (CSS, non-repeating)
2. Seigaiha tile (SVG, repeating)
3. Grain tile (SVG, repeating, subtle)

JavaScript MUST NOT animate background colors/hues.
Instead, JS animates a scalar `noise ∈ [0,1]` and maps it to CSS vars:

- `--bg-noise` (debug/introspection only)
- `--seigaiha-opacity` (subtle)
- `--seigaiha-grain-opacity` (primary material modulation)
- `--seigaiha-blur` (tiny, prevents shimmer)
- `--seigaiha-image` (cached SVG data URL)
- `--grain-image` (cached SVG data URL)
- `--seigaiha-size` (px; must be integers)

### Guardrails

- Seigaiha geometry must remain deterministic and tile seamlessly.
- Never use `(row % 2)` directly when iterating negative rows; normalize parity.
- Avoid fractional `background-size` and percent-based sizes for the pattern layers.
- Don’t regenerate SVG each frame; cache tiles and only update CSS vars.
- Keep pattern contrast low so it never competes with the main UI.

## Card Background Pattern

Cards may opt into a subtle internal seigaiha texture by using a pseudo-element
that references the same CSS vars:

- `background-image: var(--seigaiha-image)`
- `opacity: var(--card-seigaiha-opacity, 0.08)`
- `filter: blur(var(--seigaiha-blur))`
- clipped via `overflow:hidden; border-radius:inherit;`

No separate JS path should be needed for the card texture.
