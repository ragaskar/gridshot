import { useEffect, useMemo, useRef, useState } from "react";
import {
  combineLibrary,
  combineLibrarySlice,
  combinePreview,
  combinePreviewGlb,
  type CombinePreview,
  type CombineTool,
  type CombineToolOverride,
  type BinStyle,
  type Placement,
} from "../api";
import { BinViewer } from "./BinViewer";

const PAL = ["#d65a54", "#5ab478", "#548cd6", "#e6be46", "#c85ac8", "#50c8c8", "#e69646", "#a050d6"];
const OVERFLOW_COLOR = "#ff4d4d";

type Pt = [number, number];

/** Apply a placement to a centroid-normalised stamp — rotate CCW about the
 *  origin (matching shapely on the server), then translate. */
function placed(stamp: Pt[], tx: number, ty: number, rot: number): Pt[] {
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return stamp.map(([x, y]) => [x * c - y * s + tx, x * s + y * c + ty]);
}

function placedPoint(point: Pt, tx: number, ty: number, rot: number): Pt {
  return placed([point], tx, ty, rot)[0];
}

function bboxOf(poly: Pt[]): { minx: number; maxx: number; miny: number; maxy: number } {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
}

function placementsFor(tools: CombineTool[]): Placement[] {
  return tools.map(({ id, tx, ty, rot }) => ({ id, tx, ty, rot }));
}

/** Interactive multi-tool-bin editor: auto-packed layout you can drag + rotate,
 *  inspect as the exact generated solid, then export the arrangement as one 3MF. */
export function CombineEditor({
  ids,
  overallHeight,
  lip,
  onClose,
}: {
  ids: string[];
  overallHeight: number | null;
  lip: boolean;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<CombinePreview | null>(null);
  const [tools, setTools] = useState<CombineTool[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"arrange" | "preview">("arrange");
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [binStyle, setBinStyle] = useState<BinStyle>("pocket");
  const [magnetHoles, setMagnetHoles] = useState(false);
  const [magnetHoleDiameter, setMagnetHoleDiameter] = useState("6.5");
  const [magnetHoleDepth, setMagnetHoleDepth] = useState("2");
  const [nudge, setNudge] = useState("0.1");
  const [sliceDialogOpen, setSliceDialogOpen] = useState(false);
  const [sliceThickness, setSliceThickness] = useState("1.0"); // mirrors grid_mod.SLICE_THICKNESS_MM
  const [lockedRotations, setLockedRotations] = useState<Set<string>>(new Set());
  const [forceSize, setForceSize] = useState(false);
  const [forceGx, setForceGx] = useState("");
  const [forceGy, setForceGy] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const arrangeRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ ids: string[]; offsets: Map<string, { ox: number; oy: number }> } | null>(null);
  const previewSequence = useRef(0);
  const glbUrlRef = useRef<string | null>(null);

  const selectedTools = tools.filter((t) => selectedIds.has(t.id));
  const selectedTool = selectedTools.length === 1 ? selectedTools[0] : null;
  const isMulti = selectedTools.length > 1;

  /** Plain click replaces the selection with just this tool (unless it's
   *  already part of the current multi-selection, in which case the whole
   *  group stays selected so a drag can move it together); shift-click
   *  toggles membership. Shared by the SVG polygons and the tool-list rows
   *  so the two entry points can't drift apart. */
  function nextSelection(id: string, shiftKey: boolean): Set<string> {
    if (shiftKey) {
      const next = new Set(selectedIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    }
    return selectedIds.has(id) ? selectedIds : new Set([id]);
  }

  function overridesFor(tools: CombineTool[]): CombineToolOverride[] {
    return tools.map(({
      id, rot, finger_hole_override, clearance_mm_override,
      finger_hole_side_flip_override, finger_hole_offset_mm_override,
    }) => ({
      id,
      finger_hole: finger_hole_override,
      clearance_mm: clearance_mm_override,
      finger_hole_side_flip: finger_hole_side_flip_override,
      finger_hole_offset_mm: finger_hole_offset_mm_override,
      locked_rotation_deg: lockedRotations.has(id) ? rot : null,
    }));
  }

  async function load(
    placements?: Placement[],
    overrides: CombineToolOverride[] = overridesFor(tools),
    style: BinStyle = binStyle,
    force: [number, number] | null = forceSize && forceGx && forceGy
      ? [Number(forceGx), Number(forceGy)]
      : null,
  ) {
    setBusy(true);
    setErr(null);
    try {
      const p = await combinePreview(
        ids,
        placements ?? null,
        overallHeight,
        lip,
        overrides,
        style,
        magnetHoles,
        Number(magnetHoleDiameter),
        Number(magnetHoleDepth),
        force ? force[0] : null,
        force ? force[1] : null,
      );
      setMeta(p);
      setTools(p.tools);
      setSelectedIds((current) => new Set([...current].filter((id) => p.tools.some((tool) => tool.id === id))));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { load(); /* auto-pack on open */ }, []); // eslint-disable-line

  const idsKey = ids.join("|");
  const geometryKey = useMemo(
    () => JSON.stringify(tools.map((tool) => [
      tool.id,
      tool.tx,
      tool.ty,
      tool.rot,
      tool.finger_hole_override,
      tool.clearance_mm_override,
      tool.finger_hole_side_flip_override,
      tool.finger_hole_offset_mm_override,
    ])),
    [tools],
  );

  // live footprint from the current arrangement (mirrors the server's auto_grid) —
  // unless "force bin size" is on, in which case the footprint is LOCKED to the
  // forced gx/gy and never re-fit to wherever tools currently sit (drag included).
  const layout = useMemo(() => {
    if (!meta || !tools.length) return null;
    const polys = tools.map((t) => placed(t.stamp, t.tx, t.ty, t.rot));
    const fingerCircles = tools.flatMap((tool) => tool.finger_holes.map(([x, y, diameter]) => {
      const [cx, cy] = placedPoint([x, y], tool.tx, tool.ty, tool.rot);
      return { toolId: tool.id, cx, cy, radius: diameter / 2 };
    }));
    const xs = [
      ...polys.flat().map((p) => p[0]),
      ...fingerCircles.flatMap((hole) => [hole.cx - hole.radius, hole.cx + hole.radius]),
    ];
    const ys = [
      ...polys.flat().map((p) => p[1]),
      ...fingerCircles.flatMap((hole) => [hole.cy - hole.radius, hole.cy + hole.radius]),
    ];
    const minx = Math.min(...xs), maxx = Math.max(...xs);
    const miny = Math.min(...ys), maxy = Math.max(...ys);
    const { pitch, bin_size, wall } = meta;

    const locked = forceSize && Number(forceGx) > 0 && Number(forceGy) > 0;
    let gx: number, gy: number, cx: number, cy: number;
    if (locked) {
      // Fixed footprint — the server always re-centres the tool group's own
      // bbox to world origin (0,0) on every load(), so that's the bin's
      // stable centre between round-trips, independent of local drags.
      gx = Math.max(1, Math.round(Number(forceGx)));
      gy = Math.max(1, Math.round(Number(forceGy)));
      cx = 0;
      cy = 0;
    } else {
      gx = Math.max(1, Math.ceil((maxx - minx + 2 * wall + (pitch - bin_size)) / pitch));
      gy = Math.max(1, Math.ceil((maxy - miny + 2 * wall + (pitch - bin_size)) / pitch));
      cx = (minx + maxx) / 2;
      cy = (miny + maxy) / 2;
    }
    const ow = pitch * gx - (pitch - bin_size), od = pitch * gy - (pitch - bin_size);

    const overflowIds = new Set<string>();
    if (locked) {
      const EPS = 1e-6;
      const boundMinX = cx - ow / 2, boundMaxX = cx + ow / 2;
      const boundMinY = cy - od / 2, boundMaxY = cy + od / 2;
      tools.forEach((t, i) => {
        const outPoly = polys[i].some(([x, y]) =>
          x < boundMinX - EPS || x > boundMaxX + EPS || y < boundMinY - EPS || y > boundMaxY + EPS);
        const outFinger = fingerCircles.some((hole) => hole.toolId === t.id && (
          hole.cx - hole.radius < boundMinX - EPS || hole.cx + hole.radius > boundMaxX + EPS ||
          hole.cy - hole.radius < boundMinY - EPS || hole.cy + hole.radius > boundMaxY + EPS
        ));
        if (outPoly || outFinger) overflowIds.add(t.id);
      });
    }

    // The viewport must show overflowing geometry too, not just the locked
    // footprint, so a tool that's crossed the edge stays visible.
    const boxMinX = Math.min(cx - ow / 2, minx), boxMaxX = Math.max(cx + ow / 2, maxx);
    const boxMinY = Math.min(cy - od / 2, miny), boxMaxY = Math.max(cy + od / 2, maxy);
    const viewCx = (boxMinX + boxMaxX) / 2, viewCy = (boxMinY + boxMaxY) / 2;
    const viewW = boxMaxX - boxMinX, viewH = boxMaxY - boxMinY;

    return { polys, fingerCircles, gx, gy, ow, od, cx, cy, locked, overflowIds, viewCx, viewCy, viewW, viewH };
  }, [tools, meta, forceSize, forceGx, forceGy]);

  const hasOverflow = Boolean(layout?.locked && layout.overflowIds.size > 0);

  // Generate after the arrangement settles. This endpoint calls the same solid
  // builder as 3MF export; no browser-side mesh approximation is involved.
  useEffect(() => {
    if (!meta || tools.length < 2) return;
    const sequence = ++previewSequence.current;
    if (hasOverflow) {
      setPreviewBusy(false);
      setPreviewErr("A tool extends past the locked bin size — move it back inside, or adjust the forced dimensions, before rendering.");
      return;
    }
    const placements = placementsFor(tools);
    const overrides = overridesFor(tools);
    setPreviewBusy(true);
    setPreviewErr(null);
    const forceGxVal = forceSize && forceGx && forceGy ? Number(forceGx) : null;
    const forceGyVal = forceSize && forceGx && forceGy ? Number(forceGy) : null;
    const timer = window.setTimeout(() => {
      combinePreviewGlb(
        ids, placements, overallHeight, lip, overrides, binStyle,
        magnetHoles, Number(magnetHoleDiameter), Number(magnetHoleDepth),
        forceGxVal, forceGyVal,
      )
        .then((blob) => {
          if (sequence !== previewSequence.current) return;
          const nextUrl = URL.createObjectURL(blob);
          if (glbUrlRef.current) URL.revokeObjectURL(glbUrlRef.current);
          glbUrlRef.current = nextUrl;
          setGlbUrl(nextUrl);
        })
        .catch((reason) => {
          if (sequence === previewSequence.current) {
            setPreviewErr((reason as Error).message);
          }
        })
        .finally(() => {
          if (sequence === previewSequence.current) setPreviewBusy(false);
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [idsKey, geometryKey, overallHeight, lip, binStyle, magnetHoles, magnetHoleDiameter, magnetHoleDepth, forceSize, forceGx, forceGy, hasOverflow, Boolean(meta)]); // eslint-disable-line

  useEffect(() => () => {
    previewSequence.current += 1;
    if (glbUrlRef.current) URL.revokeObjectURL(glbUrlRef.current);
  }, []);

  function toData(e: React.PointerEvent): Pt {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const d = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return [d.x, d.y];
  }
  function down(id: string, e: React.PointerEvent) {
    e.stopPropagation();
    arrangeRef.current?.focus();
    const nextIds = nextSelection(id, e.shiftKey);
    setSelectedIds(nextIds);
    const [mx, my] = toData(e);
    const offsets = new Map<string, { ox: number; oy: number }>();
    tools.forEach((t) => {
      if (nextIds.has(t.id)) offsets.set(t.id, { ox: mx - t.tx, oy: my - t.ty });
    });
    drag.current = { ids: [...nextIds], offsets };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drag.current) return;
    const [mx, my] = toData(e);
    const { offsets } = drag.current;
    setTools((ts) => ts.map((t) => {
      const o = offsets.get(t.id);
      return o ? { ...t, tx: mx - o.ox, ty: my - o.oy } : t;
    }));
  }
  function rotate(deg: number) {
    if (!selectedTool) return;
    const id = selectedTool.id;
    setTools((ts) => ts.map((t) => (t.id === id ? { ...t, rot: t.rot + deg } : t)));
  }
  /** Align every selected tool to a common edge/center of the selection's own
   *  bounding boxes (each tool's placed `stamp` outline, not its finger-hole
   *  scallop). Horizontal alignment only ever changes tx; vertical only ty. */
  function alignSelected(edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
    if (selectedTools.length < 2) return;
    const boxes = new Map(selectedTools.map((t) => [t.id, bboxOf(placed(t.stamp, t.tx, t.ty, t.rot))]));
    const all = [...boxes.values()];
    if (edge === "left" || edge === "right" || edge === "hcenter") {
      const target = edge === "left" ? Math.min(...all.map((b) => b.minx))
        : edge === "right" ? Math.max(...all.map((b) => b.maxx))
        : (Math.min(...all.map((b) => b.minx)) + Math.max(...all.map((b) => b.maxx))) / 2;
      setTools((ts) => ts.map((t) => {
        const b = boxes.get(t.id);
        if (!b) return t;
        const from = edge === "left" ? b.minx : edge === "right" ? b.maxx : (b.minx + b.maxx) / 2;
        return { ...t, tx: t.tx + (target - from) };
      }));
    } else {
      const target = edge === "top" ? Math.min(...all.map((b) => b.miny))
        : edge === "bottom" ? Math.max(...all.map((b) => b.maxy))
        : (Math.min(...all.map((b) => b.miny)) + Math.max(...all.map((b) => b.maxy))) / 2;
      setTools((ts) => ts.map((t) => {
        const b = boxes.get(t.id);
        if (!b) return t;
        const from = edge === "top" ? b.miny : edge === "bottom" ? b.maxy : (b.miny + b.maxy) / 2;
        return { ...t, ty: t.ty + (target - from) };
      }));
    }
  }
  function nudgeSelected(dx: number, dy: number) {
    if (!selectedIds.size) return;
    setTools((ts) => ts.map((t) => (selectedIds.has(t.id) ? { ...t, tx: t.tx + dx, ty: t.ty + dy } : t)));
  }
  function handleArrangeKeyDown(e: React.KeyboardEvent) {
    if (!selectedIds.size) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
    const step = (Number(nudge) || 0.1) * (e.shiftKey ? 10 : 1);
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = deltas[e.key];
    if (!d) return;
    e.preventDefault();
    nudgeSelected(d[0], d[1]);
  }
  function setRotation(deg: number) {
    if (!selectedTool || !Number.isFinite(deg)) return;
    const id = selectedTool.id;
    setTools((ts) => ts.map((t) => (t.id === id ? { ...t, rot: deg } : t)));
  }

  async function setFingerHole(enabled: boolean) {
    if (!selectedTool) return;
    const id = selectedTool.id;
    const updated = tools.map((tool) => tool.id === id ? {
      ...tool,
      finger: enabled,
      finger_hole: enabled,
      finger_hole_override: enabled === tool.finger_hole_inherited ? null : enabled,
    } : tool);
    await load(placementsFor(updated), overridesFor(updated));
  }

  async function setClearance(mm: number | null) {
    if (!selectedTool) return;
    const id = selectedTool.id;
    const updated = tools.map((tool) => tool.id === id ? {
      ...tool,
      clearance_mm: mm ?? tool.clearance_mm_inherited,
      clearance_mm_override: mm === tool.clearance_mm_inherited ? null : mm,
    } : tool);
    await load(placementsFor(updated), overridesFor(updated));
  }

  async function setFingerHoleSideFlip(flip: boolean | null) {
    if (!selectedTool) return;
    const id = selectedTool.id;
    const updated = tools.map((tool) => tool.id === id ? {
      ...tool,
      finger_hole_side_flip: flip ?? false,
      finger_hole_side_flip_override: flip,
    } : tool);
    await load(placementsFor(updated), overridesFor(updated));
  }

  async function setFingerHoleOffset(mm: number | null) {
    if (!selectedTool) return;
    const id = selectedTool.id;
    const updated = tools.map((tool) => tool.id === id ? {
      ...tool,
      finger_hole_offset_mm: mm ?? 0,
      finger_hole_offset_mm_override: mm,
    } : tool);
    await load(placementsFor(updated), overridesFor(updated));
  }

  async function exportBin() {
    setBusy(true);
    setErr(null);
    try {
      const force = forceSize && forceGx && forceGy;
      await combineLibrary(
        ids,
        placementsFor(tools),
        overallHeight,
        lip,
        overridesFor(tools),
        binStyle,
        magnetHoles,
        Number(magnetHoleDiameter),
        Number(magnetHoleDepth),
        force ? Number(forceGx) : null,
        force ? Number(forceGy) : null,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function exportSlice(thicknessMm: number) {
    setBusy(true);
    setErr(null);
    try {
      const force = forceSize && forceGx && forceGy;
      await combineLibrarySlice(
        ids,
        placementsFor(tools),
        overallHeight,
        lip,
        overridesFor(tools),
        binStyle,
        magnetHoles,
        Number(magnetHoleDiameter),
        Number(magnetHoleDepth),
        thicknessMm,
        force ? Number(forceGx) : null,
        force ? Number(forceGy) : null,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const color = (i: number) => PAL[i % PAL.length];
  const displayedRotation = selectedTool
    ? ((((selectedTool.rot + 180) % 360) + 360) % 360) - 180
    : 0;
  const m = 8; // viewport margin (mm)
  const vb = layout
    ? `${layout.viewCx - layout.viewW / 2 - m} ${layout.viewCy - layout.viewH / 2 - m} ${layout.viewW + 2 * m} ${layout.viewH + 2 * m}`
    : "0 0 100 100";

  const alignButtons = (
    <div className="mt-3 border-t border-line pt-3">
      <span className="font-mono text-[10px] uppercase text-muted">Align</span>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("left")}>⇤ Left</button>
        <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("hcenter")}>↔ Center</button>
        <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("right")}>Right ⇥</button>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("top")}>⇡ Top</button>
        <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("vcenter")}>↕ Middle</button>
        <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("bottom")}>Bottom ⇣</button>
      </div>
    </div>
  );

  return (
    <div className="panel !p-4 sm:!p-6 w-full max-w-[980px] max-h-[calc(100dvh-2rem)] overflow-auto">
      <div className="grp-label mb-2 flex flex-wrap justify-between gap-2">
        <span>Arrange multi-tool bin</span>
        {layout && (
          <span className="text-muted">
            {layout.gx}×{layout.gy}u{layout.locked ? " (locked)" : ""} · {meta!.overall_height_mm}mm tall · {binStyle}
            {binStyle === "grid" ? ` · ${meta!.available_cells.length} live sockets` : ""}
          </span>
        )}
      </div>
      <p className="font-mono text-[10px] text-muted mb-3">
        Drag a tool to move it · select one and use Rotate · Auto-pack re-solves · live grid adds only complete sockets that fit outside every tool wall.
      </p>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <div className="mb-2 grid grid-cols-2 gap-1">
            <button
              className={`btn text-xs ${view === "arrange" ? "border-teal text-teal" : "btn-ghost"}`}
              onClick={() => setView("arrange")}
            >
              Arrange 2D
            </button>
            <button
              className={`btn text-xs ${view === "preview" ? "border-teal text-teal" : "btn-ghost"}`}
              onClick={() => setView("preview")}
            >
              Preview 3D
            </button>
          </div>
          <div
            ref={arrangeRef}
            className="border border-line bg-field min-w-0 overflow-hidden"
            style={{ borderRadius: 2 }}
            tabIndex={0}
            onKeyDown={handleArrangeKeyDown}
          >
            {view === "arrange" ? <svg
            ref={svgRef}
            viewBox={vb}
            className="w-full touch-none"
            style={{ minHeight: 280, maxHeight: "60vh", cursor: drag.current ? "grabbing" : "default" }}
            preserveAspectRatio="xMidYMid meet"
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            onPointerDown={() => setSelectedIds(new Set())}
          >
            {layout && (
              <>
                {/* bin footprint + gridfinity cells */}
                <rect x={layout.cx - layout.ow / 2} y={layout.cy - layout.od / 2}
                  width={layout.ow} height={layout.od} fill="#00000022"
                  stroke="#6b7280" strokeWidth={0.6} rx={2} />
                {Array.from({ length: layout.gx - 1 }, (_, i) => {
                  const x = layout.cx - layout.ow / 2 + (i + 1) * meta!.pitch;
                  return <line key={"v" + i} x1={x} y1={layout.cy - layout.od / 2} x2={x} y2={layout.cy + layout.od / 2} stroke="#3a4046" strokeWidth={0.4} />;
                })}
                {Array.from({ length: layout.gy - 1 }, (_, i) => {
                  const y = layout.cy - layout.od / 2 + (i + 1) * meta!.pitch;
                  return <line key={"h" + i} x1={layout.cx - layout.ow / 2} y1={y} x2={layout.cx + layout.ow / 2} y2={y} stroke="#3a4046" strokeWidth={0.4} />;
                })}
                {binStyle === "grid" && meta!.available_cells.map(([cellX, cellY]) => {
                  const x = layout.cx + cellX - meta!.pitch / 2;
                  const y = layout.cy + cellY - meta!.pitch / 2;
                  return <rect
                    key={`socket-${cellX}-${cellY}`}
                    x={x + 2.5}
                    y={y + 2.5}
                    width={meta!.pitch - 5}
                    height={meta!.pitch - 5}
                    rx={3}
                    fill="#2f8f9522"
                    stroke="#2f8f95"
                    strokeWidth={0.7}
                  />;
                })}
                {/* finger-access scallops are part of the exact cut envelope */}
                {layout.fingerCircles.map((hole, index) => {
                  const toolIndex = tools.findIndex((tool) => tool.id === hole.toolId);
                  const holeColor = layout.overflowIds.has(hole.toolId) ? OVERFLOW_COLOR : color(toolIndex);
                  return <circle
                    key={`${hole.toolId}-finger-${index}`}
                    cx={hole.cx}
                    cy={hole.cy}
                    r={hole.radius}
                    fill={holeColor + "2f"}
                    stroke={holeColor}
                    strokeWidth={0.6}
                    strokeDasharray="2 1"
                  />;
                })}
                {/* cleared pockets — turn red once locked and past the locked footprint */}
                {tools.map((t, i) => {
                  const toolColor = layout.overflowIds.has(t.id) ? OVERFLOW_COLOR : color(i);
                  return <polygon
                    key={t.id}
                    points={layout.polys[i].map((p) => `${p[0]},${p[1]}`).join(" ")}
                    fill={toolColor + (selectedIds.has(t.id) ? "88" : "55")}
                    stroke={toolColor} strokeWidth={selectedIds.has(t.id) ? 1.2 : 0.7}
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => down(t.id, e)}
                  />;
                })}
              </>
            )}
            </svg> : (
              <div className="relative h-[clamp(280px,55vh,520px)] w-full">
                {glbUrl && <BinViewer url={glbUrl} />}
                {!glbUrl && !previewErr && (
                  <div className="absolute inset-0 grid place-items-center font-mono text-xs text-muted">
                    Building exact bin preview…
                  </div>
                )}
                {previewErr && (
                  <div className="absolute inset-0 grid place-items-center p-6 text-center font-mono text-xs text-orange">
                    {previewErr}
                  </div>
                )}
                <span className="absolute bottom-2 left-3 font-mono text-[10px] text-line">
                  EXACT EXPORT GEOMETRY{previewBusy ? " · UPDATING" : ""}
                </span>
                <span className="absolute bottom-2 right-3 font-mono text-[10px] text-line">DRAG TO ORBIT</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          <div>
            <span className="font-mono text-[10px] uppercase text-muted">Bin style</span>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(["pocket", "corral", "grid"] as BinStyle[]).map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={binStyle === style}
                  className={`btn !px-1 !py-2 text-[10px] ${binStyle === style ? "border-teal text-teal" : "btn-ghost"}`}
                  disabled={busy}
                  onClick={() => {
                    setBinStyle(style);
                    void load(placementsFor(tools), overridesFor(tools), style);
                  }}
                >
                  {style === "pocket" ? "Pocket" : style === "corral" ? "Corral" : "Live grid"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={forceSize}
                disabled={busy}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setForceSize(checked);
                  let gx = forceGx, gy = forceGy;
                  if (checked && !gx && !gy && layout) {
                    gx = String(layout.gx);
                    gy = String(layout.gy);
                    setForceGx(gx);
                    setForceGy(gy);
                  }
                  void load(
                    placementsFor(tools), overridesFor(tools), binStyle,
                    checked && gx && gy ? [Number(gx), Number(gy)] : null,
                  );
                }}
              />
              <span className="font-mono text-[10px] uppercase text-muted">Force bin size</span>
            </label>
            {forceSize && (
              <div className="mt-1 grid grid-cols-2 gap-1">
                <label className="min-w-0">
                  <span className="block font-mono text-[9px] uppercase text-muted">Width (units)</span>
                  <input
                    aria-label="Forced bin width in gridfinity units"
                    className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                    type="number" step={1} min={1}
                    value={forceGx}
                    onChange={(event) => setForceGx(event.target.value)}
                    onBlur={() => void load(placementsFor(tools), overridesFor(tools))}
                  />
                </label>
                <label className="min-w-0">
                  <span className="block font-mono text-[9px] uppercase text-muted">Depth (units)</span>
                  <input
                    aria-label="Forced bin depth in gridfinity units"
                    className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                    type="number" step={1} min={1}
                    value={forceGy}
                    onChange={(event) => setForceGy(event.target.value)}
                    onBlur={() => void load(placementsFor(tools), overridesFor(tools))}
                  />
                </label>
              </div>
            )}
          </div>
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={magnetHoles}
                disabled={busy}
                onChange={(event) => {
                  setMagnetHoles(event.target.checked);
                  void load(placementsFor(tools), overridesFor(tools));
                }}
              />
              <span className="font-mono text-[10px] uppercase text-muted">Magnet holes</span>
            </label>
            {magnetHoles && (
              <div className="mt-1 grid grid-cols-2 gap-1">
                <label className="min-w-0">
                  <span className="block font-mono text-[9px] uppercase text-muted">Diameter (mm)</span>
                  <input
                    aria-label="Magnet hole diameter"
                    className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                    type="number" step={0.1} min={0.1}
                    value={magnetHoleDiameter}
                    onChange={(event) => setMagnetHoleDiameter(event.target.value)}
                    onBlur={() => void load(placementsFor(tools), overridesFor(tools))}
                  />
                </label>
                <label className="min-w-0">
                  <span className="block font-mono text-[9px] uppercase text-muted">Depth (mm)</span>
                  <input
                    aria-label="Magnet hole depth"
                    className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                    type="number" step={0.1} min={0.1} max={4.7}
                    value={magnetHoleDepth}
                    onChange={(event) => setMagnetHoleDepth(event.target.value)}
                    onBlur={() => void load(placementsFor(tools), overridesFor(tools))}
                  />
                </label>
              </div>
            )}
          </div>
          <label className="block">
            <span className="font-mono text-[10px] uppercase text-muted">Rotation (degrees)</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                className="mono-input min-w-0 flex-1 !px-2 !py-1 !text-sm"
                type="number"
                step={0.1}
                disabled={!selectedTool}
                value={selectedTool ? Number(displayedRotation.toFixed(1)) : ""}
                placeholder="Select a tool"
                onChange={(event) => setRotation(Number(event.target.value))}
              />
              <span className="font-mono text-xs text-muted">°</span>
            </div>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={!selectedTool}
              checked={selectedTool !== null && lockedRotations.has(selectedTool.id)}
              onChange={(event) => {
                if (!selectedTool) return;
                const id = selectedTool.id;
                setLockedRotations((current) => {
                  const next = new Set(current);
                  event.target.checked ? next.add(id) : next.delete(id);
                  return next;
                });
              }}
            />
            <span className="font-mono text-[10px] uppercase text-muted">Lock rotation (auto-pack)</span>
          </label>
          <input
            aria-label="Tool rotation"
            className="w-full accent-teal"
            type="range"
            min={-180}
            max={180}
            step={1}
            disabled={!selectedTool}
            value={displayedRotation}
            onChange={(event) => setRotation(Number(event.target.value))}
          />
          <div className="grid grid-cols-4 gap-1">
            <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={!selectedTool} onClick={() => rotate(-15)}>−15°</button>
            <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={!selectedTool} onClick={() => rotate(-1)}>−1°</button>
            <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={!selectedTool} onClick={() => rotate(1)}>+1°</button>
            <button className="btn btn-ghost text-[10px] !px-1 !py-2" disabled={!selectedTool} onClick={() => rotate(15)}>+15°</button>
          </div>
          <label className="block">
            <span className="font-mono text-[10px] uppercase text-muted">Nudge step (mm)</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                aria-label="Keyboard nudge step in millimetres"
                className="mono-input min-w-0 flex-1 !px-2 !py-1 !text-sm"
                type="number"
                step={0.05}
                min={0.01}
                value={nudge}
                onChange={(event) => setNudge(event.target.value)}
              />
            </div>
            <p className="mt-1 font-mono text-[9px] text-muted">
              Select a tool, arrow keys to nudge · Shift+arrow for 10×.
            </p>
          </label>
          {selectedTool ? (
            <div className="border border-line bg-field p-3 font-mono text-[10px]" style={{ borderRadius: 2 }}>
              <div className="mb-2 truncate text-xs text-knockout">
                {selectedTool.label || selectedTool.id.slice(0, 8)}
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-muted">
                <dt>{binStyle === "corral" ? "Tool recess" : "Pocket depth"}</dt>
                <dd className="text-knockout">{selectedTool.depth_mm} mm</dd>
                <dt>Depth source</dt>
                <dd className="text-right text-knockout">{selectedTool.depth_mode}</dd>
              </dl>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                <div className="min-w-0">
                  <div className="text-knockout">Clearance</div>
                  <div className="truncate text-muted">
                    {selectedTool.clearance_mm_override === null ? "Inherited from library" : "Override for this bin"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    aria-label="Clearance override in millimetres"
                    className="mono-input min-w-0 w-16 !px-2 !py-1 !text-sm"
                    type="number" step={0.1} min={0}
                    disabled={busy}
                    defaultValue={selectedTool.clearance_mm}
                    key={`${selectedTool.id}-clearance-${selectedTool.clearance_mm}`}
                    onBlur={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value !== selectedTool.clearance_mm) void setClearance(value);
                    }}
                  />
                  <span className="text-muted">mm</span>
                </div>
              </div>
              {selectedTool.clearance_mm_override !== null && (
                <button
                  className="mt-2 w-full text-left text-teal hover:text-knockout"
                  disabled={busy}
                  onClick={() => void setClearance(null)}
                >
                  ↩ Use library setting ({selectedTool.clearance_mm_inherited} mm)
                </button>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                <div className="min-w-0">
                  <div className="text-knockout">Finger access</div>
                  <div className="truncate text-muted">
                    {selectedTool.finger_hole_override === null ? "Inherited from library" : "Override for this bin"}
                  </div>
                </div>
                <button
                  aria-pressed={selectedTool.finger_hole}
                  className={`btn shrink-0 !px-3 !py-1 text-[10px] ${selectedTool.finger_hole ? "border-teal text-teal" : "btn-ghost"}`}
                  disabled={busy}
                  onClick={() => void setFingerHole(!selectedTool.finger_hole)}
                >
                  {selectedTool.finger_hole ? "On" : "Off"}
                </button>
              </div>
              {selectedTool.finger_hole_override !== null && (
                <button
                  className="mt-2 w-full text-left text-teal hover:text-knockout"
                  disabled={busy}
                  onClick={() => void setFingerHole(selectedTool.finger_hole_inherited)}
                >
                  ↩ Use library setting ({selectedTool.finger_hole_inherited ? "on" : "off"})
                </button>
              )}
              {selectedTool.finger_hole && selectedTool.finger_hole_side !== "center" && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-knockout">Switch sides</span>
                    <button
                      aria-pressed={selectedTool.finger_hole_side_flip}
                      className={`btn shrink-0 !px-3 !py-1 text-[10px] ${selectedTool.finger_hole_side_flip ? "border-teal text-teal" : "btn-ghost"}`}
                      disabled={busy}
                      onClick={() => void setFingerHoleSideFlip(selectedTool.finger_hole_side_flip ? null : true)}
                    >
                      {selectedTool.finger_hole_side_flip ? "Flipped" : "Default"}
                    </button>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-muted">
                      <span>Position</span>
                      <span className="text-knockout">{selectedTool.finger_hole_offset_mm} mm</span>
                    </div>
                    <input
                      aria-label="Finger-hole position offset"
                      className="w-full accent-teal"
                      type="range"
                      min={-selectedTool.finger_hole_offset_mm_max}
                      max={selectedTool.finger_hole_offset_mm_max}
                      step={0.5}
                      disabled={busy}
                      value={selectedTool.finger_hole_offset_mm}
                      onChange={(event) => void setFingerHoleOffset(Number(event.target.value))}
                    />
                  </div>
                  {selectedTool.finger_hole_offset_mm_override !== null && (
                    <button
                      className="w-full text-left text-teal hover:text-knockout"
                      disabled={busy}
                      onClick={() => void setFingerHoleOffset(null)}
                    >
                      ↩ Reset position (0 mm)
                    </button>
                  )}
                </div>
              )}
              {selectedTool.finger_hole && selectedTool.finger_hole_side === "center" && (
                <p className="mt-3 border-t border-line pt-3 text-muted">
                  This tool's shape doesn't sit on a single side — switch-sides/position
                  controls aren't available.
                </p>
              )}
              {alignButtons}
            </div>
          ) : isMulti ? (
            <div className="border border-line bg-field p-3 font-mono text-[10px]" style={{ borderRadius: 2 }}>
              <div className="mb-2 truncate text-xs text-knockout">
                {selectedTools.length} tools selected
              </div>
              <p className="text-muted">
                {selectedTools.map((t) => t.label || t.id.slice(0, 6)).join(", ")}
              </p>
              {alignButtons}
            </div>
          ) : (
            <div className="border border-line p-3 font-mono text-[10px] text-muted">Select a tool (shift-click to select more) to inspect its effective settings.</div>
          )}
          <div className="max-h-[38vh] overflow-auto space-y-1">
            {tools.map((t, i) => (
              <button
                key={t.id}
                className="w-full border px-2 py-1 text-left font-mono text-[10px]"
                style={{ borderRadius: 2, borderColor: selectedIds.has(t.id) ? color(i) : "var(--c-line)" }}
                onClick={(e) => {
                  setSelectedIds(nextSelection(t.id, e.shiftKey));
                  arrangeRef.current?.focus();
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0" style={{ width: 8, height: 8, background: color(i), display: "inline-block", borderRadius: 2 }} />
                  <span className="truncate text-knockout">{t.label || t.id.slice(0, 6)}</span>
                  {lockedRotations.has(t.id) && <span title="Rotation locked for auto-pack">🔒</span>}
                </span>
                <span className="mt-1 flex flex-wrap gap-x-2 pl-4 text-muted">
                  <span>Clearance {t.clearance_mm} mm</span>
                  <span>Recess {t.depth_mm} mm</span>
                  <span className={t.finger_hole ? "text-teal" : "text-line"}>Finger {t.finger_hole ? "on" : "off"}</span>
                </span>
              </button>
            ))}
          </div>
          {err && <p className="font-mono text-[10px] text-orange">{err}</p>}
          {hasOverflow && (
            <p className="font-mono text-[10px] text-orange">
              A tool crosses the locked bin edge — move it back inside, or adjust the forced size, to export or render.
            </p>
          )}
          <button className="btn w-full text-xs" disabled={busy} onClick={() => load(undefined, overridesFor(tools), binStyle)}>↻ Auto-pack</button>
          <button className="btn btn-primary w-full" disabled={busy || !tools.length || Boolean(err) || hasOverflow} onClick={exportBin}>
            ↓ Export bin (3MF)
          </button>
          <button
            className="btn w-full text-xs"
            disabled={busy || !tools.length || Boolean(err) || hasOverflow}
            onClick={() => setSliceDialogOpen(true)}
            title="Thin coupon through every tool's cutout at once — print this alone to check trace tolerance before committing to the full bin"
          >
            ↓ Export slice (3MF)
          </button>
          {sliceDialogOpen && (
            <div className="border border-line bg-field p-3 font-mono text-[10px]" style={{ borderRadius: 2 }}>
              <label className="block">
                <span className="block uppercase text-muted">Slice thickness (mm)</span>
                <input
                  aria-label="Slice thickness in millimetres"
                  className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
                  type="number" step={0.1} min={0.5} max={5}
                  value={sliceThickness}
                  onChange={(event) => setSliceThickness(event.target.value)}
                />
              </label>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  className="btn text-xs"
                  onClick={() => setSliceDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary text-xs"
                  disabled={busy || hasOverflow}
                  onClick={() => {
                    setSliceDialogOpen(false);
                    void exportSlice(Number(sliceThickness));
                  }}
                >
                  Export
                </button>
              </div>
            </div>
          )}
          <button className="btn w-full" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
