import { describe, expect, it } from "vitest";
import { computeFingerAlignPlan, travelDirection, type FingerAlignCandidate } from "./fingerAlign";
import type { Pt } from "./perimeter";

// 10x4 rectangle: bottom edge arc [0,10), right edge [10,14), top [14,24), left [24,28).
const RING: Pt[] = [[-5, -2], [5, -2], [5, 2], [-5, 2]];

describe("travelDirection", () => {
  it("travels along world +X on the bottom edge at rotation 0", () => {
    const [x, y] = travelDirection(RING, 5, 0)!;
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
  });

  it("travels along world +Y on the right edge at rotation 0", () => {
    const [x, y] = travelDirection(RING, 12, 0)!;
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
  });

  it("flips sign at 180 degrees but stays on the same axis", () => {
    const [x, y] = travelDirection(RING, 5, 180)!;
    expect(x).toBeCloseTo(-1);
    expect(y).toBeCloseTo(0);
  });

  it("swaps axis at 90 degrees", () => {
    const [x, y] = travelDirection(RING, 5, 90)!;
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
  });

  it("flips with mirror_x, independent of rotation", () => {
    const [x, y] = travelDirection(RING, 5, 0, true, false)!;
    expect(x).toBeCloseTo(-1);
    expect(y).toBeCloseTo(0);
  });

  it("returns null for a degenerate ring", () => {
    expect(travelDirection([[0, 0]], 0, 0)).toBeNull();
  });
});

function candidate(over: Partial<FingerAlignCandidate> & { id: string }): FingerAlignCandidate {
  return { cx: 0, cy: 0, ring: RING, arcMm: 5, rot: 0, mirrorX: false, mirrorY: false, ...over };
}

describe("computeFingerAlignPlan", () => {
  it("aligns two bottom-edge tools to the bottom-most one", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", cx: 0, cy: 0 }), // bottom-most (min cy) — reference
      candidate({ id: "b", cx: 5, cy: 20 }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.axis).toBe("horizontal");
    expect(plan!.referenceId).toBe("a");
    // b's arc must move -5 (dir=(1,0), delta=refX(0)-cx(5)=-5, proj=-5)
    expect(plan!.updates.get("b")).toBeCloseTo(0); // arcMm(5) + proj(-5)
    expect(plan!.updates.has("a")).toBe(false);
  });

  it("returns null for a mixed horizontal/vertical group", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", arcMm: 5, cx: 0, cy: 20 }), // bottom edge → horizontal
      candidate({ id: "b", arcMm: 12, cx: 5, cy: 0 }), // right edge → vertical
    ]);
    expect(plan).toBeNull();
  });

  it("returns null with fewer than two candidates", () => {
    expect(computeFingerAlignPlan([candidate({ id: "a" })])).toBeNull();
  });

  it("aligns a vertical (right-edge) group to the left-most tool", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", arcMm: 12, cx: 0, cy: 0 }), // left-most (min cx) — reference
      candidate({ id: "b", arcMm: 12, cx: 20, cy: 10 }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.axis).toBe("vertical");
    expect(plan!.referenceId).toBe("a");
    // dir=(0,1); delta = refY(0) - cy(10) = -10; proj = -10
    expect(plan!.updates.get("b")).toBeCloseTo(2); // arcMm(12) + proj(-10)
  });

  it("handles a 180°-rotated tool's sign flip correctly", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", cx: 0, cy: 0 }), // reference, rot 0
      candidate({ id: "b", cx: 5, cy: 20, rot: 180 }),
    ]);
    expect(plan).not.toBeNull();
    // dir=(-1,0), delta = refX(0) - cx(5) = -5, proj = -1 * -5 = 5
    expect(plan!.updates.get("b")).toBeCloseTo(10); // arcMm(5) + proj(5)
  });
});
