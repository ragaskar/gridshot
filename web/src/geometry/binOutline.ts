/** 2D-schematic geometry for a "custom bin shape" — the combine editor's
 *  Arrange 2D picture of a forced-size bin with individual gridfinity cells
 *  cut out. This is a visual overlay only (instant, client-side feedback);
 *  the manufacturing-precision equivalent is built server-side in
 *  `gridshot/core/gridfinity.py::_rounded_polyomino_outline`. */

export type CellKey = string; // "ix,iy"

export function cellKey(ix: number, iy: number): CellKey {
  return `${ix},${iy}`;
}

function isIncluded(ix: number, iy: number, gx: number, gy: number, removed: ReadonlySet<CellKey>): boolean {
  return ix >= 0 && iy >= 0 && ix < gx && iy < gy && !removed.has(cellKey(ix, iy));
}

/** Whether the included cells (grid minus `removed`) form a single
 *  4-connected piece — a hole in the middle (e.g. a ring) is still one
 *  piece and is fine; two islands that only touch at a corner are not. */
export function isShapeConnected(gx: number, gy: number, removed: ReadonlySet<CellKey>): boolean {
  const all: [number, number][] = [];
  for (let ix = 0; ix < gx; ix++) {
    for (let iy = 0; iy < gy; iy++) {
      if (isIncluded(ix, iy, gx, gy, removed)) all.push([ix, iy]);
    }
  }
  if (all.length === 0) return false;
  const seen = new Set<CellKey>([cellKey(all[0][0], all[0][1])]);
  const stack: [number, number][] = [all[0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]) {
      if (isIncluded(nx, ny, gx, gy, removed) && !seen.has(cellKey(nx, ny))) {
        seen.add(cellKey(nx, ny));
        stack.push([nx, ny]);
      }
    }
  }
  return seen.size === all.length;
}

type Pt = [number, number];

/** Boundary loops of the included cells, in integer grid-corner space (cell
 *  (ix,iy) occupies corners (ix,iy)..(ix+1,iy+1)). One loop per connected
 *  outer boundary or hole — a ring shape returns two: outer + the hole. */
function traceLoops(gx: number, gy: number, removed: ReadonlySet<CellKey>): Pt[][] {
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const edgesByStart = new Map<string, { start: Pt; end: Pt }>();
  const addEdge = (start: Pt, end: Pt) => edgesByStart.set(key(start), { start, end });

  for (let ix = 0; ix < gx; ix++) {
    for (let iy = 0; iy < gy; iy++) {
      if (!isIncluded(ix, iy, gx, gy, removed)) continue;
      if (!isIncluded(ix + 1, iy, gx, gy, removed)) addEdge([ix + 1, iy], [ix + 1, iy + 1]);
      if (!isIncluded(ix, iy + 1, gx, gy, removed)) addEdge([ix + 1, iy + 1], [ix, iy + 1]);
      if (!isIncluded(ix - 1, iy, gx, gy, removed)) addEdge([ix, iy + 1], [ix, iy]);
      if (!isIncluded(ix, iy - 1, gx, gy, removed)) addEdge([ix, iy], [ix + 1, iy]);
    }
  }

  const visited = new Set<string>();
  const loops: Pt[][] = [];
  for (const startKey of edgesByStart.keys()) {
    if (visited.has(startKey)) continue;
    const raw: Pt[] = [];
    let cursor = startKey;
    while (!visited.has(cursor)) {
      const edge = edgesByStart.get(cursor)!;
      visited.add(cursor);
      raw.push(edge.start);
      cursor = key(edge.end);
    }
    loops.push(simplifyCollinear(raw));
  }
  return loops;
}

/** Drop grid-corner points that fall in the middle of a straight run, so
 *  only real corners remain — a rectilinear polygon's vertices. */
function simplifyCollinear(points: Pt[]): Pt[] {
  const n = points.length;
  return points.filter((cur, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const d1: Pt = [cur[0] - prev[0], cur[1] - prev[1]];
    const d2: Pt = [next[0] - cur[0], next[1] - cur[1]];
    return d1[0] * d2[1] - d1[1] * d2[0] !== 0; // 0 cross product = collinear
  });
}

function unit([x, y]: Pt): Pt {
  const len = Math.hypot(x, y);
  return len === 0 ? [0, 0] : [x / len, y / len];
}

/** Grid-corner (ix, iy) → world mm, matching the cell-centre convention
 *  already used for feet/grid-line placement: cell ix's centre sits at
 *  (ix - (gx-1)/2) * pitch, so corner ix (that cell's left edge) is half a
 *  pitch further out, i.e. (ix - gx/2) * pitch. */
function toWorld([gxPt, gyPt]: Pt, gx: number, gy: number, pitch: number, cx: number, cy: number): Pt {
  return [(gxPt - gx / 2) * pitch + cx, (gyPt - gy / 2) * pitch + cy];
}

function roundedSubpath(
  loopGrid: Pt[], gx: number, gy: number, pitch: number, r: number, cx: number, cy: number,
): string {
  const loop = loopGrid.map((p) => toWorld(p, gx, gy, pitch, cx, cy));
  const n = loop.length;
  if (n < 3) return "";
  const fmt = (v: number) => Number(v.toFixed(3));
  const p1s: Pt[] = [], p2s: Pt[] = [], sweeps: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const cur = loop[i];
    const next = loop[(i + 1) % n];
    const dIn = unit([cur[0] - prev[0], cur[1] - prev[1]]);
    const dOut = unit([next[0] - cur[0], next[1] - cur[1]]);
    p1s.push([cur[0] - dIn[0] * r, cur[1] - dIn[1] * r]);
    p2s.push([cur[0] + dOut[0] * r, cur[1] + dOut[1] * r]);
    sweeps.push(dIn[0] * dOut[1] - dIn[1] * dOut[0] > 0 ? 1 : 0);
  }
  let d = `M ${fmt(p1s[0][0])} ${fmt(p1s[0][1])} `;
  for (let i = 0; i < n; i++) {
    d += `L ${fmt(p1s[i][0])} ${fmt(p1s[i][1])} `;
    d += `A ${fmt(r)} ${fmt(r)} 0 0 ${sweeps[i]} ${fmt(p2s[i][0])} ${fmt(p2s[i][1])} `;
  }
  return d + "Z";
}

export interface BinOutlineParams {
  gx: number;
  gy: number;
  pitch: number;
  cornerR: number;
  /** World-space centre of the whole gx×gy grid (default: origin, matching
   *  the arrange view's own centring convention). */
  centerX?: number;
  centerY?: number;
}

/** SVG path `d` for the rounded outline of the included cells (grid minus
 *  `removedCells`) — one convex-or-concave-rounded loop per connected
 *  boundary (outer perimeter, plus one per hole). Reduces to a plain rounded
 *  rectangle's outline when nothing is removed.
 *
 *  Assumes the included cells are a single connected piece (see
 *  `isShapeConnected`, which callers should check first) — two cells
 *  touching only at a shared corner meet at the same grid point from two
 *  different loops, which this tracer doesn't disambiguate and will drop or
 *  merge edges at. That's fine in practice: the editor never lets a
 *  disconnected shape reach export, and only needs a valid picture for
 *  valid shapes. */
export function binOutlinePath(params: BinOutlineParams, removedCells: ReadonlySet<CellKey>): string {
  const { gx, gy, pitch, cornerR, centerX = 0, centerY = 0 } = params;
  return traceLoops(gx, gy, removedCells)
    .map((loop) => roundedSubpath(loop, gx, gy, pitch, cornerR, centerX, centerY))
    .filter(Boolean)
    .join(" ");
}
