import { describe, expect, it } from "vitest";
import { placed, placedPoint, type Pt } from "./placement";

describe("placed", () => {
  it("translates an unrotated, unmirrored stamp by (tx, ty)", () => {
    const stamp: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    expect(placed(stamp, 5, 10, 0)).toEqual([[4, 9], [6, 9], [6, 11], [4, 11]]);
  });

  it("rotates CCW about the origin before translating", () => {
    const stamp: Pt[] = [[1, 0]];
    const [[x, y]] = placed(stamp, 0, 0, 90);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
  });

  it("mirrors about the local axes before rotation, independent of rotation", () => {
    const stamp: Pt[] = [[3, 1]];
    expect(placed(stamp, 0, 0, 0, true, false)).toEqual([[-3, 1]]);
    expect(placed(stamp, 0, 0, 0, false, true)).toEqual([[3, -1]]);
    expect(placed(stamp, 0, 0, 0, true, true)).toEqual([[-3, -1]]);
  });

  it("composes mirror, rotation, and translation in one call", () => {
    const stamp: Pt[] = [[2, 0]];
    const [[x, y]] = placed(stamp, 100, 200, 90, true, false);
    // mirror_x: (2,0) -> (-2,0); rotate 90 CCW: (-2,0) -> (0,-2); translate: (100,198)
    expect(x).toBeCloseTo(100, 6);
    expect(y).toBeCloseTo(198, 6);
  });
});

describe("placedPoint", () => {
  it("matches placed() on a single-point stamp", () => {
    const point: Pt = [1, 2];
    expect(placedPoint(point, 5, -5, 180)).toEqual(placed([point], 5, -5, 180)[0]);
  });
});
