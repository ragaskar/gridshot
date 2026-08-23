import { describe, expect, it } from "vitest";
import { nearestArcLength, pointAtArcLength, ringLength, wrapArcLength, type Pt } from "./perimeter";

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
