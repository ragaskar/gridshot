import { describe, expect, it } from "vitest";
import { applySelectionClick } from "./selection";

const IDS = ["a", "b", "c", "d", "e"];

describe("applySelectionClick", () => {
  it("plain click on nothing selected selects just that row and sets the anchor", () => {
    const { selection, anchor } = applySelectionClick(IDS, new Set(), null, "b", false);
    expect([...selection]).toEqual(["b"]);
    expect(anchor).toBe("b");
  });

  it("plain click toggles membership without touching anything else", () => {
    const current = new Set(["a", "c"]);
    const on = applySelectionClick(IDS, current, "a", "b", false);
    expect(new Set(on.selection)).toEqual(new Set(["a", "c", "b"]));
    expect(on.anchor).toBe("b");

    const off = applySelectionClick(IDS, current, "a", "a", false);
    expect(new Set(off.selection)).toEqual(new Set(["c"]));
    expect(off.anchor).toBe("a");
  });

  it("shift-click with no anchor (nothing selected) just selects the clicked row", () => {
    const { selection, anchor } = applySelectionClick(IDS, new Set(), null, "c", true);
    expect([...selection]).toEqual(["c"]);
    expect(anchor).toBe("c");
  });

  it("shift-click selects the contiguous range from the anchor forward", () => {
    const { selection, anchor } = applySelectionClick(IDS, new Set(["b"]), "b", "d", true);
    expect(selection).toEqual(new Set(["b", "c", "d"]));
    expect(anchor).toBe("b"); // anchor doesn't move on a shift-click
  });

  it("shift-click selects the contiguous range from the anchor backward", () => {
    const { selection, anchor } = applySelectionClick(IDS, new Set(["d"]), "d", "b", true);
    expect(selection).toEqual(new Set(["b", "c", "d"]));
    expect(anchor).toBe("d");
  });

  it("shift-click on the anchor itself selects just that one row", () => {
    const { selection } = applySelectionClick(IDS, new Set(["b"]), "b", "b", true);
    expect(selection).toEqual(new Set(["b"]));
  });

  it("a later shift-click resizes the range from the same fixed anchor", () => {
    const first = applySelectionClick(IDS, new Set(["b"]), "b", "d", true);
    expect(first.selection).toEqual(new Set(["b", "c", "d"]));

    // shift-clicking a nearer row shrinks the range, anchor stays put
    const second = applySelectionClick(IDS, first.selection, first.anchor, "c", true);
    expect(second.selection).toEqual(new Set(["b", "c"]));
    expect(second.anchor).toBe("b");
  });

  it("shift-click replaces an unrelated prior selection with the new range", () => {
    const { selection } = applySelectionClick(IDS, new Set(["a", "e"]), "b", "c", true);
    expect(selection).toEqual(new Set(["b", "c"]));
  });
});
