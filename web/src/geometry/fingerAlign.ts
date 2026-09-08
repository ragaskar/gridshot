import { pointAtArcLength, ringLength, type Pt } from "./perimeter";

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
const TANGENT_PROBE_MM = 2.0;

/** Tolerance on a travel direction's off-axis component, in units of the
 *  direction vector (which is unit-length): a hole travels "on a horizontal
 *  plane" only when its tangent, after rotation/mirroring, is horizontal in
 *  world space to within this tolerance.
 *
 *  Sized from a synthetic model, not measured real captures: 500 seeded
 *  random rings with vertices independently perturbed by up to
 *  SIMPLIFY_TOL_MM off a straight line (see fingerAlign.test.ts) put the
 *  worst observed residual at `TANGENT_PROBE_MM`=2mm at ~0.047 — this gives
 *  that roughly 2x headroom. It's still far tighter than any genuine curve
 *  or rounded corner, whose tangent swings by tens of degrees over the same
 *  probe distance. If this turns out to reject (or wrongly accept) real
 *  traced outlines, that's the number to revisit against actual capture
 *  data, not this synthetic model. */
const AXIS_EPS = 0.1;

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

/** A candidate's own along-axis/perpendicular-to-axis coordinate pair for
 *  the given alignment axis: "along" is the coordinate every point in the
 *  group can actually slide to (x for a horizontal — travelling-along-x —
 *  group, y for a vertical one); "perp" is the other one, used only to break
 *  ties when picking a reference. */
function axisCoords(axis: "horizontal" | "vertical", p: FingerAlignPoint): { along: number; perp: number } {
  return axis === "horizontal" ? { along: p.cx, perp: p.cy } : { along: p.cy, perp: p.cx };
}

/** A hole's own center along the alignment axis — the single point every
 *  other computation below anchors to. For a single-point hole that's just
 *  P1; for a span hole it's the midpoint of P1 and P2. Consulting *only*
 *  this (never P1 alone, never a same-numbered P1↔P1/P2↔P2 pairing) is what
 *  keeps alignment correct across a mirrored tool: mirroring a span hole can
 *  swap which of its two lobes ended up recorded as P1 vs P2 (that's decided
 *  by interaction history, not by any geometric convention mirroring
 *  respects), so treating "P1" as meaningfully different from "P2" pairs the
 *  wrong lobes across a mirrored/unmirrored pair — the hole's center has no
 *  such ambiguity. */
function holeCenter(axis: "horizontal" | "vertical", p1: FingerAlignPoint, p2?: FingerAlignPoint): { along: number; perp: number } {
  const a = axisCoords(axis, p1);
  if (!p2) return a;
  const b = axisCoords(axis, p2);
  return { along: (a.along + b.along) / 2, perp: (a.perp + b.perp) / 2 };
}

/** Whether — and how — a selection's finger holes can be aligned onto one
 *  line. Requires at least 2 candidates, with *every* focal point present in
 *  the selection — both P1 and P2 of every span hole — travelling on the
 *  same axis (all horizontal, i.e. holes sitting level in world space, or
 *  all vertical, standing plumb): a mixed or diagonal group, or one hole
 *  with a curved/rounded-corner point, returns null.
 *
 *  The reference is the candidate whose own **center** (see `holeCenter`) is
 *  bottom-most (min world Y) for a horizontal group, or left-most (min world
 *  X) for a vertical one. Every other candidate's whole hole — P1, and P2
 *  too when it has one — slides by the single delta that moves *its own*
 *  center onto the reference's center's along-axis coordinate, each point
 *  via its own current tangent. A span hole's P1-to-P2 arc gap (and hence
 *  its width) is therefore preserved by construction, rather than each point
 *  separately chasing a same-numbered reference point regardless of how far
 *  apart the two holes' own widths are — the previous approach, which could
 *  even collapse a target span hole's two lobes onto the same point when its
 *  width didn't match the reference's. Each new position is a first-order
 *  estimate along the point's own current tangent — exact on a straight edge
 *  (the common case), an approximation through a curved or rounded-corner
 *  stretch of the outline; a large enough shift can walk a point past its
 *  starting edge onto another one, same as before this function's rewrite. */
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

  const reference = candidatesIn.reduce((best, c) => (
    holeCenter(axis, c.p1, c.p2).perp < holeCenter(axis, best.p1, best.p2).perp ? c : best
  ));
  const refAlong = holeCenter(axis, reference.p1, reference.p2).along;

  const updates = new Map<string, FingerAlignUpdate>();
  for (const c of candidatesIn) {
    if (c.id === reference.id) continue;
    const delta = refAlong - holeCenter(axis, c.p1, c.p2).along;

    const d1 = dir1.get(c.id)!;
    const proj1 = axis === "horizontal" ? d1[0] * delta : d1[1] * delta;
    const update: FingerAlignUpdate = { arc1: c.p1.arcMm + proj1 };

    if (c.p2) {
      const d2 = dir2.get(c.id)!;
      const proj2 = axis === "horizontal" ? d2[0] * delta : d2[1] * delta;
      update.arc2 = c.p2.arcMm + proj2;
    }
    updates.set(c.id, update);
  }
  return { axis, referenceId: reference.id, updates };
}
