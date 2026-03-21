// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCircleNoteBar, type CircleNoteBarDegreeToken } from "../../src/ui/circle-note-bar.js";

function mount(): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

function degreeTokenForInterval(interval: number): CircleNoteBarDegreeToken | null {
  switch (((interval % 12) + 12) % 12) {
    case 0:
      return "I";
    case 2:
      return "ii";
    case 4:
      return "iii";
    case 5:
      return "IV";
    case 7:
      return "V";
    case 9:
      return "vi";
    case 11:
      return "vii°";
    default:
      return null;
  }
}

function degreeKeyFromToken(token: CircleNoteBarDegreeToken): "i" | "ii" | "iii" | "iv" | "v" | "vi" | "vii" {
  switch (token) {
    case "I":
      return "i";
    case "ii":
      return "ii";
    case "iii":
      return "iii";
    case "IV":
      return "iv";
    case "V":
      return "v";
    case "vi":
      return "vi";
    case "vii°":
      return "vii";
  }
}

describe("circle-note-bar", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("updates roman numerals from the injected degree helpers", () => {
    const host = mount();
    const noteBar = createCircleNoteBar({
      degreeLabelForMode: (token) => token?.toUpperCase() ?? "",
      degreeTokenForInterval,
      degreeKeyFromToken,
    });
    host.appendChild(noteBar.element);

    noteBar.updateDegrees(0);

    expect(host.querySelector('.cof-note-cell[data-semitone="0"]')?.getAttribute("data-degree")).toBe("i");
    expect(host.querySelector('.cof-note-cell[data-semitone="2"]')?.getAttribute("data-degree")).toBe("ii");
    expect(host.querySelector('.cof-note-cell[data-semitone="1"]')?.getAttribute("data-diatonic")).toBe("false");
    expect(
      host.querySelector('.cof-note-cell[data-semitone="11"]')
        ?.closest(".cof-note-row")
        ?.querySelector(".cof-note-row-degree")
        ?.textContent
    ).toBe("VII°");
  });

  it("releaseHeldNotes finalizes active visuals and floating trails", () => {
    vi.useFakeTimers();
    try {
      const host = mount();
      const noteBar = createCircleNoteBar({
        degreeLabelForMode: () => "",
        degreeTokenForInterval: () => null,
        degreeKeyFromToken,
      });
      host.appendChild(noteBar.element);
      const cell = host.querySelector<HTMLElement>('.cof-note-cell[data-semitone="0"]');
      expect(cell).not.toBeNull();

      noteBar.holdNote(60);
      expect(cell?.classList.contains("is-active")).toBe(true);

      noteBar.releaseHeldNotes();
      expect(cell?.classList.contains("is-active")).toBe(false);
      expect(host.querySelectorAll(".cof-note-trail").length).toBe(1);

      vi.advanceTimersByTime(2100);
      expect(host.querySelectorAll(".cof-note-trail").length).toBe(0);
      noteBar.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
