/** Geometry for the "Show Spacing" overlay — point-to-point distance lines
 *  from each tool's own outline (stamp + every finger-hole scallop/span
 *  bridge unioned onto it, since a scallop is a notch cut into the edge
 *  that can bulge past the stamp's own boundary, not an interior void — see
 *  `selfExitAlongRay`) out to whichever tool or grid edge is nearest in a
 *  given direction. Unlike nudgeDistance.ts's `nextToolAlongRay` (which
 *  assumes its ray origin starts strictly inside a single self polygon),
 *  this module's origins are sometimes already sitting exactly ON a self
 *  outline point (an extreme vertex), so its ray casting keeps t=0 hits
 *  usable rather than flooring them away — two tools placed touching (0mm
 *  gap) is a real, wanted reading here. */

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

const DENOM_EPS = 1e-9;
const SEGMENT_EPS = 1e-9;
/** Numerical-noise floor only, not an "origin starts inside its own shape"
 *  guard like nudgeDistance's `MIN_T_MM` — negative, so a genuine t=0 hit (a
 *  touching neighbor) still registers instead of being floored away, while
 *  a hit meaningfully behind the ray's origin is still excluded. */
const MIN_T_MM = -1e-6;

interface RingHit { id: string; ring: number; t: number; point: Pt }

function ringCrossings(
  origin: Pt, direction: CardinalDirection, rings: { id: string; ring: number; poly: Pt[] }[],
): RingHit[] {
  const [dx, dy] = directionVector(direction);
  const [ox, oy] = origin;
  const hits: RingHit[] = [];
  for (const { id, ring, poly } of rings) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const ex = bx - ax, ey = by - ay;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < DENOM_EPS) continue;
      const t = ((ax - ox) * ey - (ay - oy) * ex) / denom;
      if (t < MIN_T_MM) continue;
      const s = ((ax - ox) * dy - (ay - oy) * dx) / denom;
      if (s < -SEGMENT_EPS || s > 1 + SEGMENT_EPS) continue;
      hits.push({ id, ring, t, point: [ox + t * dx, oy + t * dy] });
    }
  }
  hits.sort((a, b) => a.t - b.t);
  return hits;
}

/** Even-odd point-in-polygon test (standard horizontal-ray method) — used
 *  only to seed which of a tool's own rings `origin` starts inside of,
 *  before `selfExitAlongRay` walks crossings outward from there. */
export function pointInPolygon(point: Pt, poly: Pt[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Points approximating a circle, in ring-vertex form — the same shape a
 *  `<circle>` element renders, tessellated finely enough for ray casting
 *  against (mirrors the corner tessellation perimeter.ts's
 *  `fingerHoleRectPoints` already uses for a rounded-rect hole). */
const CIRCLE_SEGMENTS = 48;
export function circlePoints(cx: number, cy: number, r: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** A rectangle of half-width `radius` running from `p1` to `p2` — the
 *  straight midsection of a span finger hole's connecting bridge (rendered
 *  as a round-capped stroke; the round caps themselves are already covered
 *  by the two lobe rings at `p1`/`p2`, so only the straight midsection
 *  needs its own ring here). */
export function capsuleMidsectionPoints(p1: Pt, p2: Pt, radius: number): Pt[] {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  if (len <= 1e-9) return [];
  const nx = (-dy / len) * radius, ny = (dx / len) * radius;
  return [
    [p1[0] + nx, p1[1] + ny], [p2[0] + nx, p2[1] + ny],
    [p2[0] - nx, p2[1] - ny], [p1[0] - nx, p1[1] - ny],
  ];
}

/** A tool's true physical outline is the union of its cut stamp and every
 *  finger-hole scallop/span-bridge unioned onto it — a hole is additive
 *  material here, not a subtraction (it's a notch cut INTO the edge that
 *  can bulge past the stamp's own boundary, not an interior void), so it
 *  can only ever push the outline further out, never pull it in. `selfRings`
 *  is that tool's stamp ring plus every hole/bridge ring, all in world
 *  coordinates. Casts a ray from `origin` (assumed inside at least one of
 *  the rings) outward in `direction` and returns the first point where the
 *  ray leaves the union of all of them — tracking, per ring, whether the
 *  ray currently sits inside it (even-odd per ring) and reporting the first
 *  moment none of the rings claim the ray anymore. A ray that runs through a
 *  scallop straddling the stamp edge exits at the scallop's own outer arc,
 *  not the stamp's boundary underneath it, whenever the scallop reaches
 *  further out along this particular ray than the stamp does. */
export function selfExitAlongRay(
  origin: Pt, direction: CardinalDirection, selfRings: Pt[][],
): { point: Pt; t: number } | null {
  const tagged = selfRings.map((poly, ring) => ({ id: "self", ring, poly }));
  const hits = ringCrossings(origin, direction, tagged);
  const inside = selfRings.map((ring) => pointInPolygon(origin, ring));
  let insideCount = inside.filter(Boolean).length;
  if (insideCount === 0) return null;
  for (const h of hits) {
    inside[h.ring] = !inside[h.ring];
    insideCount += inside[h.ring] ? 1 : -1;
    if (insideCount === 0) return { point: h.point, t: h.t };
  }
  return null;
}

/** First point where a ray from `origin` in `direction` meets a ring that
 *  does *not* belong to `excludeId`. Used both continuing on from a tool's
 *  own self-exit point (center-based rays) and starting directly from an
 *  already-on-the-outline extreme point (extreme-point rays), where a `t`
 *  at or near 0 is a real, wanted answer — two tools placed touching, 0mm
 *  apart — unlike nudgeDistance's `nextToolAlongRay`. */
export function nearestOtherAlongRay(
  origin: Pt, direction: CardinalDirection, rings: { id: string; poly: Pt[] }[], excludeId: string,
): { point: Pt; t: number; id: string } | null {
  const tagged = rings.map((r, i) => ({ id: r.id, ring: i, poly: r.poly }));
  const hits = ringCrossings(origin, direction, tagged);
  const hit = hits.find((h) => h.id !== excludeId);
  return hit ? { point: hit.point, t: hit.t, id: hit.id } : null;
}

/** The first vertex (in ring order) of `rings` achieving the minimum or
 *  maximum coordinate on `axis` — deterministic on a tie (e.g. a plain
 *  rectangle's two same-side corners) rather than an arbitrary pick; always
 *  a real vertex, not an interpolated edge midpoint, since it's drawn as one
 *  end of a literal point-to-point spacing line. */
export function extremePoint(rings: Pt[][], axis: "x" | "y", find: "min" | "max"): Pt | null {
  let best: Pt | null = null;
  let bestVal = find === "min" ? Infinity : -Infinity;
  const idx = axis === "x" ? 0 : 1;
  for (const ring of rings) {
    for (const p of ring) {
      const v = p[idx];
      if ((find === "min" && v < bestVal) || (find === "max" && v > bestVal)) {
        bestVal = v;
        best = p;
      }
    }
  }
  return best;
}
