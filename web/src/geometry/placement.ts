export type Pt = [number, number];

/** Apply a placement to a centroid-normalised stamp — mirror about the local
 *  axes, then rotate CCW about the origin (matching shapely on the server),
 *  then translate. Mirror is a separate transform from rotation (it can't be
 *  expressed as any `rot` value — a flip reverses handedness, a rotation
 *  never does), so it's applied first, in the same local frame `rot` uses. */
export function placed(
  stamp: Pt[], tx: number, ty: number, rot: number,
  mirrorX = false, mirrorY = false,
): Pt[] {
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return stamp.map(([px, py]) => {
    const x = mirrorX ? -px : px, y = mirrorY ? -py : py;
    return [x * c - y * s + tx, x * s + y * c + ty];
  });
}

export function placedPoint(point: Pt, tx: number, ty: number, rot: number, mirrorX = false, mirrorY = false): Pt {
  return placed([point], tx, ty, rot, mirrorX, mirrorY)[0];
}
