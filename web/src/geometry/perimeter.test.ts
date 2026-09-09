import { describe, expect, it } from "vitest";
import {
  fingerHoleRectPoints,
  nearestArcLength, outwardNormalAtArcLength, pointAtArcLength, ringLength, wrapArcLength, type Pt,
} from "./perimeter";

// 10x4 rectangle, perimeter 28, starting bottom-left going CCW.
const RECT: Pt[] = [[-5, -2], [5, -2], [5, 2], [-5, 2]];

describe("ringLength", () => {
  it("sums the closed perimeter, including the wrap-around edge", () => {
    expect(ringLength(RECT)).toBeCloseTo(28);
  });

  it("is 0 for fewer than two points", () => {
    expect(ringLength([[0, 0]])).toBe(0);
    expect(ringLength([])).toBe(0);
  });
});

describe("pointAtArcLength", () => {
  it("returns the first vertex at arc 0", () => {
    expect(pointAtArcLength(RECT, 0)).toEqual([-5, -2]);
  });

  it("interpolates along the first edge", () => {
    const [x, y] = pointAtArcLength(RECT, 3);
    expect(x).toBeCloseTo(-2);
    expect(y).toBeCloseTo(-2);
  });

  it("lands exactly on a vertex at an edge boundary", () => {
    expect(pointAtArcLength(RECT, 10)).toEqual([5, -2]);
  });

  it("continues onto the second edge", () => {
    const [x, y] = pointAtArcLength(RECT, 12);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(0);
  });

  it("clamps a value past the perimeter (or negative) to the first vertex", () => {
    expect(pointAtArcLength(RECT, 1000)).toEqual([-5, -2]);
    expect(pointAtArcLength(RECT, -5)).toEqual([-5, -2]);
  });
});

describe("nearestArcLength", () => {
  it("is the inverse of pointAtArcLength for a point on the boundary", () => {
    const arc = 12;
    const point = pointAtArcLength(RECT, arc);
    expect(nearestArcLength(RECT, point)).toBeCloseTo(arc);
  });

  it("projects an interior point onto its nearest edge", () => {
    // (0, -1.9) is just inside the bottom edge, close to arc 5.
    expect(nearestArcLength(RECT, [0, -1.9])).toBeCloseTo(5);
  });

  it("is 0 for fewer than two points", () => {
    expect(nearestArcLength([[1, 1]], [0, 0])).toBe(0);
  });
});

describe("wrapArcLength", () => {
  it("leaves an in-range value unchanged", () => {
    expect(wrapArcLength(RECT, 10)).toBeCloseTo(10);
  });

  it("wraps a value past the perimeter", () => {
    expect(wrapArcLength(RECT, 30)).toBeCloseTo(2);
  });

  it("wraps a negative value back into range", () => {
    expect(wrapArcLength(RECT, -5)).toBeCloseTo(23);
  });

  it("is 0 for a degenerate ring", () => {
    expect(wrapArcLength([[0, 0]], 5)).toBe(0);
  });
});

describe("outwardNormalAtArcLength", () => {
  it("points straight down off the bottom edge", () => {
    expect(outwardNormalAtArcLength(RECT, 0)).toEqual([0, -1]);
  });

  it("points straight right off the right edge", () => {
    const [nx, ny] = outwardNormalAtArcLength(RECT, 12);
    expect(nx).toBeCloseTo(1);
    expect(ny).toBeCloseTo(0);
  });

  it("points straight up off the top edge", () => {
    const [nx, ny] = outwardNormalAtArcLength(RECT, 19);
    expect(nx).toBeCloseTo(0);
    expect(ny).toBeCloseTo(1);
  });

  it("points straight left off the left edge", () => {
    const [nx, ny] = outwardNormalAtArcLength(RECT, 26);
    expect(nx).toBeCloseTo(-1);
    expect(ny).toBeCloseTo(0);
  });

  it("is [0, 0] for fewer than two points", () => {
    expect(outwardNormalAtArcLength([[1, 1]], 0)).toEqual([0, 0]);
  });
});

describe("fingerHoleRectPoints", () => {
  // A 20x10 rect, perimeter 60: bottom edge arc [0,20) at y=-5, right
  // [20,30), top [30,50), left [50,60) — same convention as
  // CombineEditor.fingerHole.test.tsx's own STAMP. These two cases' expected
  // bounding boxes are hand-derived (not just re-derived from the function
  // under test) and independently re-derived in Python against
  // derive._finger_hole_shape_polygon in test_finger_hole_shape.py's
  // TestFrontendBackendLockstep — the two are "kept in exact lockstep" per
  // this module's own header; a regression in either implementation alone
  // breaks only that language's copy of these numbers.
  const WIDE_RECT: Pt[] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

  function bounds(points: Pt[]) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    return { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
  }

  it("on the bottom edge (tangent along +x), length spans x and width spans y", () => {
    const points = fingerHoleRectPoints(WIDE_RECT, 10, 16, 10, 2);
    const b = bounds(points);
    expect(b.minx).toBeCloseTo(-8);
    expect(b.maxx).toBeCloseTo(8);
    expect(b.miny).toBeCloseTo(-10);
    expect(b.maxy).toBeCloseTo(0);
  });

  it("on the right edge (tangent along +y), length spans y and width spans x — a genuine 90° rotation", () => {
    const points = fingerHoleRectPoints(WIDE_RECT, 25, 16, 10, 2);
    const b = bounds(points);
    expect(b.minx).toBeCloseTo(5);
    expect(b.maxx).toBeCloseTo(15);
    expect(b.miny).toBeCloseTo(-8);
    expect(b.maxy).toBeCloseTo(8);
  });

  it("degrades to a plain (unrounded) rectangle when the corner radius is ~0", () => {
    const points = fingerHoleRectPoints(WIDE_RECT, 10, 16, 10, 0);
    expect(points).toHaveLength(4);
  });
});
