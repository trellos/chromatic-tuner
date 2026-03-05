// @vitest-environment jsdom
/**
 * Unit tests for Circle of Fifths tap-zone behavior.
 *
 * Verifies:
 * 1. Keyboard activation (Enter) on an outer wedge calls onOuterTap with
 *    zone: "chord" and movesPrimary: true (defaulting to chord side when no
 *    pointer position is available), and adds `has-primary` to the root.
 * 2. IV/V taps on the chord side play the chord but do NOT move the inner
 *    circle (movesPrimary: false, no re-entry of setPrimaryIndex for same key).
 * 3. Tapping outside the SVG circle clears the primary (removes `has-primary`).
 * 4. Pointerdown on a note cell calls onNoteBarTap.
 *
 * Because clientToSvgPoint depends on getBoundingClientRect (returns zeros in
 * jsdom), click events with clientX/clientY=0,0 land at the SVG origin and
 * may not hit the expected zone. Tests therefore rely on keyboard events
 * (which bypass pointer-position logic) or inspect callback payloads directly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createCircleOfFifthsUi, type CircleNoteTap } from "../../src/ui/circle-of-fifths.js";

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function getWedgeNode(container: HTMLElement, index: number): Element {
  const nodes = container.querySelectorAll(".cof-wedge");
  const node = nodes[index];
  if (!node) throw new Error(`No wedge at index ${index}`);
  return node;
}

function getNoteCell(container: HTMLElement, semitone: number): Element {
  const cell = container.querySelector<HTMLElement>(`.cof-note-cell[data-semitone="${semitone}"]`);
  if (!cell) throw new Error(`No note cell for semitone ${semitone}`);
  return cell;
}

function pressEnterOn(el: Element): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

describe("Circle of Fifths tap zones", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = makeContainer();
  });

  it("keyboard Enter on wedge 0 calls onOuterTap with zone=chord and movesPrimary=true", () => {
    const taps: CircleNoteTap[] = [];
    createCircleOfFifthsUi(container, { onOuterTap: (note) => taps.push(note) });

    const wedge = getWedgeNode(container, 0);
    pressEnterOn(wedge);

    expect(taps).toHaveLength(1);
    const tap = taps[0]!;
    expect(tap.zone).toBe("chord");
    expect(tap.movesPrimary).toBe(true);
    expect(tap.index).toBe(0);
  });

  it("keyboard Enter on wedge adds has-primary class to root section", () => {
    createCircleOfFifthsUi(container, {});

    const wedge = getWedgeNode(container, 2);
    pressEnterOn(wedge);

    const root = container.querySelector("section.cof");
    expect(root?.classList.contains("has-primary")).toBe(true);
  });

  it("tapping IV wedge when primary is set does not move primary (movesPrimary=false)", () => {
    const taps: CircleNoteTap[] = [];
    const ui = createCircleOfFifthsUi(container, { onOuterTap: (note) => taps.push(note) });

    // Set primary to C (index 0, semitone 0). F is IV (semitone 5, index 11).
    ui.setPrimaryByLabel("C");

    // Press Enter on wedge index 11 (F = IV of C).
    const wedge = getWedgeNode(container, 11);
    pressEnterOn(wedge);

    expect(taps).toHaveLength(1);
    const tap = taps[0]!;
    expect(tap.zone).toBe("chord");
    expect(tap.movesPrimary).toBe(false);
  });

  it("tapping IV wedge when primary is set keeps original primary on root", () => {
    const ui = createCircleOfFifthsUi(container, {});
    ui.setPrimaryByLabel("C");

    const root = container.querySelector("section.cof")!;
    expect(root.classList.contains("has-primary")).toBe(true);

    // Tap F (IV of C) — should NOT clear or change primary
    const wedge = getWedgeNode(container, 11);
    pressEnterOn(wedge);

    // Primary should still be set (has-primary present)
    expect(root.classList.contains("has-primary")).toBe(true);
  });

  it("clicking outside the SVG circle clears has-primary", () => {
    const ui = createCircleOfFifthsUi(container, {});
    ui.setPrimaryByLabel("G");

    const root = container.querySelector("section.cof")!;
    expect(root.classList.contains("has-primary")).toBe(true);

    // Simulate a click on the SVG itself at coordinates well outside the circle.
    // getBoundingClientRect returns zeros in jsdom, so the SVG point will be
    // computed as (clientX, clientY) directly. The outer radius in SVG units is
    // 450 centered at 500, so a point at (0, 0) is distance ~707 from center —
    // outside the circle. We click the svg element directly (not a wedge child).
    const svg = container.querySelector("svg.cof-svg")!;
    svg.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
      })
    );

    expect(root.classList.contains("has-primary")).toBe(false);
  });

  it("pointerdown on note cell calls onNoteBarTap with correct midi", () => {
    const noteTaps: { label: string; midi: number }[] = [];
    createCircleOfFifthsUi(container, { onNoteBarTap: (note) => noteTaps.push(note) });

    // semitone 0 = C, midi near C4 = 60
    const cell = getNoteCell(container, 0);
    cell.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })
    );

    expect(noteTaps).toHaveLength(1);
    const note = noteTaps[0]!;
    expect(note.midi).toBe(60);
    expect(note.label).toBe("C");
  });
});
