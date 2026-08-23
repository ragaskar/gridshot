import { pointAtArcLength, ringLength, type Pt } from "./perimeter";

/** Tolerance on a travel direction's off-axis component, in units of the
 *  direction vector (which is unit-length): a hole travels "on a horizontal
 *  plane" only when its tangent, after rotation/mirroring, is horizontal in
 *  world space to within this tolerance.
 *
 *  Loose enough (~3°) to absorb simplify-tolerance-scale noise surviving
 *  `TANGENT_PROBE_MM`'s averaging (measured up to ~0.036 on an adversarial
 *  worst-case zigzag — see fingerAlign.test.ts), while staying far tighter
 *  than any genuine curve or rounded corner, whose tangent swings by tens of
 *  degrees over the same probe distance. */
const AXIS_EPS = 0.05;

/** How far either side of the current arc position to probe for the local
 *  tangent — must clear `SIMPLIFY_TOL_MM` (gridshot/core/contour.py, 0.05mm)
 *  by a wide margin. A traced tool outline is Douglas-Peucker-simplified to
 *  that tolerance, which only bounds each vertex's deviation from the true
 *  edge, not that consecutive vertices are collinear — so a genuinely
 *  straight edge is still a zigzag of short segments at that scale, each
 *  with its own, often steep, local slope. Probing at (or near) the noise
 *  floor mostly measures that noise; this needs to be large enough to
 *  average it out on any real edge, while staying well under typical pocket
 *  dimensions (tens of mm) so it doesn't blend across a genuine corner. */
const TANGENT_PROBE_MM = 1.0;

/** World-space unit direction a hole travels in as its arc-length position
 *  increases, for a tool with the given local pocket ring, world rotation,
 *  and mirror flags — the ring's own tangent at the current arc position,
 *  found numerically (a small step either side, in local/stamp space), then
 *  mirrored and rotated into world space exactly like `placed()` does for
 *  any other local point. Null for a degenerate (near-zero-length) ring. */
export function travelDirection(
  ring: Pt[], arcMm: number, rotDeg: number, mirrorX = false, mirrorY = false,
): [number, number] | null {
  const len = ringLength(ring);
  if (len < 1e-6) return null;
  const step = Math.min(TANGENT_PROBE_MM, len / 4);
  const [ax, ay] = pointAtArcLength(ring, arcMm - step);
  const [bx, by] = pointAtArcLength(ring, arcMm + step);
  let dx = bx - ax, dy = by - ay;
  if (mirrorX) dx = -dx;
  if (mirrorY) dy = -dy;
  const rad = (rotDeg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const wx = dx * c - dy * s, wy = dx * s + dy * c;
  const mag = Math.hypot(wx, wy);
  return mag < 1e-9 ? null : [wx / mag, wy / mag];
}

/** One finger-hole focal point's current world position and the local
 *  (stamp-frame) arc-length state needed to slide it further along its own
 *  outline. */
export interface FingerAlignPoint {
  cx: number;
  cy: number;
  ring: Pt[];
  arcMm: number;
}

export interface FingerAlignCandidate {
  id: string;
  rot: number;
  mirrorX: boolean;
  mirrorY: boolean;
  /** The hole's first (and, for a single-point hole, only) focal point. */
  p1: FingerAlignPoint;
  /** Present only for a span hole. */
  p2?: FingerAlignPoint;
}

export interface FingerAlignUpdate {
  arc1?: number;
  arc2?: number;
}

export interface FingerAlignPlan {
  axis: "horizontal" | "vertical";
  referenceId: string;
  /** New arc-length(s) per tool id, excluding the reference tool (which
   *  stays put — every other hole aligns to it). `arc2` is present only when
   *  the reference itself is a span hole *and* the target has a second point
   *  to move — a span target under a single-point reference only gets
   *  `arc1`, its own P2 left untouched. */
  updates: Map<string, FingerAlignUpdate>;
}

/** Whether — and how — a selection's finger holes can be aligned onto one
 *  line (or, for a span reference, one line per focal point). Requires at
 *  least 2 candidates, with *every* focal point present in the selection —
 *  both P1 and P2 of every span hole — travelling on the same axis (all
 *  horizontal, i.e. holes sitting level in world space, or all vertical,
 *  standing plumb): a mixed or diagonal group, or one hole with a curved/
 *  rounded-corner point, returns null.
 *
 *  The reference is the candidate whose **P1** is bottom-most (min world Y)
 *  for a horizontal group, or left-most (min world X) for a vertical one —
 *  span or not, only P1 is consulted to pick it. Every other candidate's P1
 *  slides to line up with the reference's P1. If the reference is itself a
 *  span hole, every other *span* candidate's P2 additionally slides to line
 *  up with the reference's P2 — a single-point candidate has no P2 to move,
 *  and a span candidate under a single-point reference only gets its P1
 *  moved (there's no reference P2 to align to). Each new position is a
 *  first-order estimate along the point's own current tangent — exact on a
 *  straight edge (the common case), an approximation through a curved or
 *  rounded-corner stretch of the outline. */
export function computeFingerAlignPlan(candidatesIn: FingerAlignCandidate[]): FingerAlignPlan | null {
  if (candidatesIn.length < 2) return null;

  const dir1 = new Map<string, [number, number]>();
  const dir2 = new Map<string, [number, number]>();
  const allDirs: [number, number][] = [];
  for (const c of candidatesIn) {
    const d1 = travelDirection(c.p1.ring, c.p1.arcMm, c.rot, c.mirrorX, c.mirrorY);
    if (!d1) return null;
    dir1.set(c.id, d1);
    allDirs.push(d1);
    if (c.p2) {
      const d2 = travelDirection(c.p2.ring, c.p2.arcMm, c.rot, c.mirrorX, c.mirrorY);
      if (!d2) return null;
      dir2.set(c.id, d2);
      allDirs.push(d2);
    }
  }

  const allHorizontal = allDirs.every(([, y]) => Math.abs(y) <= AXIS_EPS);
  const allVertical = allDirs.every(([x]) => Math.abs(x) <= AXIS_EPS);
  if (!allHorizontal && !allVertical) return null;
  const axis: "horizontal" | "vertical" = allHorizontal ? "horizontal" : "vertical";

  const reference = axis === "horizontal"
    ? candidatesIn.reduce((best, c) => (c.p1.cy < best.p1.cy ? c : best))
    : candidatesIn.reduce((best, c) => (c.p1.cx < best.p1.cx ? c : best));
  const refCoord1 = axis === "horizontal" ? reference.p1.cx : reference.p1.cy;
  const refCoord2 = reference.p2 ? (axis === "horizontal" ? reference.p2.cx : reference.p2.cy) : null;

  const updates = new Map<string, FingerAlignUpdate>();
  for (const c of candidatesIn) {
    if (c.id === reference.id) continue;
    const d1 = dir1.get(c.id)!;
    const delta1 = axis === "horizontal" ? refCoord1 - c.p1.cx : refCoord1 - c.p1.cy;
    const proj1 = axis === "horizontal" ? d1[0] * delta1 : d1[1] * delta1;
    const update: FingerAlignUpdate = { arc1: c.p1.arcMm + proj1 };

    if (refCoord2 !== null && c.p2) {
      const d2 = dir2.get(c.id)!;
      const delta2 = axis === "horizontal" ? refCoord2 - c.p2.cx : refCoord2 - c.p2.cy;
      const proj2 = axis === "horizontal" ? d2[0] * delta2 : d2[1] * delta2;
      update.arc2 = c.p2.arcMm + proj2;
    }
    updates.set(c.id, update);
  }
  return { axis, referenceId: reference.id, updates };
}
