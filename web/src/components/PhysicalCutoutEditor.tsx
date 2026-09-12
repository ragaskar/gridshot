import { useMemo, useRef, useState } from "react";
import type { OutlineCurveCorner, OutlineCurves, Poly, Ring } from "../api";
import { useZoomPan } from "./useZoomPan";

type Mode = "move" | "insert" | "delete" | "curve" | "hole";

type Pt = [number, number];

/** One editable corner: its position, and — while eased — how far each of
 *  its two Bezier handles reaches back along the incoming/outgoing edge.
 *  Curve state lives on the node itself (not a separate index-keyed map) so
 *  insert/delete/reorder can never leave it pointing at the wrong vertex. */
interface CornerNode {
  p: Pt;
  round: { hIn: number; hOut: number } | null;
}
type CornerRing = CornerNode[];
interface CornerPoly {
  exterior: CornerRing;
  holes: CornerRing[];
}

// How many straight segments approximate one eased corner's curve when it's
// baked into the saved polygon — matches CombineEditor's own rounded-corner
// tessellation density (roundedRectPreviewPoints's segsPerCorner).
const CURVE_SEGMENTS = 10;
// A handle can reach at most this fraction of its adjacent edge's length —
// even with both of an edge's corners eased at the max, together they still
// leave a straight middle section, so the two curves can never cross.
const MAX_HANDLE_FRACTION = 0.45;
// Newly-eased corner's starting handle length, as a fraction of the shorter
// of its two adjacent edges — comfortably under MAX_HANDLE_FRACTION.
const DEFAULT_HANDLE_FRACTION = 0.3;

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The point `distAlong` mm from `from` toward `to`, clamped to `to` itself
 *  — never overshoots past the neighbouring corner even if a handle length
 *  is stale (e.g. right after a drag shortens the edge it sits on). */
function towards(from: Pt, to: Pt, distAlong: number): Pt {
  const d = dist(from, to);
  const t = d < 1e-9 ? 0 : Math.min(1, Math.max(0, distAlong / d));
  return lerp(from, to, t);
}

function maxHandleLength(a: Pt, b: Pt): number {
  return dist(a, b) * MAX_HANDLE_FRACTION;
}

/** A rounded corner's two anchor points, in edge order — where the curve
 *  actually starts/ends (the vertex itself is only the Bezier's control
 *  point, not a point on the curve). */
function cornerAnchors(ring: CornerRing, point: number): { p1: Pt; p2: Pt } | null {
  const n = ring.length;
  const node = ring[point];
  if (!node.round) return null;
  const prev = ring[(point - 1 + n) % n].p;
  const next = ring[(point + 1) % n].p;
  return {
    p1: towards(node.p, prev, node.round.hIn),
    p2: towards(node.p, next, node.round.hOut),
  };
}

function bakeCornerRing(ring: CornerRing): Ring {
  const n = ring.length;
  if (n < 3) return ring.map((node) => node.p);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const node = ring[i];
    const anchors = cornerAnchors(ring, i);
    if (!anchors) {
      out.push(node.p);
      continue;
    }
    const { p1, p2 } = anchors;
    for (let s = 0; s <= CURVE_SEGMENTS; s++) {
      const t = s / CURVE_SEGMENTS;
      // Quadratic Bezier: p1 -> node.p (control) -> p2.
      out.push(lerp(lerp(p1, node.p, t), lerp(node.p, p2, t), t));
    }
  }
  return out;
}

function bakeCornerPoly(poly: CornerPoly): Poly {
  return { exterior: bakeCornerRing(poly.exterior), holes: poly.holes.map(bakeCornerRing) };
}

function sharpRing(ring: Ring): CornerRing {
  return ring.map((p) => ({ p, round: null }));
}

function sharpPoly(poly: Poly): CornerPoly {
  return { exterior: sharpRing(poly.exterior), holes: poly.holes.map(sharpRing) };
}

function ringToOutlineCurves(ring: CornerRing): OutlineCurveCorner[] {
  return ring.map((node) => ({
    p: node.p,
    h_in: node.round ? node.round.hIn : null,
    h_out: node.round ? node.round.hOut : null,
  }));
}

function toOutlineCurves(poly: CornerPoly): OutlineCurves {
  return { exterior: ringToOutlineCurves(poly.exterior), holes: poly.holes.map(ringToOutlineCurves) };
}

function outlineCurvesToRing(corners: OutlineCurveCorner[]): CornerRing {
  return corners.map((corner) => ({
    p: corner.p,
    round: corner.h_in != null && corner.h_out != null ? { hIn: corner.h_in, hOut: corner.h_out } : null,
  }));
}

function fromOutlineCurves(curves: OutlineCurves): CornerPoly {
  return { exterior: outlineCurvesToRing(curves.exterior), holes: curves.holes.map(outlineCurvesToRing) };
}

/** The corner graph to actually start editing from: the persisted one, but
 *  only if it still bakes to exactly the outline we were handed — belt and
 *  suspenders against stale/mismatched data, even though the server only
 *  ever sends a graph it's already checked against the current outline
 *  revision (see GET .../outline's outline_curves). Falls back to treating
 *  every corner as sharp, same as a tool with no curve graph at all. */
function resolveInitialCornerPoly(initial: Poly, initialCurves: OutlineCurves | null | undefined): CornerPoly {
  if (initialCurves) {
    const fromCurves = fromOutlineCurves(initialCurves);
    if (JSON.stringify(bakeCornerPoly(fromCurves)) === JSON.stringify(initial)) return fromCurves;
  }
  return sharpPoly(initial);
}

function changedCornerRing(poly: CornerPoly, ringIndex: number, ring: CornerRing): CornerPoly {
  if (ringIndex < 0) return { ...poly, exterior: ring };
  return {
    ...poly,
    holes: poly.holes.map((value, index) => (index === ringIndex ? ring : value)),
  };
}

function ringPath(ring: Ring): string {
  if (ring.length < 3) return "";
  return `M ${ring.map(([x, y]) => `${x} ${y}`).join(" L ")} Z`;
}

function polyPath(poly: Poly): string {
  return [ringPath(poly.exterior), ...poly.holes.map(ringPath)].join(" ");
}

function bounds(...polys: CornerPoly[]) {
  const points = polys.flatMap((poly) => [poly.exterior, ...poly.holes]).flat().map((node) => node.p);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minx = Math.min(...xs);
  const maxx = Math.max(...xs);
  const miny = Math.min(...ys);
  const maxy = Math.max(...ys);
  return { minx, miny, maxx, maxy, width: maxx - minx, height: maxy - miny };
}

export function PhysicalCutoutEditor({
  initial,
  initialCurves,
  photoBaseline,
  busy,
  onSave,
  onCancel,
}: {
  initial: Poly;
  // The persisted "Edit curves" control graph `initial` was baked from, if
  // any — lets a tool with an already-eased corner reopen with adjustable
  // handles instead of the corner reading as an ordinary hard vertex.
  // Omitted (or null, or stale — see resolveInitialCornerPoly) means every
  // corner starts sharp, same as a tool that's never used this mode.
  initialCurves?: OutlineCurves | null;
  // What auto-derivation from the accepted photo selection would produce —
  // the shadow outline and "Revert to photo selection" target. Omitted (or
  // null) when there's nothing to derive it from — an unusual tool with no
  // photo trace at all, or a caller (the single-capture Result/Batch flows)
  // that has no such baseline to offer — in which case the shadow and revert
  // button just don't render.
  photoBaseline?: Poly | null;
  busy: boolean;
  onSave: (polygon: Poly, curves: OutlineCurves) => void | Promise<void>;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- captured once at
  // mount, like initial/photoBaseline elsewhere in this file; recomputing it
  // (a bake + two full-polygon JSON.stringify calls) on every render/drag
  // frame would be pure waste for a value that can't change after mount.
  const initialCornerPoly = useMemo(() => resolveInitialCornerPoly(initial, initialCurves), []);
  const initialRef = useRef(initialCornerPoly);
  const photoBaselineRef = useRef(photoBaseline ? sharpPoly(photoBaseline) : null);
  const [history, setHistory] = useState<CornerPoly[]>([initialRef.current]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [current, setCurrent] = useState(initialRef.current);
  const [mode, setMode] = useState<Mode>("move");
  const [holeDraft, setHoleDraft] = useState<Ring>([]);
  const polygonRef = useRef(current);
  const dragVertex = useRef<{ ring: number; point: number } | null>(null);
  const dragHandle = useRef<{ ring: number; point: number; side: "in" | "out" } | null>(null);
  const originalBounds = useMemo(
    () => bounds(initialRef.current, ...(photoBaselineRef.current ? [photoBaselineRef.current] : [])),
    [],
  );
  const padding = Math.max(originalBounds.width, originalBounds.height) * 0.06 + 2;
  const base = {
    x: originalBounds.minx - padding,
    y: originalBounds.miny - padding,
    w: originalBounds.width + 2 * padding,
    h: originalBounds.height + 2 * padding,
  };
  const zp = useZoomPan(base);
  const extent = Math.max(base.w, base.h);
  const vertexRadius = extent / 125 / zp.zoomFactor;
  const stroke = extent / 450 / zp.zoomFactor;
  const currentBounds = bounds(current);
  const dimensions = [currentBounds.width, currentBounds.height].sort((a, b) => b - a);
  const rings = [current.exterior, ...current.holes];
  const bakedCurrent = useMemo(() => bakeCornerPoly(current), [current]);
  const changed = JSON.stringify(current) !== JSON.stringify(initialRef.current);
  // Whether the *current* cutout differs from the photo baseline — distinct
  // from `changed` (which only tracks this editing session): a tool opened
  // here already diverged from a past physical edit is diverged from the
  // moment the modal opens, before any vertex has moved.
  const diverged =
    photoBaselineRef.current != null &&
    JSON.stringify(current) !== JSON.stringify(photoBaselineRef.current);

  function replace(poly: CornerPoly) {
    polygonRef.current = poly;
    setCurrent(poly);
  }

  function commit(poly: CornerPoly) {
    const next = [...history.slice(0, historyIndex + 1), poly];
    setHistory(next);
    setHistoryIndex(next.length - 1);
    replace(poly);
  }

  function step(index: number) {
    setHistoryIndex(index);
    replace(history[index]);
  }

  function toData(clientX: number, clientY: number): Pt {
    const svg = zp.svgRef.current!;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return [local.x, local.y];
  }

  function down(event: React.PointerEvent<SVGSVGElement>) {
    if (mode === "hole") return;
    zp.panStart(event.clientX, event.clientY);
  }

  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (dragHandle.current) {
      const { ring, point, side } = dragHandle.current;
      const nodes = ring < 0 ? polygonRef.current.exterior : polygonRef.current.holes[ring];
      const n = nodes.length;
      const node = nodes[point];
      if (node.round) {
        const neighbor = side === "in" ? nodes[(point - 1 + n) % n].p : nodes[(point + 1) % n].p;
        const cursor = toData(event.clientX, event.clientY);
        const dx = neighbor[0] - node.p[0], dy = neighbor[1] - node.p[1];
        const edgeLen = Math.hypot(dx, dy);
        const projected = edgeLen < 1e-9
          ? 0
          : ((cursor[0] - node.p[0]) * dx + (cursor[1] - node.p[1]) * dy) / edgeLen;
        const length = Math.max(0, Math.min(maxHandleLength(node.p, neighbor), projected));
        const nextRound = side === "in"
          ? { ...node.round, hIn: length }
          : { ...node.round, hOut: length };
        replace(changedCornerRing(
          polygonRef.current, ring,
          nodes.map((value, index) => (index === point ? { ...value, round: nextRound } : value)),
        ));
      }
      return;
    }
    if (dragVertex.current) {
      const { ring, point } = dragVertex.current;
      const nodes = ring < 0 ? polygonRef.current.exterior : polygonRef.current.holes[ring];
      replace(changedCornerRing(
        polygonRef.current,
        ring,
        nodes.map((value, index) => (
          index === point ? { ...value, p: toData(event.clientX, event.clientY) } : value
        )),
      ));
      return;
    }
    zp.panMove(event.clientX, event.clientY);
  }

  function up(event: React.PointerEvent<SVGSVGElement>) {
    if (dragHandle.current) {
      dragHandle.current = null;
      commit(polygonRef.current);
      return;
    }
    if (dragVertex.current) {
      dragVertex.current = null;
      commit(polygonRef.current);
      return;
    }
    if (mode === "hole") {
      setHoleDraft((points) => [...points, toData(event.clientX, event.clientY)]);
      return;
    }
    zp.panEnd();
  }

  function toggleRound(ring: number, point: number) {
    const nodes = ring < 0 ? current.exterior : current.holes[ring];
    const n = nodes.length;
    if (n < 3) return;
    const node = nodes[point];
    let nextNode: CornerNode;
    if (node.round) {
      nextNode = { ...node, round: null };
    } else {
      const prev = nodes[(point - 1 + n) % n].p;
      const next = nodes[(point + 1) % n].p;
      const h = Math.min(
        maxHandleLength(node.p, prev),
        maxHandleLength(node.p, next),
        DEFAULT_HANDLE_FRACTION * Math.min(dist(node.p, prev), dist(node.p, next)),
      );
      nextNode = { ...node, round: { hIn: h, hOut: h } };
    }
    commit(changedCornerRing(current, ring, nodes.map((value, index) => (index === point ? nextNode : value))));
  }

  function vertexDown(ring: number, point: number, event: React.PointerEvent) {
    event.stopPropagation();
    if (mode === "move") {
      dragVertex.current = { ring, point };
      (event.target as Element).setPointerCapture?.(event.pointerId);
      return;
    }
    if (mode === "curve") {
      toggleRound(ring, point);
      return;
    }
    if (mode !== "delete") return;
    const nodes = ring < 0 ? current.exterior : current.holes[ring];
    if (ring >= 0 && nodes.length <= 3) {
      commit({ ...current, holes: current.holes.filter((_, index) => index !== ring) });
    } else if (nodes.length > 3) {
      commit(changedCornerRing(current, ring, nodes.filter((_, index) => index !== point)));
    }
  }

  function handleDown(ring: number, point: number, side: "in" | "out", event: React.PointerEvent) {
    event.stopPropagation();
    dragHandle.current = { ring, point, side };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function insert(ring: number, point: number, event: React.PointerEvent) {
    event.stopPropagation();
    const nodes = ring < 0 ? current.exterior : current.holes[ring];
    const a = nodes[point].p;
    const b = nodes[(point + 1) % nodes.length].p;
    commit(changedCornerRing(current, ring, [
      ...nodes.slice(0, point + 1),
      { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pt, round: null },
      ...nodes.slice(point + 1),
    ]));
  }

  function finishHole() {
    if (holeDraft.length < 3) return;
    commit({ ...current, holes: [...current.holes, sharpRing(holeDraft)] });
    setHoleDraft([]);
    setMode("move");
  }

  function modeButton(value: Mode, label: string) {
    return (
      <button
        className={`font-mono text-[10px] uppercase px-3 py-2 ${mode === value ? "bg-teal text-knockout" : "bg-paper text-muted"}`}
        onClick={() => {
          setMode(value);
          if (value !== "hole") setHoleDraft([]);
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <section className="w-full max-w-[900px] max-h-[calc(100dvh-2rem)] overflow-auto border-2 border-teal bg-paper p-4 sm:p-5">
      <div className="grp-label mb-2">Edit physical cutout</div>
      <p className="font-body text-sm text-muted mb-4 max-w-[76ch]">
        This is the reconstructed footprint used by the layout, before clearance.
        Vertex changes here are final physical dimensions; parallax will not be
        applied to them again.
      </p>
      {photoBaselineRef.current && (
        <div className="flex flex-wrap items-center gap-4 mb-3 font-mono text-[10px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: "var(--c-teal)" }} />
            physical cutout
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-4 border-t-2 border-dotted"
              style={{ borderColor: "var(--c-gold)" }}
            />
            photo selection
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex border border-line">
          {modeButton("move", "Move")}
          {modeButton("insert", "Add vertex")}
          {modeButton("curve", "Edit curves")}
          {modeButton("delete", "Delete")}
          {modeButton("hole", "Add opening")}
        </div>
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-muted">
          {dimensions[0].toFixed(2)} × {dimensions[1].toFixed(2)} mm
        </span>
        <button className="btn btn-ghost text-xs px-2 py-1" onClick={() => zp.zoomButton(1.3)}>−</button>
        <button className="btn btn-ghost text-xs px-2 py-1" onClick={() => zp.zoomButton(1 / 1.3)}>＋</button>
        <button className="btn btn-ghost text-xs px-2 py-1" onClick={zp.fit}>Fit</button>
      </div>
      {mode === "curve" && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="font-mono text-xs text-muted flex-1 min-w-52">
            Click a vertex to toggle it between a sharp corner and an eased
            one (shown in green). Drag the two small handles on either side
            of an eased corner to adjust how far the curve reaches.
          </span>
        </div>
      )}
      {mode === "hole" && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="font-mono text-xs text-muted flex-1 min-w-52">
            Tap 3+ points around a real opening such as a wrench ring. It creates
            a raised island in the pocket; it is not the finger-access scallop.
          </span>
          <button className="btn btn-ghost text-xs px-3 py-2" disabled={holeDraft.length < 3} onClick={finishHole}>
            Finish opening
          </button>
          <button className="btn btn-ghost text-xs px-3 py-2" disabled={!holeDraft.length} onClick={() => setHoleDraft([])}>
            Clear
          </button>
        </div>
      )}
      <div className="border border-line bg-field overflow-hidden" style={{ borderRadius: 2 }}>
        <svg
          ref={zp.svgRef}
          viewBox={zp.viewBox}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          className="block w-full touch-none"
          style={{ maxHeight: "65vh", margin: "0 auto" }}
          preserveAspectRatio="xMidYMid meet"
        >
          {photoBaselineRef.current && (
            <path
              d={polyPath(bakeCornerPoly(photoBaselineRef.current))}
              fill="none"
              fillRule="evenodd"
              stroke="var(--c-gold)"
              strokeOpacity={0.6}
              strokeWidth={stroke}
              strokeDasharray={`${stroke * 0.6} ${extent / 220 / zp.zoomFactor}`}
              strokeLinecap="round"
            />
          )}
          <path
            d={polyPath(bakedCurrent)}
            fill="rgba(36,110,114,0.28)"
            fillRule="evenodd"
            stroke="var(--c-teal)"
            strokeWidth={stroke}
          />
          {holeDraft.length > 0 && (
            <polyline
              points={holeDraft.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="rgba(200,83,30,0.2)"
              stroke="var(--c-orange)"
              strokeWidth={stroke}
            />
          )}
          {rings.flatMap((ring, visibleIndex) => {
            const ringIndex = visibleIndex - 1;
            const n = ring.length;
            const vertices = ring.map((node, point) => (
              <circle
                key={`v-${ringIndex}-${point}`}
                cx={node.p[0]}
                cy={node.p[1]}
                r={vertexRadius}
                fill={mode === "delete" ? "var(--c-orange)" : node.round ? "var(--c-olive)" : "var(--c-teal)"}
                onPointerDown={(event) => vertexDown(ringIndex, point, event)}
              />
            ));
            if (mode === "insert") {
              return [...vertices, ...ring.map((node, point) => {
                const next = ring[(point + 1) % n].p;
                return (
                  <circle
                    key={`i-${ringIndex}-${point}`}
                    cx={(node.p[0] + next[0]) / 2}
                    cy={(node.p[1] + next[1]) / 2}
                    r={vertexRadius * 0.7}
                    fill="#888"
                    onPointerDown={(event) => insert(ringIndex, point, event)}
                  />
                );
              })];
            }
            if (mode === "curve") {
              const handleSize = vertexRadius * 0.65;
              return [...vertices, ...ring.flatMap((node, point) => {
                const anchors = cornerAnchors(ring, point);
                if (!anchors) return [];
                const { p1, p2 } = anchors;
                return [
                  <line
                    key={`hl-in-${ringIndex}-${point}`}
                    x1={node.p[0]} y1={node.p[1]} x2={p1[0]} y2={p1[1]}
                    stroke="var(--c-olive)" strokeWidth={stroke * 0.6} strokeDasharray={`${stroke}`}
                  />,
                  <line
                    key={`hl-out-${ringIndex}-${point}`}
                    x1={node.p[0]} y1={node.p[1]} x2={p2[0]} y2={p2[1]}
                    stroke="var(--c-olive)" strokeWidth={stroke * 0.6} strokeDasharray={`${stroke}`}
                  />,
                  <rect
                    key={`h-in-${ringIndex}-${point}`}
                    x={p1[0] - handleSize} y={p1[1] - handleSize} width={handleSize * 2} height={handleSize * 2}
                    fill="var(--c-olive)"
                    onPointerDown={(event) => handleDown(ringIndex, point, "in", event)}
                  />,
                  <rect
                    key={`h-out-${ringIndex}-${point}`}
                    x={p2[0] - handleSize} y={p2[1] - handleSize} width={handleSize * 2} height={handleSize * 2}
                    fill="var(--c-olive)"
                    onPointerDown={(event) => handleDown(ringIndex, point, "out", event)}
                  />,
                ];
              })];
            }
            return vertices;
          })}
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost text-xs" disabled={busy || historyIndex === 0} onClick={() => step(historyIndex - 1)}>Undo</button>
        <button className="btn btn-ghost text-xs" disabled={busy || historyIndex === history.length - 1} onClick={() => step(historyIndex + 1)}>Redo</button>
        <button
          className="btn btn-ghost text-xs"
          disabled={busy || !changed}
          title="Undo every change made in this session only, back to how the cutout looked when this editor opened"
          onClick={() => commit(initialRef.current)}
        >
          Reset
        </button>
        {photoBaselineRef.current && (
          <button
            className="btn btn-ghost text-xs"
            disabled={busy || !diverged}
            title="Discard every physical-cutout edit — this session's and any earlier one's — and restore the shape auto-derived from the accepted photo selection"
            onClick={() => photoBaselineRef.current && commit(photoBaselineRef.current)}
          >
            Revert to photo selection
          </button>
        )}
        <div className="flex-1" />
        <button className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !changed || current.exterior.length < 3} onClick={() => onSave(bakedCurrent, toOutlineCurves(current))}>
          {busy ? "Regenerating…" : "Save cutout and regenerate"}
        </button>
      </div>
    </section>
  );
}
