import { pointAtArcLength, ringLength, type Pt } from "./perimeter";

/** Tolerance on a travel direction's off-axis component, in units of the
 *  direction vector (which is unit-length): a hole travels "on a horizontal
 *  plane" only when its tangent, after rotation/mirroring, is horizontal in
 *  world space to within this tolerance. */
const AXIS_EPS = 1e-3;

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
  const step = Math.min(0.05, len / 4);
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

export interface FingerAlignCandidate {
  id: string;
  /** Current world position of this tool's finger hole. */
  cx: number;
  cy: number;
  /** Local (stamp-frame) pocket outline the hole's arc position is measured along. */
  ring: Pt[];
  arcMm: number;
  rot: number;
  mirrorX: boolean;
  mirrorY: boolean;
}

export interface FingerAlignPlan {
  axis: "horizontal" | "vertical";
  referenceId: string;
  /** New `finger_hole_arc_mm` per tool id, excluding the reference tool
   *  (which stays put — every other hole aligns to it). */
  updates: Map<string, number>;
}

/** Whether — and how — a selection's finger holes can be aligned onto one
 *  line. Requires at least 2 candidates, all travelling on the same axis (all
 *  horizontal, i.e. holes sitting level in world space, or all vertical,
 *  standing plumb) — a mixed or diagonal group returns null. The reference is
 *  the bottom-most hole (min world Y) for a horizontal group, or the
 *  left-most (min world X) for a vertical one; every other candidate's new
 *  arc-length is a first-order estimate along its own current tangent — exact
 *  on a straight edge (the common case), an approximation through a curved
 *  or rounded-corner section. */
export function computeFingerAlignPlan(candidatesIn: FingerAlignCandidate[]): FingerAlignPlan | null {
  if (candidatesIn.length < 2) return null;

  const dirs = new Map<string, [number, number]>();
  for (const c of candidatesIn) {
    const dir = travelDirection(c.ring, c.arcMm, c.rot, c.mirrorX, c.mirrorY);
    if (!dir) return null;
    dirs.set(c.id, dir);
  }

  const allHorizontal = candidatesIn.every((c) => Math.abs(dirs.get(c.id)![1]) <= AXIS_EPS);
  const allVertical = candidatesIn.every((c) => Math.abs(dirs.get(c.id)![0]) <= AXIS_EPS);
  if (!allHorizontal && !allVertical) return null;
  const axis: "horizontal" | "vertical" = allHorizontal ? "horizontal" : "vertical";

  const reference = axis === "horizontal"
    ? candidatesIn.reduce((best, c) => (c.cy < best.cy ? c : best))
    : candidatesIn.reduce((best, c) => (c.cx < best.cx ? c : best));
  const refCoord = axis === "horizontal" ? reference.cx : reference.cy;

  const updates = new Map<string, number>();
  for (const c of candidatesIn) {
    if (c.id === reference.id) continue;
    const dir = dirs.get(c.id)!;
    const delta = axis === "horizontal" ? refCoord - c.cx : refCoord - c.cy;
    const proj = axis === "horizontal" ? dir[0] * delta : dir[1] * delta;
    updates.set(c.id, c.arcMm + proj);
  }
  return { axis, referenceId: reference.id, updates };
}
