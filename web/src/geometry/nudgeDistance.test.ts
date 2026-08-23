import { describe, expect, it } from "vitest";
import { nextToolAlongRay, type Pt } from "./nudgeDistance";

function rect(minX: number, maxX: number, minY: number, maxY: number): Pt[] {
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}

describe("nextToolAlongRay", () => {
  it("finds the gap between two simple rectangles", () => {
    const a = rect(-5, 5, -3, 3);
    const b = rect(15, 20, -3, 3);
    const hit = nextToolAlongRay([0, 0], "right", [
      { id: "a", poly: a },
      { id: "b", poly: b },
    ], "a");
    expect(hit).not.toBeNull();
    expect(hit!.start).toEqual([5, 0]);
    expect(hit!.end).toEqual([15, 0]);
    expect(hit!.distanceMm).toBeCloseTo(10, 6);
  });

  it("returns null when nothing else lies along the ray", () => {
    const a = rect(-5, 5, -3, 3);
    const hit = nextToolAlongRay([0, 0], "right", [{ id: "a", poly: a }], "a");
    expect(hit).toBeNull();
  });

  it("returns null when another tool exists but not along this direction", () => {
    const a = rect(-5, 5, -3, 3);
    const b = rect(-3, 3, 10, 15); // directly above, not to the right
    const hit = nextToolAlongRay([0, 0], "right", [
      { id: "a", poly: a },
      { id: "b", poly: b },
    ], "a");
    expect(hit).toBeNull();
  });

  it("skips further self-crossings on a concave (notched) self outline", () => {
    // Two "blobs" (x in [-5,-1] and [1,5], y in [-3,3]) joined by a bridge
    // below the ray line (y in [-3.5,-3]) so it's one connected polygon with
    // a notch open at the top between the blobs — the y=0 ray crosses this
    // self outline three times (exit blob1 at x=-1, re-enter blob2 at x=1,
    // exit blob2 at x=5) before ever reaching another tool.
    const self: Pt[] = [
      [-5, -3.5], [5, -3.5], [5, 3], [1, 3], [1, -3], [-1, -3], [-1, 3], [-5, 3],
    ];
    const other = rect(10, 14, -2, 2);
    const hit = nextToolAlongRay([-3, 0], "right", [
      { id: "self", poly: self },
      { id: "other", poly: other },
    ], "self");
    expect(hit).not.toBeNull();
    // Nearest self exit (not the later re-entry/exit further along).
    expect(hit!.start).toEqual([-1, 0]);
    expect(hit!.end).toEqual([10, 0]);
    expect(hit!.distanceMm).toBeCloseTo(11, 6);
  });

  it("skips a degenerate edge exactly parallel to the ray without crashing or corrupting the real hit", () => {
    const a = rect(-5, 5, -3, 3);
    // This box's bottom edge (y=0, x 20..25) is exactly parallel to and
    // collinear with the ray — the ray/segment solve's denominator is
    // exactly zero for that one edge, which must be skipped (not divide by
    // zero into NaN/Infinity and corrupt the result). The box's *side*
    // edges still legitimately graze the ray at the box's near corner
    // (20, 0), which is the correct nearest crossing regardless.
    const box: Pt[] = [[20, 0], [25, 0], [25, 1], [20, 1]];
    const hit = nextToolAlongRay([0, 0], "right", [
      { id: "a", poly: a },
      { id: "box", poly: box },
    ], "a");
    expect(hit).not.toBeNull();
    expect(hit!.end).toEqual([20, 0]);
    expect(hit!.distanceMm).toBeCloseTo(15, 6);
  });

  it("supports all four cardinal directions", () => {
    const a = rect(-5, 5, -5, 5);
    const up = rect(-2, 2, 10, 14);
    const down = rect(-2, 2, -14, -10);
    const left = rect(-14, -10, -2, 2);
    const polys = [
      { id: "a", poly: a },
      { id: "up", poly: up },
      { id: "down", poly: down },
      { id: "left", poly: left },
    ];
    expect(nextToolAlongRay([0, 0], "up", polys, "a")!.distanceMm).toBeCloseTo(5, 6);
    expect(nextToolAlongRay([0, 0], "down", polys, "a")!.distanceMm).toBeCloseTo(5, 6);
    expect(nextToolAlongRay([0, 0], "left", polys, "a")!.distanceMm).toBeCloseTo(5, 6);
  });
});
