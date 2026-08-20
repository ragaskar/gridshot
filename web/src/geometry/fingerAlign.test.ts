import { describe, expect, it } from "vitest";
import { computeFingerAlignPlan, travelDirection, type FingerAlignCandidate } from "./fingerAlign";

describe("travelDirection", () => {
  it("top/bottom holes travel along world X at rotation 0", () => {
    expect(travelDirection("bottom", 0)).toEqual([1, 0]);
    expect(travelDirection("top", 0)).toEqual([1, 0]);
  });

  it("left/right holes travel along world Y at rotation 0", () => {
    expect(travelDirection("left", 0)).toEqual([0, 1]);
  });

  it("flips sign at 180 degrees but stays on the same axis", () => {
    const [x, y] = travelDirection("bottom", 180)!;
    expect(x).toBeCloseTo(-1);
    expect(y).toBeCloseTo(0);
  });

  it("swaps axis at 90 degrees", () => {
    const [x, y] = travelDirection("bottom", 90)!;
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
  });

  it("returns null for a center-fallback side", () => {
    expect(travelDirection("center", 0)).toBeNull();
  });
});

function candidate(over: Partial<FingerAlignCandidate> & { id: string }): FingerAlignCandidate {
  return { cx: 0, cy: 0, side: "bottom", rot: 0, offset: 0, offsetMax: 10, ...over };
}

describe("computeFingerAlignPlan", () => {
  it("aligns two bottom-side tools to the bottom-most one", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", cx: 0, cy: 20, offset: 0 }), // bottom-most (max cy) — reference
      candidate({ id: "b", cx: 5, cy: 0, offset: 0 }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.axis).toBe("horizontal");
    expect(plan!.referenceId).toBe("a");
    // b's hole must move +5 in world X (from cx=5 to refX=0 means delta -5,
    // dir=(1,0) so proj = 1*(0-5) = -5 → new offset -5)
    expect(plan!.updates.get("b")).toBeCloseTo(-5);
    expect(plan!.updates.has("a")).toBe(false);
  });

  it("returns null when a candidate's required offset exceeds its max", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", cx: 0, cy: 20 }),
      candidate({ id: "b", cx: 100, cy: 0, offsetMax: 5 }),
    ]);
    expect(plan).toBeNull();
  });

  it("returns null for a mixed horizontal/vertical group", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", side: "bottom", cx: 0, cy: 20 }),
      candidate({ id: "b", side: "left", cx: 5, cy: 0 }),
    ]);
    expect(plan).toBeNull();
  });

  it("returns null with fewer than two eligible candidates", () => {
    expect(computeFingerAlignPlan([candidate({ id: "a" })])).toBeNull();
  });

  it("excludes a center-side tool rather than blocking the rest of the group", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", cx: 0, cy: 20 }),
      candidate({ id: "b", cx: 5, cy: 0 }),
      candidate({ id: "c", side: "center", cx: 999, cy: 999 }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.updates.has("c")).toBe(false);
  });

  it("aligns a vertical (left/right) group to the left-most tool", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", side: "left", cx: 0, cy: 0 }), // left-most (min cx) — reference
      candidate({ id: "b", side: "right", cx: 20, cy: 10 }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.axis).toBe("vertical");
    expect(plan!.referenceId).toBe("a");
    // b's dir at rot 0 for "right" is (0,1); delta = refCoord(0) - cy(10) = -10
    expect(plan!.updates.get("b")).toBeCloseTo(-10);
  });

  it("handles a 180°-rotated tool's sign flip correctly", () => {
    // "bottom" side at rot=180 travels along world (-1, 0): moving its hole
    // to world X = refX still resolves via the dot product regardless of sign.
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", cx: 0, cy: 20 }), // reference, rot 0
      candidate({ id: "b", cx: 5, cy: 0, rot: 180 }),
    ]);
    expect(plan).not.toBeNull();
    // dir=(-1,0), delta = refX(0) - cx(5) = -5, proj = -1 * -5 = 5
    expect(plan!.updates.get("b")).toBeCloseTo(5);
  });
});
