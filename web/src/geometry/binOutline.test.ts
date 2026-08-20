import { describe, expect, it } from "vitest";
import { binOutlinePath, cellKey, isShapeConnected } from "./binOutline";

const countOccurrences = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const subpathCount = (d: string) => countOccurrences(d, /M /g);
const arcCount = (d: string) => countOccurrences(d, / A /g);
const sweepFlags = (d: string): number[] =>
  [...d.matchAll(/A [\d.]+ [\d.]+ 0 0 (\d)/g)].map((m) => Number(m[1]));

describe("isShapeConnected", () => {
  it("is true for the full grid", () => {
    expect(isShapeConnected(2, 2, new Set())).toBe(true);
  });

  it("is true for an L-shape (one corner removed)", () => {
    expect(isShapeConnected(2, 2, new Set([cellKey(0, 0)]))).toBe(true);
  });

  it("is true for a ring (a hole in the middle is still one piece)", () => {
    expect(isShapeConnected(3, 3, new Set([cellKey(1, 1)]))).toBe(true);
  });

  it("is false for two cells touching only at a corner", () => {
    expect(isShapeConnected(2, 2, new Set([cellKey(1, 0), cellKey(0, 1)]))).toBe(false);
  });

  it("is false for an empty shape", () => {
    expect(isShapeConnected(2, 2, new Set([cellKey(0, 0), cellKey(1, 0), cellKey(0, 1), cellKey(1, 1)]))).toBe(false);
  });
});

describe("binOutlinePath", () => {
  const params = { gx: 2, gy: 2, pitch: 42, cornerR: 3.75 };

  it("traces a full rectangle as one loop with 4 corners, all the same turn direction", () => {
    const d = binOutlinePath(params, new Set());
    expect(subpathCount(d)).toBe(1);
    expect(arcCount(d)).toBe(4);
    const sweeps = sweepFlags(d);
    expect(new Set(sweeps).size).toBe(1); // all 4 corners convex → same sweep
  });

  it("traces an L-shape as one loop with 6 corners, 5 convex + 1 concave", () => {
    const d = binOutlinePath(params, new Set([cellKey(0, 0)]));
    expect(subpathCount(d)).toBe(1);
    expect(arcCount(d)).toBe(6);
    const sweeps = sweepFlags(d);
    const counts = new Map<number, number>();
    for (const s of sweeps) counts.set(s, (counts.get(s) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([1, 5]);
  });

  it("traces a ring as two loops (outer + hole), the hole's corners opposite the outer's", () => {
    const d = binOutlinePath({ gx: 3, gy: 3, pitch: 42, cornerR: 3.75 }, new Set([cellKey(1, 1)]));
    expect(subpathCount(d)).toBe(2);
    expect(arcCount(d)).toBe(8);
    const subpaths = d.split(/(?=M )/).filter(Boolean);
    expect(subpaths).toHaveLength(2);
    const [outerSweeps, innerSweeps] = subpaths.map(sweepFlags);
    expect(new Set(outerSweeps).size).toBe(1);
    expect(new Set(innerSweeps).size).toBe(1);
    expect(outerSweeps[0]).not.toBe(innerSweeps[0]);
  });

  it("returns an empty string for a fully-removed grid", () => {
    const d = binOutlinePath(params, new Set([cellKey(0, 0), cellKey(1, 0), cellKey(0, 1), cellKey(1, 1)]));
    expect(d).toBe("");
  });
});
