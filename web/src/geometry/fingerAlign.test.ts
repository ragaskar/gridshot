import { describe, expect, it } from "vitest";
import { computeFingerAlignPlan, travelDirection, type FingerAlignCandidate, type FingerAlignPoint } from "./fingerAlign";
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

function point(over: Partial<FingerAlignPoint> = {}): FingerAlignPoint {
  return { cx: 0, cy: 0, ring: RING, arcMm: 5, ...over };
}

function candidate(over: Partial<FingerAlignCandidate> & { id: string }): FingerAlignCandidate {
  return { rot: 0, mirrorX: false, mirrorY: false, p1: point(), ...over };
}

describe("computeFingerAlignPlan — single-point holes (P1 only)", () => {
  it("aligns two bottom-edge tools to the bottom-most one", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", p1: point({ cx: 0, cy: 0 }) }), // bottom-most (min cy) — reference
      candidate({ id: "b", p1: point({ cx: 5, cy: 20 }) }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.axis).toBe("horizontal");
    expect(plan!.referenceId).toBe("a");
    // b's arc must move -5 (dir=(1,0), delta=refX(0)-cx(5)=-5, proj=-5)
    expect(plan!.updates.get("b")!.arc1).toBeCloseTo(0); // arcMm(5) + proj(-5)
    expect(plan!.updates.get("b")!.arc2).toBeUndefined();
    expect(plan!.updates.has("a")).toBe(false);
  });

  it("returns null for a mixed horizontal/vertical group", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", p1: point({ arcMm: 5, cx: 0, cy: 20 }) }), // bottom edge → horizontal
      candidate({ id: "b", p1: point({ arcMm: 12, cx: 5, cy: 0 }) }), // right edge → vertical
    ]);
    expect(plan).toBeNull();
  });

  it("returns null with fewer than two candidates", () => {
    expect(computeFingerAlignPlan([candidate({ id: "a" })])).toBeNull();
  });

  it("aligns a vertical (right-edge) group to the left-most tool", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", p1: point({ arcMm: 12, cx: 0, cy: 0 }) }), // left-most (min cx) — reference
      candidate({ id: "b", p1: point({ arcMm: 12, cx: 20, cy: 10 }) }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.axis).toBe("vertical");
    expect(plan!.referenceId).toBe("a");
    // dir=(0,1); delta = refY(0) - cy(10) = -10; proj = -10
    expect(plan!.updates.get("b")!.arc1).toBeCloseTo(2); // arcMm(12) + proj(-10)
  });

  it("handles a 180°-rotated tool's sign flip correctly", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", p1: point({ cx: 0, cy: 0 }) }), // reference, rot 0
      candidate({ id: "b", p1: point({ cx: 5, cy: 20 }), rot: 180 }),
    ]);
    expect(plan).not.toBeNull();
    // dir=(-1,0), delta = refX(0) - cx(5) = -5, proj = -1 * -5 = 5
    expect(plan!.updates.get("b")!.arc1).toBeCloseTo(10); // arcMm(5) + proj(5)
  });
});

describe("computeFingerAlignPlan — mixed single-point/span holes", () => {
  // All four candidates below sit on the bottom edge (a horizontal group) —
  // p2, when present, also sits on the bottom edge (still arc in [0,10)) so
  // every point stays on-axis and only cx/cy differ per case.

  it("single-point target under a single-point reference: only arc1", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "ref", p1: point({ cx: 0, cy: 0 }) }), // reference (bottom-most)
      candidate({ id: "tgt", p1: point({ cx: 5, cy: 20 }) }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.updates.get("tgt")!.arc1).toBeCloseTo(0);
    expect(plan!.updates.get("tgt")!.arc2).toBeUndefined();
  });

  it("span target under a single-point reference: only arc1 moves, arc2 untouched", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "ref", p1: point({ cx: 0, cy: 0 }) }), // single-point reference
      candidate({
        id: "tgt",
        p1: point({ cx: 5, cy: 20 }),
        p2: point({ cx: 6, cy: 20, arcMm: 6 }),
      }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.updates.get("tgt")!.arc1).toBeCloseTo(0); // arcMm(5) + (0-5)
    expect(plan!.updates.get("tgt")!.arc2).toBeUndefined();
  });

  it("single-point target under a span reference: aligns to the reference's P1 only", () => {
    const plan = computeFingerAlignPlan([
      candidate({
        id: "ref",
        p1: point({ cx: 0, cy: 0 }),
        p2: point({ cx: 1, cy: 0, arcMm: 6 }),
      }), // span reference (bottom-most by P1)
      candidate({ id: "tgt", p1: point({ cx: 5, cy: 20 }) }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.referenceId).toBe("ref");
    expect(plan!.updates.get("tgt")!.arc1).toBeCloseTo(0); // aligns to ref's P1 (cx=0)
    expect(plan!.updates.get("tgt")!.arc2).toBeUndefined();
  });

  it("span target under a span reference: arc1 aligns to ref P1, arc2 aligns to ref P2 independently", () => {
    const plan = computeFingerAlignPlan([
      candidate({
        id: "ref",
        p1: point({ cx: 0, cy: 0 }),
        p2: point({ cx: 2, cy: 0, arcMm: 6 }),
      }), // span reference
      candidate({
        id: "tgt",
        p1: point({ cx: 5, cy: 20 }),
        p2: point({ cx: 9, cy: 20, arcMm: 7 }),
      }),
    ]);
    expect(plan).not.toBeNull();
    // P1: dir=(1,0), delta = refP1.cx(0) - tgt.p1.cx(5) = -5, proj=-5 → arcMm(5)-5=0
    expect(plan!.updates.get("tgt")!.arc1).toBeCloseTo(0);
    // P2: dir=(1,0), delta = refP2.cx(2) - tgt.p2.cx(9) = -7, proj=-7 → arcMm(7)-7=0
    expect(plan!.updates.get("tgt")!.arc2).toBeCloseTo(0);
  });

  it("a span hole's curved/off-axis P2 disables the whole plan, even though P1 is on-axis", () => {
    const plan = computeFingerAlignPlan([
      candidate({ id: "ref", p1: point({ cx: 0, cy: 0 }) }),
      candidate({
        id: "tgt",
        p1: point({ cx: 5, cy: 20 }), // on-axis (bottom edge)
        p2: point({ cx: 5, cy: 20, arcMm: 12 }), // right edge → vertical travel
      }),
    ]);
    expect(plan).toBeNull();
  });
});
