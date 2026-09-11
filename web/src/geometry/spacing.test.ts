import { describe, expect, it } from "vitest";
import {
  capsuleMidsectionPoints, extremePoint, nearestOtherAlongRay, pointInPolygon,
  selfExitAlongRay, type Pt,
} from "./spacing";

function rect(minX: number, maxX: number, minY: number, maxY: number): Pt[] {
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}

describe("pointInPolygon", () => {
  it("is true for an interior point and false outside", () => {
    const box = rect(-5, 5, -5, 5);
    expect(pointInPolygon([0, 0], box)).toBe(true);
    expect(pointInPolygon([10, 0], box)).toBe(false);
  });
});

describe("selfExitAlongRay", () => {
  it("exits a plain rectangle at its own edge", () => {
    const stamp = rect(-5, 5, -3, 3);
    const hit = selfExitAlongRay([0, 0], "right", [stamp]);
    expect(hit).not.toBeNull();
    expect(hit!.point).toEqual([5, 0]);
    expect(hit!.t).toBeCloseTo(5, 6);
  });

  it("exits at a finger-hole scallop's outer edge when it bulges past the stamp boundary", () => {
    const stamp = rect(-5, 5, -3, 3);
    // A scallop straddling the right edge (x=5), centred there, reaching
    // out to x=7 — further than the stamp's own boundary along this ray.
    const scallop = rect(3, 7, -1, 1);
    const hit = selfExitAlongRay([0, 0], "right", [stamp, scallop]);
    expect(hit).not.toBeNull();
    expect(hit!.point).toEqual([7, 0]);
    expect(hit!.t).toBeCloseTo(7, 6);
  });

  it("ignores a finger hole that stays fully inside the stamp material", () => {
    const stamp = rect(-5, 5, -3, 3);
    const interiorHole = rect(1, 2, -1, 1);
    const hit = selfExitAlongRay([0, 0], "right", [stamp, interiorHole]);
    expect(hit).not.toBeNull();
    // The stamp's own edge, not pulled in by the "hole" — holes are unioned
    // as material here, never subtracted.
    expect(hit!.point).toEqual([5, 0]);
  });

  it("exits at the stamp edge when a scallop lies off this particular ray", () => {
    const stamp = rect(-5, 5, -3, 3);
    // Scallop on the top edge, not intersected by a rightward ray at y=0.
    const scallop = rect(-1, 1, 3, 5);
    const hit = selfExitAlongRay([0, 0], "right", [stamp, scallop]);
    expect(hit).not.toBeNull();
    expect(hit!.point).toEqual([5, 0]);
  });

  it("returns null when the origin sits outside every self ring", () => {
    const stamp = rect(-5, 5, -3, 3);
    expect(selfExitAlongRay([100, 100], "right", [stamp])).toBeNull();
  });
});

describe("nearestOtherAlongRay", () => {
  it("finds the nearest other-id hit ahead of the origin", () => {
    const other = rect(10, 14, -2, 2);
    const hit = nearestOtherAlongRay([5, 0], "right", [
      { id: "self", poly: rect(-5, 5, -3, 3) },
      { id: "other", poly: other },
    ], "self");
    expect(hit).not.toBeNull();
    expect(hit!.point).toEqual([10, 0]);
    expect(hit!.id).toBe("other");
  });

  it("registers a touching neighbor at t=0 rather than flooring it away", () => {
    const other = rect(5, 10, -2, 2);
    const hit = nearestOtherAlongRay([5, 0], "right", [
      { id: "self", poly: rect(-5, 5, -3, 3) },
      { id: "other", poly: other },
    ], "self");
    expect(hit).not.toBeNull();
    expect(hit!.point).toEqual([5, 0]);
    expect(hit!.t).toBeCloseTo(0, 9);
  });

  it("skips the excluded id entirely, even if it lies along the ray", () => {
    const hit = nearestOtherAlongRay([0, 0], "right", [
      { id: "self", poly: rect(-5, 5, -3, 3) },
      { id: "self", poly: rect(6, 8, -1, 1) },
    ], "self");
    expect(hit).toBeNull();
  });
});

describe("extremePoint", () => {
  it("picks the first vertex achieving the extremum, deterministically on a tie", () => {
    const box: Pt[] = [[-5, -3], [5, -3], [5, 3], [-5, 3]];
    // Two vertices tie for max y (the top-left and top-right corners) —
    // ring order puts (5,3) first.
    expect(extremePoint([box], "y", "max")).toEqual([5, 3]);
    expect(extremePoint([box], "x", "min")).toEqual([-5, -3]);
  });

  it("considers every ring, not just the first", () => {
    const stamp = rect(-5, 5, -3, 3);
    const scallop = rect(3, 7, -1, 1);
    expect(extremePoint([stamp, scallop], "x", "max")).toEqual([7, -1]);
  });
});

describe("capsuleMidsectionPoints", () => {
  it("builds a rectangle offset by radius perpendicular to the segment", () => {
    const pts = capsuleMidsectionPoints([0, 0], [10, 0], 2);
    expect(pts).toHaveLength(4);
    const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-2, 6);
    expect(ys[3]).toBeCloseTo(2, 6);
  });

  it("returns no points for a degenerate (zero-length) segment", () => {
    expect(capsuleMidsectionPoints([1, 1], [1, 1], 2)).toEqual([]);
  });
});
