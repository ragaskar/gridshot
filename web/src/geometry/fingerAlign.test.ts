import { describe, expect, it } from "vitest";
import { computeFingerAlignPlan, travelDirection, type FingerAlignCandidate, type FingerAlignPoint } from "./fingerAlign";
import { nearestArcLength, type Pt } from "./perimeter";

// 10x4 rectangle: bottom edge arc [0,10), right edge [10,14), top [14,24), left [24,28).
const RING: Pt[] = [[-5, -2], [5, -2], [5, 2], [-5, 2]];

// A rectangle whose bottom edge isn't one straight segment but a dense run of
// short ones, each vertex independently perturbed off the true straight line
// by up to SIMPLIFY_TOL_MM (0.05mm — gridshot/core/contour.py's Douglas-
// Peucker tolerance for a traced tool outline): simplification only
// guarantees each vertex sits within that tolerance of the true edge, not
// that consecutive vertices are collinear with it, so a real captured tool's
// "straight" edges look exactly like this close up. Deterministic (seeded),
// so a specific seed can pin down a known-bad case reproducibly.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function noisyRing(seed: number): Pt[] {
  const rnd = mulberry32(seed);
  const pts: Pt[] = [[-10, -5]];
  const step = 0.02; // mm — well under the 0.05mm tolerance above
  const tol = 0.05; // mm — SIMPLIFY_TOL_MM
  for (let x = -4; x <= 4 + 1e-9; x += step) {
    pts.push([x, -5 + (rnd() * 2 - 1) * tol]);
  }
  pts.push([10, -5], [10, 5], [-10, 5]);
  return pts;
}

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

  it("still reads as ~horizontal on a real-world-noisy edge (worst of 500 seeded trials)", () => {
    // Seed 314 is the worst of 500 tried against TANGENT_PROBE_MM=2 (residual
    // ~0.047 — see AXIS_EPS's comment) — not ~0, since per-vertex noise this
    // size doesn't fully average out, but it must clear AXIS_EPS with margin.
    const ring = noisyRing(314);
    const arc = nearestArcLength(ring, [0, -5]); // the noisy run's own midpoint
    const [, y] = travelDirection(ring, arc, 0)!;
    expect(Math.abs(y)).toBeLessThan(0.1);
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

  it("two holes on real-world-noisy bottom edges still align", () => {
    const ringA = noisyRing(314); // the worst-case seed above
    const ringB = noisyRing(1);
    const arcA = nearestArcLength(ringA, [0, -5]);
    const arcB = nearestArcLength(ringB, [0, -5]);
    const plan = computeFingerAlignPlan([
      candidate({ id: "a", p1: point({ ring: ringA, arcMm: arcA, cx: 0, cy: 0 }) }),
      candidate({ id: "b", p1: point({ ring: ringB, arcMm: arcB, cx: 5, cy: 20 }) }),
    ]);
    expect(plan).not.toBeNull();
  });
});
