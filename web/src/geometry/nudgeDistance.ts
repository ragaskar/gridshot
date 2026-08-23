export type Pt = [number, number];

export type CardinalDirection = "up" | "down" | "left" | "right";

function directionVector(direction: CardinalDirection): Pt {
  switch (direction) {
    case "up": return [0, 1];
    case "down": return [0, -1];
    case "left": return [-1, 0];
    case "right": return [1, 0];
  }
}

/** Guards the ray/segment linear solve's denominator. An edge this close to
 *  parallel with the ray makes the solve numerically unstable (a tiny
 *  denominator amplifies float error into a wildly wrong `t`/`s`) — treat it
 *  as no intersection rather than reporting a spurious hit. Exactly 0 (an
 *  edge running dead along the ray, e.g. a horizontal edge on a horizontal
 *  ray) hits this the same way, which is the more common real case. */
const DENOM_EPS = 1e-9;
/** Segment-parameter tolerance: a hit within this of 0 or 1 still counts as
 *  landing "on" the segment (endpoint-touching edges of the same vertex,
 *  hit via either adjacent edge, shouldn't be silently dropped). */
const SEGMENT_EPS = 1e-9;
/** A self-hit at (or before) the ray's own origin isn't a real exit — the
 *  origin is assumed strictly interior to its own polygon, so this only
 *  guards float noise, not a real geometric case. */
const MIN_T_MM = 1e-6;

/** First point (by ray parameter `t`) where `origin` cast in `direction`
 *  crosses each polygon's boundary, grouped by id — used to find both this
 *  tool's own exit point and, separately, the next different tool's entry
 *  point, without walking the same edge list twice. */
function rayHits(origin: Pt, direction: CardinalDirection, polys: { id: string; poly: Pt[] }[]): { id: string; t: number; point: Pt }[] {
  const [dx, dy] = directionVector(direction);
  const [ox, oy] = origin;
  const hits: { id: string; t: number; point: Pt }[] = [];
  for (const { id, poly } of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const ex = bx - ax, ey = by - ay;
      // Standard cross-product line/line solve: t = cross(A-O, E) / cross(D, E),
      // s = cross(A-O, D) / cross(D, E), where cross(u, v) = ux*vy - uy*vx.
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < DENOM_EPS) continue;
      const t = ((ax - ox) * ey - (ay - oy) * ex) / denom;
      if (t < MIN_T_MM) continue;
      const s = ((ax - ox) * dy - (ay - oy) * dx) / denom;
      if (s < -SEGMENT_EPS || s > 1 + SEGMENT_EPS) continue;
      hits.push({ id, t, point: [ox + t * dx, oy + t * dy] });
    }
  }
  hits.sort((a, b) => a.t - b.t);
  return hits;
}

/** Casts a ray from `origin` (a tool's own placed bbox center) in one of the
 *  4 cardinal directions and finds: the nearest point where it leaves
 *  `selfId`'s own placed outline, and — continuing from there — the nearest
 *  point where it first meets a *different* tool's placed outline. Returns
 *  `null` if the ray never leaves `selfId`'s outline, or never meets another
 *  tool's outline afterward.
 *
 *  A concave self outline the ray crosses more than once (re-entering and
 *  leaving again) is handled correctly: `start` is always the *first* self
 *  exit, and any further self crossings in between are skipped when looking
 *  for `end` — passing back through more of the same tool's own material
 *  doesn't count as "meeting another tool's outline." */
export function nextToolAlongRay(
  origin: Pt,
  direction: CardinalDirection,
  polys: { id: string; poly: Pt[] }[],
  selfId: string,
): { start: Pt; end: Pt; distanceMm: number } | null {
  const hits = rayHits(origin, direction, polys);
  const start = hits.find((h) => h.id === selfId);
  if (!start) return null;
  const end = hits.find((h) => h.t > start.t && h.id !== selfId);
  if (!end) return null;
  return { start: start.point, end: end.point, distanceMm: Math.round((end.t - start.t) * 100) / 100 };
}
