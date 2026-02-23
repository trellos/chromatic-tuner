# CSS Maintainability Guide

## Baseline
- Run `npm run lint:css` for routine checks.
- Run `npm run lint:css:fix` before commits to apply safe autofixes.
- Run `npm run lint:css:strict` in CI to fail on any warning drift.

## Rule strategy
- Hard errors now: invalid CSS, unknown properties/selectors, duplicate selector/property mistakes.
- Property ordering is enforced with `order/properties-alphabetical-order` for deterministic diffs.
- Styles are split by area under `public/styles/` and imported in order from `public/style.css`.

## Recommended workflow
1. Edit CSS.
2. Run `npm run lint:css:fix`.
3. Resolve any remaining lint errors.
4. Keep selectors in the most specific split file (for example `30-drum-machine.css` for drum rules).
