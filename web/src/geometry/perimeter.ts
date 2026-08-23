/** Arc-length geometry along a closed local (stamp-frame) ring — the client
 *  mirror of gridshot/core/derive.py's `_ring_length`/`_point_at_arc_length`/
 *  `_arc_length_at_point`, kept in exact lockstep with those so a drag or
 *  nudge computed here lands on the same point the server would derive for
 *  the same `finger_hole_arc_mm`. Used for instant local feedback while
 *  dragging/nudging a finger hole, without waiting on a server round-trip —
 *  the same pattern tool position dragging already uses. */

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
