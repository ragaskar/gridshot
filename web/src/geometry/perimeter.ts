/** Arc-length geometry along a closed local (stamp-frame) ring — the client
 *  mirror of gridshot/core/derive.py's `_ring_length`/`_point_at_arc_length`/
 *  `_arc_length_at_point`/`_point_and_outward_normal_at_arc_length`, kept in
 *  exact lockstep with those so a drag or nudge computed here lands on the
 *  same point the server would derive for the same `finger_hole_arc_mm`.
 *  Used for instant local feedback while dragging/nudging a finger hole,
 *  without waiting on a server round-trip — the same pattern tool position
 *  dragging already uses. */

export type Pt = [number, number];

export function ringLength(ring: Pt[]): number {
  if (ring.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  return total;
}

/** Walk `ring` from its first vertex for `arcMm` and interpolate. Callers
 *  wrap `arcMm` into `[0, ringLength(ring))` first; a value outside that
 *  range (or a degenerate ring) resolves to the first vertex. */
export function pointAtArcLength(ring: Pt[], arcMm: number): Pt {
  if (!ring.length) return [0, 0];
  if (ring.length < 2 || arcMm <= 0) return ring[0];
  let remaining = arcMm;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    if (segLen <= 1e-12) continue;
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    remaining -= segLen;
  }
  return ring[0];
}

/** Inverse of `pointAtArcLength`: the arc-length of whichever point on `ring`
 *  is nearest `target` (its projection onto the nearest edge). */
export function nearestArcLength(ring: Pt[], target: Pt): number {
  if (ring.length < 2) return 0;
  const [tx, ty] = target;
  let bestDist: number | null = null;
  let bestArc = 0;
  let traveled = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const dx = x1 - x0, dy = y1 - y0;
    const segLen2 = dx * dx + dy * dy;
    if (segLen2 <= 1e-24) continue;
    const segLen = Math.sqrt(segLen2);
    const t = Math.max(0, Math.min(1, ((tx - x0) * dx + (ty - y0) * dy) / segLen2));
    const px = x0 + dx * t, py = y0 + dy * t;
    const dist = Math.hypot(tx - px, ty - py);
    if (bestDist === null || dist < bestDist) {
      bestDist = dist;
      bestArc = traveled + t * segLen;
    }
    traveled += segLen;
  }
  return bestArc;
}

/** `arcMm` wrapped into `[0, ringLength(ring))`, matching the wrap
 *  `derive_bin_spec` applies server-side — 0 for a degenerate ring. */
export function wrapArcLength(ring: Pt[], arcMm: number): number {
  const len = ringLength(ring);
  if (len <= 1e-9) return 0;
  return ((arcMm % len) + len) % len;
}

/** The unit outward normal of the ring segment containing `arcMm` — the
 *  segment tangent rotated -90 degrees. Correct as "outward" only because
 *  `ring` (a tool's own `stamp`) is CCW-oriented, matching derive.py's
 *  `_point_and_outward_normal_at_arc_length`; see that function's docstring
 *  for why this orientation holds. Degenerate segments return [0, 0]. */
export function outwardNormalAtArcLength(ring: Pt[], arcMm: number): Pt {
  if (ring.length < 2) return [0, 0];
  let remaining = arcMm > 0 ? arcMm : 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const dx = x1 - x0, dy = y1 - y0;
    const segLen = Math.hypot(dx, dy);
    if (segLen <= 1e-12) continue;
    if (remaining <= segLen) return [dy / segLen, -dx / segLen];
    remaining -= segLen;
  }
  return [0, 0];
}

/** Corner tessellation density for `fingerHoleRectPoints`' rounded corners —
 *  matches CombineEditor.tsx's `roundedRectPreviewPoints` (the rounded-rect
 *  *toolshape*'s own preview outline), which this is a sibling of, not a
 *  caller of (this file sits below CombineEditor.tsx in the import graph). */
const FINGER_HOLE_RECT_CORNER_SEGMENTS = 8;

/** A "rounded_rect" finger hole's cross-section, in `ring`'s own local
 *  (stamp) frame, centred on the point at `arcMm` and oriented so its
 *  *length* edge runs along the ring's own tangent there (tangent = outward
 *  normal rotated +90°, i.e. `(-normal_y, normal_x)`) and its *width* edge
 *  along the normal — the exact mirror of derive.py's
 *  `_finger_hole_shape_polygon`, kept in exact lockstep with it per this
 *  file's own header (see fingerAlign.test.ts / perimeter.test.ts's paired
 *  numeric cases against that function). Feed the result through `placed()`
 *  (same as any other local-frame point list — a tool's own stamp, a
 *  toolshape's preview outline) for final world-space render points; don't
 *  rotate it again by the tool's own `rot` first, `placed()` already does
 *  that. A rounded rectangle is centrally symmetric, so a sign error in
 *  which of the two tangent directions this resolves to would still
 *  produce the identical polygon. */
export function fingerHoleRectPoints(
  ring: Pt[], arcMm: number, lengthMm: number, widthMm: number, cornerRadiusMm: number,
): Pt[] {
  const wrapped = wrapArcLength(ring, arcMm);
  const [px, py] = pointAtArcLength(ring, wrapped);
  const [nx, ny] = outwardNormalAtArcLength(ring, wrapped);
  const tangentRad = Math.atan2(nx, -ny);
  const c = Math.cos(tangentRad), s = Math.sin(tangentRad);
  const hw = lengthMm / 2, hl = widthMm / 2;
  const r = Math.max(0, Math.min(cornerRadiusMm, hw, hl));
  const local: Pt[] = [];
  if (r < 0.01) {
    local.push([-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]);
  } else {
    const corners: [number, number, number][] = [
      [hw - r, hl - r, 0], [-(hw - r), hl - r, 90],
      [-(hw - r), -(hl - r), 180], [hw - r, -(hl - r), 270],
    ];
    for (const [ccx, ccy, startDeg] of corners) {
      for (let i = 0; i <= FINGER_HOLE_RECT_CORNER_SEGMENTS; i++) {
        const a = ((startDeg + (i / FINGER_HOLE_RECT_CORNER_SEGMENTS) * 90) * Math.PI) / 180;
        local.push([ccx + r * Math.cos(a), ccy + r * Math.sin(a)]);
      }
    }
  }
  return local.map(([lx, ly]): Pt => [lx * c - ly * s + px, lx * s + ly * c + py]);
}
