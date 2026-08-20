import type { FingerHoleSide } from "../api";

/** Tolerance on a travel direction's off-axis component, in units of the
 *  direction vector (which is unit-length): a hole travels "on a horizontal
 *  plane" only when its edge, after rotation, is horizontal in world space
 *  to within this tolerance — i.e. the tool's rotation is effectively a
 *  multiple of 180°/90° for a top-bottom/left-right hole respectively. */
const AXIS_EPS = 1e-3;

/** World-space direction the hole travels in as its offset increases, for a
 *  tool with the given finger-hole side and world rotation. `top`/`bottom`
 *  holes slide along local X, `left`/`right` along local Y (matching the
 *  Position slider's documented behaviour); rotating that by the tool's
 *  placement rotation gives the world direction. `center` has no single
 *  side to slide along and returns null. */
export function travelDirection(side: FingerHoleSide, rotDeg: number): [number, number] | null {
  if (side === "center") return null;
  const localX = side === "top" || side === "bottom" ? 1 : 0;
  const localY = localX ? 0 : 1;
  const a = (rotDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [localX * c - localY * s, localX * s + localY * c];
}

export interface FingerAlignCandidate {
  id: string;
  /** Current world position of this tool's finger hole. */
  cx: number;
  cy: number;
  side: FingerHoleSide;
  rot: number;
  offset: number;
  offsetMax: number;
}

export interface FingerAlignPlan {
  axis: "horizontal" | "vertical";
  referenceId: string;
  /** New `finger_hole_offset_mm` per tool id, excluding the reference tool
   *  (which stays put — every other hole aligns to it). */
  updates: Map<string, number>;
}

/** Whether — and how — a selection's finger holes can be aligned onto one
 *  line. Candidates are tools with finger access on and a slidable side
 *  (`side !== "center"`); tools without a slidable side are simply not
 *  eligible to participate and don't block the rest of the group.
 *
 *  Requires at least 2 candidates, all travelling on the same axis (all
 *  horizontal, i.e. holes on a top/bottom edge sitting level in world space,
 *  or all vertical, left/right edges standing plumb) — a mixed or diagonal
 *  group returns null. The reference is the bottom-most hole (max world Y)
 *  for a horizontal group, or the left-most (min world X) for a vertical
 *  one; every other candidate's hole must be able to reach that reference's
 *  line without exceeding its own offset range, or the whole plan is null. */
export function computeFingerAlignPlan(candidatesIn: FingerAlignCandidate[]): FingerAlignPlan | null {
  const candidates = candidatesIn.filter((c) => c.side !== "center");
  if (candidates.length < 2) return null;

  const dirs = new Map<string, [number, number]>();
  for (const c of candidates) {
    const dir = travelDirection(c.side, c.rot);
    if (!dir) return null;
    dirs.set(c.id, dir);
  }

  const allHorizontal = candidates.every((c) => Math.abs(dirs.get(c.id)![1]) <= AXIS_EPS);
  const allVertical = candidates.every((c) => Math.abs(dirs.get(c.id)![0]) <= AXIS_EPS);
  if (!allHorizontal && !allVertical) return null;
  const axis: "horizontal" | "vertical" = allHorizontal ? "horizontal" : "vertical";

  const reference = axis === "horizontal"
    ? candidates.reduce((best, c) => (c.cy > best.cy ? c : best))
    : candidates.reduce((best, c) => (c.cx < best.cx ? c : best));
  const refCoord = axis === "horizontal" ? reference.cx : reference.cy;

  const updates = new Map<string, number>();
  for (const c of candidates) {
    if (c.id === reference.id) continue;
    const dir = dirs.get(c.id)!;
    const delta = axis === "horizontal" ? refCoord - c.cx : refCoord - c.cy;
    const proj = axis === "horizontal" ? dir[0] * delta : dir[1] * delta;
    const newOffset = c.offset + proj;
    if (Math.abs(newOffset) > c.offsetMax + 1e-6) return null;
    updates.set(c.id, newOffset);
  }
  return { axis, referenceId: reference.id, updates };
}
