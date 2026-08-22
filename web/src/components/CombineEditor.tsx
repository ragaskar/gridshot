import { useEffect, useMemo, useRef, useState } from "react";
import {
  combineLibrary,
  combineLibrarySlice,
  combinePreview,
  combinePreviewGlb,
  saveBin,
  type BinProfile,
  type CombinePreview,
  type CombineTool,
  type CombineToolOverride,
  type BinStyle,
  type Placement,
} from "../api";
import { BinViewer } from "./BinViewer";
import { commitOnChange } from "../domEvents";
import { binExportName } from "../exportNaming";
import { computeFingerAlignPlan, type FingerAlignCandidate } from "../geometry/fingerAlign";
import { binOutlinePath, cellKey, isShapeConnected, type CellKey } from "../geometry/binOutline";
import { useBinProfiles } from "../useBinProfiles";

const PAL = ["#d65a54", "#5ab478", "#548cd6", "#e6be46", "#c85ac8", "#50c8c8", "#e69646", "#a050d6"];
const OVERFLOW_COLOR = "#ff4d4d";
// Mirrors gridshot/core/gridfinity.py's CORNER_R — the 2D preview's rounding
// only needs to look right, not be manufacturing-exact (the server builds
// the real geometry), so this is a plain constant rather than fetched data.
const BIN_CORNER_R = 3.75;

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

/** The shared value across every item, or undefined if any of them differ —
 *  the one primitive every "show '–' when the selection is mixed" bulk
 *  control in the combine editor's Inspector reduces to. */
function allEqual<T, V>(items: T[], key: (item: T) => V): V | undefined {
  if (!items.length) return undefined;
  const first = key(items[0]);
  return items.every((item) => key(item) === first) ? first : undefined;
}

function placementsFor(tools: CombineTool[]): Placement[] {
  return tools.map(({ id, tx, ty, rot }) => ({ id, tx, ty, rot }));
}

/** "Combined Bin YYYY-MM-DD" using the browser's local date (not UTC). */
function defaultBinName(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `Combined Bin ${y}-${m}-${day}`;
}

/** Seed state for reopening a saved Bin Library entry, instead of the usual
 *  fresh auto-pack. Mirrors a combine request's recipe fields. `label` isn't
 *  part of that recipe (it's not sent back to /combine) — it's carried
 *  along only so exports from this reopened session are named after the
 *  saved bin, same as exporting it directly from the Bin Library list. */
export interface CombineEditorInitial {
  label: string;
  placements: Placement[];
  overrides: CombineToolOverride[];
  binStyle: BinStyle;
  lip: boolean;
  magnetHoles: boolean;
  magnetHoleDiameterMm: number;
  magnetHoleDepthMm: number;
  forceGx: number | null;
  forceGy: number | null;
  removedCells: [number, number][] | null;
  lipHeightMm: number | null;
  lipChamferTopMm: number | null;
  lipStraightMm: number | null;
  lipChamferBottomMm: number | null;
  minWallMm: number | null;
  minFloorMm: number | null;
  corralFloorMm: number | null;
  corralWallMm: number | null;
  corralBaseFlareMm: number | null;
  corralBaseReinforcementHMm: number | null;
  corralEdgeMarginMm: number | null;
  magnetHoleInsetFromEdgeMm: number | null;
}

type StructuralOverrideKey =
  | "lipHeightMm" | "lipChamferTopMm" | "lipStraightMm" | "lipChamferBottomMm"
  | "minWallMm" | "minFloorMm" | "corralFloorMm" | "corralWallMm"
  | "corralBaseFlareMm" | "corralBaseReinforcementHMm" | "corralEdgeMarginMm"
  | "magnetHoleInsetFromEdgeMm";

/** The 12 Bin Profile structural overrides — set only by picking a profile
 *  (there's no per-field UI for these here; that lives on the Bin Profiles
 *  page), but carried in state so they thread into every request and
 *  survive undo/redo like every other profile-driven field. */
type StructuralOverrides = { [K in StructuralOverrideKey]: number | null };

const BLANK_STRUCTURAL: StructuralOverrides = {
  lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
  minWallMm: null, minFloorMm: null, corralFloorMm: null, corralWallMm: null,
  corralBaseFlareMm: null, corralBaseReinforcementHMm: null, corralEdgeMarginMm: null,
  magnetHoleInsetFromEdgeMm: null,
};

function structuralFrom(source: {
  lipHeightMm: number | null; lipChamferTopMm: number | null; lipStraightMm: number | null;
  lipChamferBottomMm: number | null; minWallMm: number | null; minFloorMm: number | null;
  corralFloorMm: number | null; corralWallMm: number | null; corralBaseFlareMm: number | null;
  corralBaseReinforcementHMm: number | null; corralEdgeMarginMm: number | null;
  magnetHoleInsetFromEdgeMm: number | null;
}): StructuralOverrides {
  return {
    lipHeightMm: source.lipHeightMm,
    lipChamferTopMm: source.lipChamferTopMm,
    lipStraightMm: source.lipStraightMm,
    lipChamferBottomMm: source.lipChamferBottomMm,
    minWallMm: source.minWallMm,
    minFloorMm: source.minFloorMm,
    corralFloorMm: source.corralFloorMm,
    corralWallMm: source.corralWallMm,
    corralBaseFlareMm: source.corralBaseFlareMm,
    corralBaseReinforcementHMm: source.corralBaseReinforcementHMm,
    corralEdgeMarginMm: source.corralEdgeMarginMm,
    magnetHoleInsetFromEdgeMm: source.magnetHoleInsetFromEdgeMm,
  };
}

function structuralFromProfile(p: BinProfile): StructuralOverrides {
  return {
    lipHeightMm: p.lip_height_mm,
    lipChamferTopMm: p.lip_chamfer_top_mm,
    lipStraightMm: p.lip_straight_mm,
    lipChamferBottomMm: p.lip_chamfer_bottom_mm,
    minWallMm: p.min_wall_mm,
    minFloorMm: p.min_floor_mm,
    corralFloorMm: p.corral_floor_mm,
    corralWallMm: p.corral_wall_mm,
    corralBaseFlareMm: p.corral_base_flare_mm,
    corralBaseReinforcementHMm: p.corral_base_reinforcement_h_mm,
    corralEdgeMarginMm: p.corral_edge_margin_mm,
    magnetHoleInsetFromEdgeMm: p.magnet_hole_inset_from_edge_mm,
  };
}

/** Everything undo/redo tracks — the editor's "content", as opposed to
 *  transient UI state like selection or dialog visibility. Positions/rotation
 *  live directly on each `CombineTool` (`tx`/`ty`/`rot`), so snapshotting
 *  `tools` captures them for free — no separate placements schema needed. */
interface Snapshot {
  tools: CombineTool[];
  binStyle: BinStyle;
  lip: boolean;
  allowCustomShape: boolean;
  structural: StructuralOverrides;
  magnetHoles: boolean;
  magnetHoleDiameter: string;
  magnetHoleDepth: string;
  forceSize: boolean;
  forceGx: string;
  forceGy: string;
  customShape: boolean;
  removedCells: Set<CellKey>;
  lockedRotations: Set<string>;
}

/** A gx×gy grid of small toggle squares, one per gridfinity unit, for
 *  "custom bin shape" — checking a cell removes it from the bin. Rows run
 *  top-to-bottom in increasing iy and columns left-to-right in increasing
 *  ix, matching the Arrange 2D view's own orientation (iy grows downward,
 *  same as the SVG's y axis). */
function CustomShapeGrid({
  gx, gy, removedCells, disabled, onToggle,
}: {
  gx: number;
  gy: number;
  removedCells: Set<CellKey>;
  disabled: boolean;
  onToggle: (ix: number, iy: number) => void;
}) {
  return (
    <div
      className="mt-2 inline-grid gap-[2px] border border-line bg-field p-1"
      style={{ gridTemplateColumns: `repeat(${gx}, 16px)`, borderRadius: 2 }}
    >
      {Array.from({ length: gy }, (_, iy) => (
        Array.from({ length: gx }, (_, ix) => {
          const removed = removedCells.has(cellKey(ix, iy));
          return (
            <button
              key={cellKey(ix, iy)}
              type="button"
              aria-pressed={removed}
              aria-label={`Grid cell column ${ix + 1}, row ${iy + 1}${removed ? " (removed)" : ""}`}
              title={removed ? "Removed — click to restore" : "Click to remove this cell"}
              disabled={disabled}
              className="h-4 w-4 border"
              style={{
                borderRadius: 1,
                borderColor: "var(--c-line)",
                background: removed ? "transparent" : "var(--c-teal, #2f8f95)",
              }}
              onClick={() => onToggle(ix, iy)}
            />
          );
        })
      ))}
    </div>
  );
}

/** Interactive multi-tool-bin editor: auto-packed layout you can drag + rotate,
 *  inspect as the exact generated solid, then export the arrangement as one 3MF. */
export function CombineEditor({
  ids,
  overallHeight,
  initial,
  onClose,
}: {
  ids: string[];
  overallHeight: number | null;
  /** When set, the editor opens seeded from this saved arrangement instead
   *  of auto-packing fresh — see `initial`-aware mount effect below. */
  initial?: CombineEditorInitial;
  onClose: () => void;
}) {
  const binProfiles = useBinProfiles();
  const [meta, setMeta] = useState<CombinePreview | null>(null);
  const [tools, setTools] = useState<CombineTool[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"arrange" | "preview">("arrange");
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [binStyle, setBinStyle] = useState<BinStyle>(initial?.binStyle ?? "pocket");
  const [lip, setLip] = useState(initial?.lip ?? true);
  // Independent of binStyle — not derived from it. Set only by picking a
  // profile (or true by default, matching every style's behaviour before
  // Bin Profiles existed); the "Custom bin shape" control still separately
  // requires binStyle === "pocket", since the geometry itself can't do
  // custom shapes on corral/grid regardless of this flag.
  const [allowCustomShape, setAllowCustomShape] = useState(true);
  const [structural, setStructural] = useState<StructuralOverrides>(
    () => (initial ? structuralFrom(initial) : BLANK_STRUCTURAL),
  );
  // Purely which profile the dropdown displays as picked — cosmetic only.
  // Fields copied from a profile are independently editable afterward, so
  // this can go stale relative to the live style state; that's expected.
  const [appliedProfileId, setAppliedProfileId] = useState<string | null>(null);
  const [magnetHoles, setMagnetHoles] = useState(initial?.magnetHoles ?? false);
  const [magnetHoleDiameter, setMagnetHoleDiameter] = useState(String(initial?.magnetHoleDiameterMm ?? "6.5"));
  const [magnetHoleDepth, setMagnetHoleDepth] = useState(String(initial?.magnetHoleDepthMm ?? "2"));
  const [nudge, setNudge] = useState("0.1");
  const [sliceDialogOpen, setSliceDialogOpen] = useState(false);
  const [sliceThickness, setSliceThickness] = useState("1.0"); // mirrors grid_mod.SLICE_THICKNESS_MM
  const [lockedRotations, setLockedRotations] = useState<Set<string>>(new Set());
  const [forceSize, setForceSize] = useState(Boolean(initial?.forceGx && initial?.forceGy));
  const [forceGx, setForceGx] = useState(initial?.forceGx ? String(initial.forceGx) : "");
  const [forceGy, setForceGy] = useState(initial?.forceGy ? String(initial.forceGy) : "");
  const [customShape, setCustomShape] = useState(Boolean(initial?.removedCells?.length));
  const [removedCells, setRemovedCells] = useState<Set<CellKey>>(
    () => new Set((initial?.removedCells ?? []).map(([ix, iy]) => cellKey(ix, iy))),
  );
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveDone, setSaveDone] = useState(false);
  // Name exports after: reopened from this saved bin, or saved during this
  // session — either way, falls back to the tools' own names once neither
  // is true.
  const [savedLabel, setSavedLabel] = useState<string | null>(initial?.label ?? null);
  // Multi-select-only local draft for the pocket-depth override checkbox —
  // null means "no pending edit"; checking the box (when not on a single
  // tool) never commits by itself, only setting a depth or unchecking does.
  const [depthOverrideDraft, setDepthOverrideDraft] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const arrangeRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    ids: string[];
    offsets: Map<string, { ox: number; oy: number }>;
    /** A plain click (no shift) on a tool that was already part of a bigger
     *  selection defers the decision: drag the whole group if the pointer
     *  moves, or narrow the selection down to just this tool if it doesn't. */
    clickNarrowsTo: string | null;
    moved: boolean;
  } | null>(null);
  const previewSequence = useRef(0);
  const glbUrlRef = useRef<string | null>(null);
  const depthCheckboxRef = useRef<HTMLInputElement>(null);

  const selectedTools = tools.filter((t) => selectedIds.has(t.id));
  const selectedTool = selectedTools.length === 1 ? selectedTools[0] : null;
  const selectionKey = [...selectedIds].sort().join(",");

  useEffect(() => {
    setDepthOverrideDraft(null);
  }, [selectionKey]);

  // Esc clears the selection, and Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z undo/redo,
  // from anywhere in the modal — except while typing in a field, where none
  // of that has an obvious meaning and could surprise someone mid-edit.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        setSelectedIds(new Set());
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

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
    // A plain click always narrows to just this tool — including when it's
    // already part of a bigger selection. (The SVG's drag handler special-cases
    // this itself, since there a plain click on an already-selected tool must
    // still drag the whole group if the pointer moves before it comes back up.)
    return new Set([id]);
  }

  function overridesFor(
    tools: CombineTool[],
    lockedRotationsOverride: Set<string> = lockedRotations,
  ): CombineToolOverride[] {
    return tools.map(({
      id, rot, finger_hole_override, clearance_mm_override,
      finger_hole_side_flip_override, finger_hole_offset_mm_override,
      depth_mm_override,
    }) => ({
      id,
      finger_hole: finger_hole_override,
      clearance_mm: clearance_mm_override,
      finger_hole_side_flip: finger_hole_side_flip_override,
      finger_hole_offset_mm: finger_hole_offset_mm_override,
      locked_rotation_deg: lockedRotationsOverride.has(id) ? rot : null,
      pocket_depth_mm: depth_mm_override,
    }));
  }

  function removedCellsArray(cells: Set<CellKey>): [number, number][] {
    return [...cells].map((k) => k.split(",").map(Number) as [number, number]);
  }

  // Custom bin shape only applies to pocket bins, and only when the active
  // profile allows it — the checkbox state and removed cells stay intact
  // across a style/profile switch (so they reappear if you switch back),
  // but are ignored otherwise.
  function effectiveRemovedCells(
    style: BinStyle, allow: boolean = allowCustomShape,
  ): [number, number][] | null {
    return style === "pocket" && allow && customShape && removedCells.size > 0
      ? removedCellsArray(removedCells)
      : null;
  }

  async function load(
    placements?: Placement[],
    overrides: CombineToolOverride[] = overridesFor(tools),
    style: BinStyle = binStyle,
    force: [number, number] | null = forceSize && forceGx && forceGy
      ? [Number(forceGx), Number(forceGy)]
      : null,
    removed: [number, number][] | null = effectiveRemovedCells(style),
    lipOverride: boolean = lip,
    structuralOverride: StructuralOverrides = structural,
    magnetHolesOverride: boolean = magnetHoles,
    magnetHoleDiameterOverride: string = magnetHoleDiameter,
    magnetHoleDepthOverride: string = magnetHoleDepth,
  ) {
    setBusy(true);
    setErr(null);
    try {
      const p = await combinePreview(ids, {
        placements: placements ?? null,
        overallHeight,
        lip: lipOverride,
        overrides,
        binStyle: style,
        magnetHoles: magnetHolesOverride,
        magnetHoleDiameterMm: Number(magnetHoleDiameterOverride),
        magnetHoleDepthMm: Number(magnetHoleDepthOverride),
        forceGx: force ? force[0] : null,
        forceGy: force ? force[1] : null,
        removedCells: removed,
        ...structuralOverride,
      });
      setMeta(p);
      setTools(p.tools);
      setSelectedIds((current) => new Set([...current].filter((id) => p.tools.some((tool) => tool.id === id))));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initial) {
      // Reopening a saved bin: honour its placements as a manual arrangement,
      // not a fresh auto-pack.
      void load(
        initial.placements, initial.overrides, initial.binStyle,
        initial.forceGx && initial.forceGy ? [initial.forceGx, initial.forceGy] : null,
        initial.removedCells,
      );
    } else {
      load(); // auto-pack on open
    }
  }, []); // eslint-disable-line

  const UNDO_HISTORY_LIMIT = 50;
  const NUDGE_BURST_MS = 1000;
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const burstActive = useRef(false);
  const burstTimer = useRef<number | null>(null);

  function snapshot(): Snapshot {
    return {
      tools: tools.map((t) => ({ ...t })),
      binStyle,
      lip,
      allowCustomShape,
      structural: { ...structural },
      magnetHoles,
      magnetHoleDiameter,
      magnetHoleDepth,
      forceSize,
      forceGx,
      forceGy,
      customShape,
      removedCells: new Set(removedCells),
      lockedRotations: new Set(lockedRotations),
    };
  }

  /** Pushes the state as it is *right now*, before the caller applies its
   *  change — call at the top of every discrete, one-shot committing action. */
  function pushSnapshot() {
    setUndoStack((s) => [...s.slice(-(UNDO_HISTORY_LIMIT - 1)), snapshot()]);
    setRedoStack([]);
  }

  /** Same as `pushSnapshot`, but for a *burst* of rapid-fire actions (nudge
   *  keys, fine-rotate clicks, typing a rotation value) — pushes once at the
   *  start of the burst, then holds off until `NUDGE_BURST_MS` after the
   *  last call, so undo reverts the whole burst in one step. */
  function pushSnapshotCoalesced() {
    if (!burstActive.current) {
      pushSnapshot();
      burstActive.current = true;
    }
    if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
    burstTimer.current = window.setTimeout(() => {
      burstActive.current = false;
      burstTimer.current = null;
    }, NUDGE_BURST_MS);
  }

  function applySnapshot(s: Snapshot) {
    setTools(s.tools);
    setBinStyle(s.binStyle);
    setLip(s.lip);
    setAllowCustomShape(s.allowCustomShape);
    setStructural(s.structural);
    setMagnetHoles(s.magnetHoles);
    setMagnetHoleDiameter(s.magnetHoleDiameter);
    setMagnetHoleDepth(s.magnetHoleDepth);
    setForceSize(s.forceSize);
    setForceGx(s.forceGx);
    setForceGy(s.forceGy);
    setCustomShape(s.customShape);
    setRemovedCells(new Set(s.removedCells));
    setLockedRotations(new Set(s.lockedRotations));
    const force: [number, number] | null = s.forceSize && s.forceGx && s.forceGy
      ? [Number(s.forceGx), Number(s.forceGy)]
      : null;
    const removed = s.binStyle === "pocket" && s.allowCustomShape && s.customShape && s.removedCells.size > 0
      ? removedCellsArray(s.removedCells)
      : null;
    void load(
      placementsFor(s.tools), overridesFor(s.tools, s.lockedRotations), s.binStyle, force, removed,
      s.lip, s.structural, s.magnetHoles, s.magnetHoleDiameter, s.magnetHoleDepth,
    );
  }

  function undo() {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [...r, snapshot()]);
    applySnapshot(last);
  }

  function redo() {
    if (!redoStack.length) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, snapshot()]);
    applySnapshot(last);
  }

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
      tool.depth_mm_override,
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
      // Fixed footprint — the server never re-centres a manual re-arrange
      // while a size is forced (see _combine_layout), so world origin (0,0)
      // stays the bin's stable centre across round-trips, independent of
      // local drags.
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

    // Custom bin shape: a tool crossing into a removed cell is exactly as
    // invalid as crossing the locked bin's outer edge — same warning colour,
    // same export/preview gate.
    if (locked && binStyle === "pocket" && customShape && removedCells.size > 0) {
      const half = bin_size / 2;
      const removedRects = [...removedCells].map((k) => {
        const [ix, iy] = k.split(",").map(Number);
        const rcx = cx + (ix - (gx - 1) / 2) * pitch;
        const rcy = cy + (iy - (gy - 1) / 2) * pitch;
        return { minX: rcx - half, maxX: rcx + half, minY: rcy - half, maxY: rcy + half };
      });
      const rectsOverlap = (
        aMinX: number, aMaxX: number, aMinY: number, aMaxY: number,
        r: { minX: number; maxX: number; minY: number; maxY: number },
      ) => aMinX < r.maxX && aMaxX > r.minX && aMinY < r.maxY && aMaxY > r.minY;
      tools.forEach((t, i) => {
        const poly = polys[i];
        const polyMinX = Math.min(...poly.map((p) => p[0])), polyMaxX = Math.max(...poly.map((p) => p[0]));
        const polyMinY = Math.min(...poly.map((p) => p[1])), polyMaxY = Math.max(...poly.map((p) => p[1]));
        const holes = fingerCircles.filter((hole) => hole.toolId === t.id);
        const hitsRemoved = removedRects.some((r) => (
          rectsOverlap(polyMinX, polyMaxX, polyMinY, polyMaxY, r) ||
          holes.some((hole) => rectsOverlap(
            hole.cx - hole.radius, hole.cx + hole.radius, hole.cy - hole.radius, hole.cy + hole.radius, r,
          ))
        ));
        if (hitsRemoved) overflowIds.add(t.id);
      });
    }

    // The viewport must show overflowing geometry too, not just the locked
    // footprint, so a tool that's crossed the edge stays visible.
    const boxMinX = Math.min(cx - ow / 2, minx), boxMaxX = Math.max(cx + ow / 2, maxx);
    const boxMinY = Math.min(cy - od / 2, miny), boxMaxY = Math.max(cy + od / 2, maxy);
    const viewCx = (boxMinX + boxMaxX) / 2, viewCy = (boxMinY + boxMaxY) / 2;
    const viewW = boxMaxX - boxMinX, viewH = boxMaxY - boxMinY;

    return { polys, fingerCircles, gx, gy, ow, od, cx, cy, locked, overflowIds, viewCx, viewCy, viewW, viewH };
  }, [tools, meta, forceSize, forceGx, forceGy, binStyle, customShape, removedCells]);

  const hasOverflow = Boolean(layout?.locked && layout.overflowIds.size > 0);

  // Generate after the arrangement settles. This endpoint calls the same solid
  // builder as 3MF export; no browser-side mesh approximation is involved.
  useEffect(() => {
    if (!meta || tools.length < 2) return;
    const sequence = ++previewSequence.current;
    if (hasOverflow) {
      setPreviewBusy(false);
      setPreviewErr("A tool extends past the locked bin size (or over a removed grid cell) — move it back inside, or adjust the forced shape, before rendering.");
      return;
    }
    const placements = placementsFor(tools);
    const overrides = overridesFor(tools);
    setPreviewBusy(true);
    setPreviewErr(null);
    const forceGxVal = forceSize && forceGx && forceGy ? Number(forceGx) : null;
    const forceGyVal = forceSize && forceGx && forceGy ? Number(forceGy) : null;
    const removedVal = effectiveRemovedCells(binStyle);
    const timer = window.setTimeout(() => {
      combinePreviewGlb(ids, {
        placements, overallHeight, lip, overrides, binStyle,
        magnetHoles, magnetHoleDiameterMm: Number(magnetHoleDiameter), magnetHoleDepthMm: Number(magnetHoleDepth),
        forceGx: forceGxVal, forceGy: forceGyVal, removedCells: removedVal,
        ...structural,
      })
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
  }, [idsKey, geometryKey, overallHeight, lip, binStyle, allowCustomShape, structural, magnetHoles, magnetHoleDiameter, magnetHoleDepth, forceSize, forceGx, forceGy, customShape, removedCells, hasOverflow, Boolean(meta)]); // eslint-disable-line

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
    const alreadySelected = selectedIds.has(id);
    // A plain click on a tool that's already part of a bigger selection is
    // ambiguous at pointerdown time: it might become a group-drag, or it
    // might turn out to be a plain click meant to narrow the selection down
    // to just this tool. Keep dragging the current group either way; decide
    // which it was once the pointer comes back up (see onPointerUp below).
    const clickNarrowsTo = !e.shiftKey && alreadySelected && selectedIds.size > 1 ? id : null;
    const nextIds = clickNarrowsTo ? selectedIds : nextSelection(id, e.shiftKey);
    if (!clickNarrowsTo) setSelectedIds(nextIds);
    const [mx, my] = toData(e);
    const offsets = new Map<string, { ox: number; oy: number }>();
    tools.forEach((t) => {
      if (nextIds.has(t.id)) offsets.set(t.id, { ox: mx - t.tx, oy: my - t.ty });
    });
    drag.current = { ids: [...nextIds], offsets, clickNarrowsTo, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drag.current) return;
    const [mx, my] = toData(e);
    const { offsets } = drag.current;
    // One undo step per drag gesture, not per pointermove: push right at the
    // moment this drag's first move is registered, not on every subsequent one.
    if (!drag.current.moved) pushSnapshot();
    drag.current.moved = true;
    setTools((ts) => ts.map((t) => {
      const o = offsets.get(t.id);
      return o ? { ...t, tx: mx - o.ox, ty: my - o.oy } : t;
    }));
  }
  function rotate(deg: number) {
    if (!selectedTool) return;
    pushSnapshotCoalesced();
    const id = selectedTool.id;
    setTools((ts) => ts.map((t) => (t.id === id ? { ...t, rot: t.rot + deg } : t)));
  }
  /** Align every selected tool to a common edge/center of the selection's own
   *  bounding boxes (each tool's placed `stamp` outline, not its finger-hole
   *  scallop). Horizontal alignment only ever changes tx; vertical only ty. */
  function alignSelected(edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
    if (selectedTools.length < 2) return;
    pushSnapshot();
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
  /** Distribute 3+ selected tools' bounding-box centers evenly along one
   *  axis between the two extreme members, without reordering them. The
   *  first and last (by center) stay put; everything else is retargeted to
   *  an equal-gap position between them. */
  function distributeSelected(axis: "horizontal" | "vertical") {
    if (selectedTools.length < 3) return;
    pushSnapshot();
    const entries = selectedTools
      .map((t) => {
        const b = bboxOf(placed(t.stamp, t.tx, t.ty, t.rot));
        return { id: t.id, center: axis === "horizontal" ? (b.minx + b.maxx) / 2 : (b.miny + b.maxy) / 2 };
      })
      .sort((a, b) => a.center - b.center);
    const first = entries[0], last = entries[entries.length - 1];
    const n = entries.length;
    const deltas = new Map(entries.map((e, i) => [
      e.id, first.center + (i * (last.center - first.center)) / (n - 1) - e.center,
    ]));
    setTools((ts) => ts.map((t) => {
      const delta = deltas.get(t.id);
      if (delta === undefined) return t;
      return axis === "horizontal" ? { ...t, tx: t.tx + delta } : { ...t, ty: t.ty + delta };
    }));
  }
  function nudgeSelected(dx: number, dy: number) {
    if (!selectedIds.size) return;
    pushSnapshotCoalesced();
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
    pushSnapshotCoalesced();
    const id = selectedTool.id;
    setTools((ts) => ts.map((t) => (t.id === id ? { ...t, rot: deg } : t)));
  }

  async function setFingerHole(enabled: boolean | null) {
    if (!selectedIds.size) return;
    pushSnapshot();
    const updated = tools.map((tool) => selectedIds.has(tool.id) ? {
      ...tool,
      finger: enabled ?? tool.finger_hole_inherited,
      finger_hole: enabled ?? tool.finger_hole_inherited,
      finger_hole_override: enabled === null || enabled === tool.finger_hole_inherited ? null : enabled,
    } : tool);
    await load(placementsFor(updated), overridesFor(updated));
  }

  async function setClearance(mm: number | null) {
    if (!selectedIds.size) return;
    pushSnapshot();
    const updated = tools.map((tool) => selectedIds.has(tool.id) ? {
      ...tool,
      clearance_mm: mm ?? tool.clearance_mm_inherited,
      clearance_mm_override: mm === tool.clearance_mm_inherited ? null : mm,
    } : tool);
    await load(placementsFor(updated), overridesFor(updated));
  }

  async function setDepthOverride(mm: number | null) {
    if (!selectedIds.size) return;
    pushSnapshot();
    const updated = tools.map((tool) => selectedIds.has(tool.id) ? {
      ...tool,
      depth_mm: mm ?? tool.depth_mm_inherited,
      depth_mm_override: mm,
    } : tool);
    await load(placementsFor(updated), overridesFor(updated));
  }

  /** Checking the box on a single tool commits immediately (there's only
   *  ever one unambiguous value to seed). On a multi-selection it starts a
   *  local, non-committing draft instead — per spec, nothing is saved for
   *  the group until either a depth is actually typed in, or the box is
   *  unchecked from a fully-overridden selection. */
  function handleDepthCheckboxClick(event: React.MouseEvent<HTMLInputElement>) {
    event.preventDefault();
    if (selectedTools.length === 1) {
      const tool = selectedTools[0];
      void setDepthOverride(tool.depth_mm_override !== null ? null : tool.depth_mm);
      return;
    }
    if (depthOverrideDraft !== null) {
      setDepthOverrideDraft(null); // discard an uncommitted draft
      return;
    }
    if (depthAllOn) {
      void setDepthOverride(null); // commit: clear every selected tool's override
      return;
    }
    const shared = allEqual(selectedTools, (t) => t.depth_mm);
    setDepthOverrideDraft(shared !== undefined ? String(shared) : "");
  }

  async function setFingerHoleSideFlip(flip: boolean | null) {
    if (!selectedIds.size) return;
    pushSnapshot();
    const updated = tools.map((tool) => selectedIds.has(tool.id) ? {
      ...tool,
      finger_hole_side_flip: flip ?? false,
      finger_hole_side_flip_override: flip,
    } : tool);
    await load(placementsFor(updated), overridesFor(updated));
  }

  async function setFingerHoleOffset(mm: number | null) {
    if (!selectedIds.size) return;
    pushSnapshot();
    const updated = tools.map((tool) => selectedIds.has(tool.id) ? {
      ...tool,
      finger_hole_offset_mm: mm ?? 0,
      finger_hole_offset_mm_override: mm,
    } : tool);
    await load(placementsFor(updated), overridesFor(updated));
  }

  /** Snap every selected tool's finger hole onto the bottom-most one's world
   *  X (or, for a left/right-side group, the left-most one's world Y) — see
   *  `computeFingerAlignPlan` for the eligibility/legality rules. Each tool
   *  gets its own distinct offset, unlike the shared-value bulk Position
   *  control above. */
  async function alignFingerHoles() {
    if (!fingerAlignPlan) return;
    pushSnapshot();
    const { updates } = fingerAlignPlan;
    const updated = tools.map((tool) => {
      const next = updates.get(tool.id);
      if (next === undefined) return tool;
      return { ...tool, finger_hole_offset_mm: next, finger_hole_offset_mm_override: next };
    });
    await load(placementsFor(updated), overridesFor(updated));
  }

  async function exportBin() {
    setBusy(true);
    setErr(null);
    try {
      const force = forceSize && forceGx && forceGy;
      await combineLibrary(ids, {
        placements: placementsFor(tools),
        overallHeight,
        lip,
        overrides: overridesFor(tools),
        binStyle,
        magnetHoles,
        magnetHoleDiameterMm: Number(magnetHoleDiameter),
        magnetHoleDepthMm: Number(magnetHoleDepth),
        forceGx: force ? Number(forceGx) : null,
        forceGy: force ? Number(forceGy) : null,
        removedCells: effectiveRemovedCells(binStyle),
        ...structural,
      }, binExportName(savedLabel, tools.map((t) => t.label)));
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
      await combineLibrarySlice(ids, {
        placements: placementsFor(tools),
        overallHeight,
        lip,
        overrides: overridesFor(tools),
        binStyle,
        magnetHoles,
        magnetHoleDiameterMm: Number(magnetHoleDiameter),
        magnetHoleDepthMm: Number(magnetHoleDepth),
        sliceThicknessMm: thicknessMm,
        forceGx: force ? Number(forceGx) : null,
        forceGy: force ? Number(forceGy) : null,
        removedCells: effectiveRemovedCells(binStyle),
        ...structural,
      }, binExportName(savedLabel, tools.map((t) => t.label)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveToBinLibrary() {
    setSaveBusy(true);
    setSaveErr(null);
    try {
      const force = forceSize && forceGx && forceGy;
      const label = saveName.trim() || defaultBinName();
      await saveBin(label, ids, {
        placements: placementsFor(tools),
        overrides: overridesFor(tools),
        overallHeight,
        lip,
        binStyle,
        magnetHoles,
        magnetHoleDiameterMm: Number(magnetHoleDiameter),
        magnetHoleDepthMm: Number(magnetHoleDepth),
        forceGx: force ? Number(forceGx) : null,
        forceGy: force ? Number(forceGy) : null,
        removedCells: effectiveRemovedCells(binStyle),
        ...structural,
      });
      setSavedLabel(label);
      setSaveDialogOpen(false);
      setSaveDone(true);
      window.setTimeout(() => setSaveDone(false), 3000);
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaveBusy(false);
    }
  }

  const color = (i: number) => PAL[i % PAL.length];
  const displayedRotation = selectedTool
    ? ((((selectedTool.rot + 180) % 360) + 360) % 360) - 180
    : 0;
  const clearanceValue = allEqual(selectedTools, (t) => t.clearance_mm);
  const clearanceAllInherited = selectedTools.length > 0 && selectedTools.every((t) => t.clearance_mm_override === null);
  const clearanceAllOverridden = selectedTools.length > 0 && selectedTools.every((t) => t.clearance_mm_override !== null);
  const clearanceInherited = allEqual(selectedTools, (t) => t.clearance_mm_inherited);
  const fingerAllOn = selectedTools.length > 0 && selectedTools.every((t) => t.finger_hole);
  const fingerAllOff = selectedTools.length > 0 && selectedTools.every((t) => !t.finger_hole);
  const fingerMixed = selectedTools.length > 0 && !fingerAllOn && !fingerAllOff;
  const fingerOverrideAllInherited = selectedTools.length > 0 && selectedTools.every((t) => t.finger_hole_override === null);
  const fingerOverrideAllOverridden = selectedTools.length > 0 && selectedTools.every((t) => t.finger_hole_override !== null);
  const fingerInheritedShared = allEqual(selectedTools, (t) => t.finger_hole_inherited);
  const fingerAlignPlan = layout ? computeFingerAlignPlan(
    selectedTools
      .filter((t) => t.finger_hole)
      .flatMap((t): FingerAlignCandidate[] => {
        const hole = layout.fingerCircles.find((h) => h.toolId === t.id);
        return hole ? [{
          id: t.id, cx: hole.cx, cy: hole.cy, side: t.finger_hole_side,
          rot: t.rot, offset: t.finger_hole_offset_mm, offsetMax: t.finger_hole_offset_mm_max,
        }] : [];
      }),
  ) : null;
  const sideFlipEligible = selectedTools.length > 0 && selectedTools.every((t) => t.finger_hole && t.finger_hole_side !== "center");
  const sideFlipAllOn = sideFlipEligible && selectedTools.every((t) => t.finger_hole_side_flip);
  const sideFlipAllOff = sideFlipEligible && selectedTools.every((t) => !t.finger_hole_side_flip);
  const sideFlipMixed = sideFlipEligible && !sideFlipAllOn && !sideFlipAllOff;
  const offsetValue = allEqual(selectedTools, (t) => t.finger_hole_offset_mm);
  const offsetMax = sideFlipEligible ? Math.min(...selectedTools.map((t) => t.finger_hole_offset_mm_max)) : 0;
  const offsetAllOverridden = sideFlipEligible && selectedTools.every((t) => t.finger_hole_offset_mm_override !== null);
  const depthAllOn = selectedTools.length > 0 && selectedTools.every((t) => t.depth_mm_override !== null);
  const depthAllOff = selectedTools.length > 0 && selectedTools.every((t) => t.depth_mm_override === null);
  const depthMixed = selectedTools.length > 0 && !depthAllOn && !depthAllOff;
  const depthEffectiveShared = allEqual(selectedTools, (t) => t.depth_mm);
  const depthModeShared = allEqual(selectedTools, (t) => t.depth_mode);
  const depthChecked = selectedTool
    ? selectedTool.depth_mm_override !== null
    : depthOverrideDraft !== null || depthAllOn;
  const showDepthNumber = selectedTool ? selectedTool.depth_mm_override !== null : depthOverrideDraft !== null;
  const depthMmLabel = selectedTool ? `${selectedTool.depth_mm} mm` : depthEffectiveShared !== undefined ? `${depthEffectiveShared} mm` : "– mm";
  const depthModeLabel = selectedTool ? selectedTool.depth_mode : depthModeShared ?? "Mixed";
  useEffect(() => {
    if (depthCheckboxRef.current) {
      depthCheckboxRef.current.indeterminate = !selectedTool && depthOverrideDraft === null && depthMixed;
    }
  });
  const m = 8; // viewport margin (mm)
  const vb = layout
    ? `${layout.viewCx - layout.viewW / 2 - m} ${layout.viewCy - layout.viewH / 2 - m} ${layout.viewW + 2 * m} ${layout.viewH + 2 * m}`
    : "0 0 100 100";

  const alignButtons = (
    <>
      <div className="mt-3 border-t border-line pt-3">
        <span className="font-mono text-[10px] uppercase text-muted">Horizontal align</span>
        <div className="mt-1 grid grid-cols-3 gap-1">
          <button className="btn btn-ghost text-knockout border-line text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("left")}>⇤ Left</button>
          <button className="btn btn-ghost text-knockout border-line text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("hcenter")}>↔ Center</button>
          <button className="btn btn-ghost text-knockout border-line text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("right")}>Right ⇥</button>
        </div>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <span className="font-mono text-[10px] uppercase text-muted">Vertical align</span>
        <div className="mt-1 grid grid-cols-3 gap-1">
          <button className="btn btn-ghost text-knockout border-line text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("top")}>⇡ Top</button>
          <button className="btn btn-ghost text-knockout border-line text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("vcenter")}>↕ Middle</button>
          <button className="btn btn-ghost text-knockout border-line text-[10px] !px-1 !py-2" disabled={selectedTools.length < 2} onClick={() => alignSelected("bottom")}>Bottom ⇣</button>
        </div>
      </div>
    </>
  );

  const distributeButtons = (
    <div className="mt-3 border-t border-line pt-3">
      <span className="font-mono text-[10px] uppercase text-muted">Distribute</span>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <button className="btn btn-ghost text-knockout border-line text-[10px] !px-1 !py-2" disabled={selectedTools.length < 3} onClick={() => distributeSelected("horizontal")}>↔ Horizontally</button>
        <button className="btn btn-ghost text-knockout border-line text-[10px] !px-1 !py-2" disabled={selectedTools.length < 3} onClick={() => distributeSelected("vertical")}>↕ Vertically</button>
      </div>
    </div>
  );

  return (
    <div className="panel !p-4 sm:!p-6 w-full max-w-[1180px] max-h-[calc(100dvh-2rem)] overflow-auto">
      <div className="grp-label mb-2 flex flex-wrap justify-between gap-2">
        <span className="flex items-center gap-2">
          Arrange multi-tool bin
          <button
            type="button"
            className="btn btn-ghost !px-2 !py-1 text-[10px] normal-case"
            aria-label="Undo"
            title="Undo (Cmd/Ctrl+Z)"
            disabled={!undoStack.length}
            onClick={undo}
          >
            ↶ Undo
          </button>
          <button
            type="button"
            className="btn btn-ghost !px-2 !py-1 text-[10px] normal-case"
            aria-label="Redo"
            title="Redo (Cmd/Ctrl+Shift+Z)"
            disabled={!redoStack.length}
            onClick={redo}
          >
            ↷ Redo
          </button>
        </span>
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
            style={{ minHeight: 360, maxHeight: "68vh", cursor: drag.current ? "grabbing" : "default" }}
            preserveAspectRatio="xMidYMid meet"
            onPointerMove={move}
            onPointerUp={() => {
              const d = drag.current;
              if (d && d.clickNarrowsTo && !d.moved) setSelectedIds(new Set([d.clickNarrowsTo]));
              drag.current = null;
            }}
            onPointerDown={() => setSelectedIds(new Set())}
          >
            {layout && (
              <>
                {/* bin footprint + gridfinity cells */}
                {customShape && removedCells.size > 0 ? (
                  <path
                    d={binOutlinePath(
                      { gx: layout.gx, gy: layout.gy, pitch: meta!.pitch, cornerR: BIN_CORNER_R, centerX: layout.cx, centerY: layout.cy },
                      removedCells,
                    )}
                    fill="#00000022" stroke="#6b7280" strokeWidth={0.6} fillRule="evenodd"
                  />
                ) : (
                  <rect x={layout.cx - layout.ow / 2} y={layout.cy - layout.od / 2}
                    width={layout.ow} height={layout.od} fill="#00000022"
                    stroke="#6b7280" strokeWidth={0.6} rx={2} />
                )}
                {customShape && [...removedCells].map((k) => {
                  const [ix, iy] = k.split(",").map(Number);
                  const x = layout.cx + (ix - (layout.gx - 1) / 2) * meta!.pitch;
                  const y = layout.cy + (iy - (layout.gy - 1) / 2) * meta!.pitch;
                  return <rect
                    key={`removed-${k}`}
                    x={x - meta!.bin_size / 2} y={y - meta!.bin_size / 2}
                    width={meta!.bin_size} height={meta!.bin_size}
                    fill="#ff4d4d18" stroke="#ff4d4d55" strokeWidth={0.5} strokeDasharray="2 1"
                  />;
                })}
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
                {/* cleared pockets — turn red once locked and past the locked footprint;
                    hovering an unselected tool shades it to hint it's clickable */}
                {tools.map((t, i) => {
                  const toolColor = layout.overflowIds.has(t.id) ? OVERFLOW_COLOR : color(i);
                  const isSelected = selectedIds.has(t.id);
                  const isHovered = hoverId === t.id && !isSelected;
                  return <polygon
                    key={t.id}
                    points={layout.polys[i].map((p) => `${p[0]},${p[1]}`).join(" ")}
                    fill={toolColor + (isSelected ? "88" : isHovered ? "70" : "55")}
                    stroke={toolColor} strokeWidth={isSelected ? 1.2 : isHovered ? 1 : 0.7}
                    strokeDasharray={isSelected ? "2 1.5" : undefined}
                    className={isSelected ? "marching-ants" : undefined}
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => down(t.id, e)}
                    onPointerEnter={() => setHoverId(t.id)}
                    onPointerLeave={() => setHoverId((current) => (current === t.id ? null : current))}
                  />;
                })}
              </>
            )}
            </svg> : (
              <div className="relative h-[clamp(360px,62vh,620px)] w-full">
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
            <span className="font-mono text-[10px] uppercase text-muted">Bin profile</span>
            <select
              className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
              aria-label="Bin profile"
              disabled={busy}
              value={appliedProfileId ?? ""}
              onChange={(e) => {
                const profile = binProfiles.find((p) => p.id === e.target.value);
                if (!profile) return;
                pushSnapshot();
                setAppliedProfileId(profile.id);
                setBinStyle(profile.base_style);
                setLip(profile.lip);
                setAllowCustomShape(profile.allow_custom_shape);
                setMagnetHoles(profile.magnet_holes_default);
                setMagnetHoleDiameter(String(profile.magnet_hole_diameter_mm_default));
                setMagnetHoleDepth(String(profile.magnet_hole_depth_mm_default));
                const nextStructural = structuralFromProfile(profile);
                setStructural(nextStructural);
                // Every field a profile carries is a one-time copy — applying
                // it doesn't create a live link, so editing or deleting the
                // profile later never changes this bin.
                void load(
                  placementsFor(tools), overridesFor(tools), profile.base_style, undefined,
                  effectiveRemovedCells(profile.base_style, profile.allow_custom_shape),
                  profile.lip, nextStructural,
                  profile.magnet_holes_default,
                  String(profile.magnet_hole_diameter_mm_default),
                  String(profile.magnet_hole_depth_mm_default),
                );
              }}
            >
              <option value="" disabled>Apply a bin profile…</option>
              {binProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={lip}
              disabled={busy}
              onChange={(e) => {
                pushSnapshot();
                const checked = e.target.checked;
                setLip(checked);
                void load(placementsFor(tools), overridesFor(tools), binStyle, undefined, undefined, checked);
              }}
            />
            <span className="font-mono text-[10px] uppercase text-muted">Stacking lip</span>
          </label>
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={forceSize}
                disabled={busy}
                onChange={(event) => {
                  pushSnapshot();
                  const checked = event.target.checked;
                  setForceSize(checked);
                  if (!checked) {
                    setCustomShape(false);
                    setRemovedCells(new Set());
                  }
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
                    checked ? undefined : null,
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
                    onChange={(event) => { pushSnapshotCoalesced(); setForceGx(event.target.value); }}
                    ref={commitOnChange(() => void load(placementsFor(tools), overridesFor(tools)))}
                  />
                </label>
                <label className="min-w-0">
                  <span className="block font-mono text-[9px] uppercase text-muted">Depth (units)</span>
                  <input
                    aria-label="Forced bin depth in gridfinity units"
                    className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                    type="number" step={1} min={1}
                    value={forceGy}
                    onChange={(event) => { pushSnapshotCoalesced(); setForceGy(event.target.value); }}
                    ref={commitOnChange(() => void load(placementsFor(tools), overridesFor(tools)))}
                  />
                </label>
              </div>
            )}
            {forceSize && binStyle === "pocket" && allowCustomShape && (
              <div className="mt-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={customShape}
                    disabled={busy}
                    onChange={(event) => {
                      pushSnapshot();
                      const checked = event.target.checked;
                      setCustomShape(checked);
                      if (!checked) {
                        setRemovedCells(new Set());
                        void load(placementsFor(tools), overridesFor(tools), binStyle, undefined, null);
                      }
                    }}
                  />
                  <span className="font-mono text-[10px] uppercase text-muted">Custom bin shape</span>
                </label>
                {customShape && Number(forceGx) > 0 && Number(forceGy) > 0 && (
                  <CustomShapeGrid
                    gx={Math.round(Number(forceGx))}
                    gy={Math.round(Number(forceGy))}
                    removedCells={removedCells}
                    disabled={busy}
                    onToggle={(ix, iy) => {
                      pushSnapshot();
                      const key = cellKey(ix, iy);
                      const next = new Set(removedCells);
                      next.has(key) ? next.delete(key) : next.add(key);
                      setRemovedCells(next);
                      void load(placementsFor(tools), overridesFor(tools));
                    }}
                  />
                )}
                {customShape && removedCells.size > 0 && !isShapeConnected(
                  Math.round(Number(forceGx)), Math.round(Number(forceGy)), removedCells,
                ) && (
                  <p className="mt-1 font-mono text-[9px] text-orange">
                    Custom bin shape must be a single connected piece — some cells are cut off from the rest.
                  </p>
                )}
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
                  pushSnapshot();
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
                    onChange={(event) => { pushSnapshotCoalesced(); setMagnetHoleDiameter(event.target.value); }}
                    ref={commitOnChange(() => void load(placementsFor(tools), overridesFor(tools)))}
                  />
                </label>
                <label className="min-w-0">
                  <span className="block font-mono text-[9px] uppercase text-muted">Depth (mm)</span>
                  <input
                    aria-label="Magnet hole depth"
                    className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                    type="number" step={0.1} min={0.1} max={4.7}
                    value={magnetHoleDepth}
                    onChange={(event) => { pushSnapshotCoalesced(); setMagnetHoleDepth(event.target.value); }}
                    ref={commitOnChange(() => void load(placementsFor(tools), overridesFor(tools)))}
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
                pushSnapshot();
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
          {selectedTools.length >= 1 ? (
            <div className="border border-line bg-field p-3 font-mono text-[10px]" style={{ borderRadius: 2 }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-knockout">
                  {selectedTool ? (selectedTool.label || selectedTool.id.slice(0, 8)) : `${selectedTools.length} tools selected`}
                </span>
                <span className="shrink-0 font-mono text-[9px] uppercase text-muted">Esc to clear</span>
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-muted">
                <dt>{binStyle === "corral" ? "Tool recess" : "Pocket depth"}</dt>
                <dd className="text-knockout">{depthMmLabel}</dd>
                <dt>Depth source</dt>
                <dd className="text-right text-knockout">{depthModeLabel}</dd>
              </dl>
              <div className="mt-2 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2">
                  <input
                    ref={depthCheckboxRef}
                    type="checkbox"
                    checked={depthChecked}
                    disabled={busy}
                    onClick={handleDepthCheckboxClick}
                    onChange={() => {}}
                  />
                  <span className="text-muted">Override pocket depth</span>
                </label>
              </div>
              {showDepthNumber && (
                <div className="mt-2 flex items-center gap-1">
                  {selectedTool ? (
                    <input
                      aria-label="Pocket depth override in millimetres"
                      className="mono-input min-w-0 w-20 !px-2 !py-1 !text-sm"
                      type="number" step={0.01} min={0.01}
                      disabled={busy}
                      defaultValue={selectedTool.depth_mm}
                      key={`${selectedTool.id}-depth-${selectedTool.depth_mm}`}
                      ref={commitOnChange((raw) => {
                        const value = Number(raw);
                        if (Number.isFinite(value) && value > 0 && value !== selectedTool.depth_mm) void setDepthOverride(value);
                      })}
                    />
                  ) : (
                    <input
                      aria-label="Pocket depth override in millimetres"
                      className="mono-input min-w-0 w-20 !px-2 !py-1 !text-sm"
                      type="number" step={0.01} min={0.01}
                      disabled={busy}
                      value={depthOverrideDraft ?? ""}
                      placeholder={depthOverrideDraft === "" ? "–" : undefined}
                      onChange={(event) => setDepthOverrideDraft(event.target.value)}
                      ref={commitOnChange((raw) => {
                        if (raw === "") return; // stays pending, inert
                        const value = Number(raw);
                        if (!Number.isFinite(value) || value <= 0) return;
                        setDepthOverrideDraft(null);
                        void setDepthOverride(value);
                      })}
                    />
                  )}
                  <span className="text-muted">mm</span>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                <div className="min-w-0">
                  <div className="text-knockout">Clearance</div>
                  <div className="truncate text-muted">
                    {clearanceAllInherited ? "Inherited from library" : clearanceAllOverridden ? "Override for this bin" : "Mixed"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    aria-label="Clearance override in millimetres"
                    className="mono-input min-w-0 w-16 !px-2 !py-1 !text-sm"
                    type="number" step={0.1} min={0}
                    disabled={busy}
                    defaultValue={clearanceValue ?? ""}
                    placeholder={clearanceValue === undefined ? "–" : undefined}
                    key={`${selectionKey}-clearance-${clearanceValue ?? "mixed"}`}
                    ref={commitOnChange((raw) => {
                      if (raw === "") return; // untouched indeterminate field — no-op
                      const value = Number(raw);
                      if (!Number.isFinite(value)) return;
                      if (clearanceValue !== undefined && value === clearanceValue) return; // unchanged
                      void setClearance(value);
                    })}
                  />
                  <span className="text-muted">mm</span>
                </div>
              </div>
              {clearanceAllOverridden && (
                <button
                  className="mt-2 w-full text-left text-teal hover:text-knockout"
                  disabled={busy}
                  onClick={() => void setClearance(null)}
                >
                  ↩ Use library setting{clearanceInherited !== undefined ? ` (${clearanceInherited} mm)` : ""}
                </button>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                <div className="min-w-0">
                  <div className="text-knockout">Finger access</div>
                  <div className="truncate text-muted">
                    {fingerOverrideAllInherited ? "Inherited from library" : fingerOverrideAllOverridden ? "Override for this bin" : "Mixed"}
                  </div>
                </div>
                <button
                  aria-pressed={fingerAllOn}
                  className={`btn shrink-0 !px-3 !py-1 text-[10px] ${fingerAllOn ? "border-teal text-teal" : "btn-ghost text-knockout border-line"}`}
                  disabled={busy}
                  onClick={() => void setFingerHole(fingerMixed ? true : !fingerAllOn)}
                >
                  {fingerMixed ? "–" : fingerAllOn ? "On" : "Off"}
                </button>
              </div>
              {fingerOverrideAllOverridden && (
                <button
                  className="mt-2 w-full text-left text-teal hover:text-knockout"
                  disabled={busy}
                  onClick={() => void setFingerHole(null)}
                >
                  ↩ Use library setting{fingerInheritedShared !== undefined ? ` (${fingerInheritedShared ? "on" : "off"})` : ""}
                </button>
              )}
              <button
                className="mt-2 w-full btn btn-ghost text-knockout border-line text-[10px] !py-1"
                disabled={busy || selectedTools.length < 2 || !fingerAlignPlan}
                title="Align every selected tool's finger hole onto one line — needs at least 2 finger holes on the same edge (top/bottom or left/right), each within reach of the bottom-most (or left-most) one"
                onClick={() => void alignFingerHoles()}
              >
                ⟷ Align finger holes
              </button>
              {sideFlipEligible && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-knockout">Switch sides</span>
                    <button
                      aria-pressed={sideFlipAllOn}
                      className={`btn shrink-0 !px-3 !py-1 text-[10px] ${sideFlipAllOn ? "border-teal text-teal" : "btn-ghost text-knockout border-line"}`}
                      disabled={busy}
                      onClick={() => void setFingerHoleSideFlip(sideFlipMixed ? true : sideFlipAllOn ? null : true)}
                    >
                      {sideFlipMixed ? "–" : sideFlipAllOn ? "Flipped" : "Default"}
                    </button>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 text-muted">
                      <span>Position</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <input
                          aria-label="Finger-hole position offset in millimetres"
                          className="mono-input min-w-0 w-16 !px-2 !py-1 !text-sm"
                          type="number" step={1} min={-offsetMax} max={offsetMax}
                          disabled={busy}
                          defaultValue={offsetValue ?? ""}
                          placeholder={offsetValue === undefined ? "–" : undefined}
                          key={`${selectionKey}-offset-${offsetValue ?? "mixed"}`}
                          ref={commitOnChange((raw) => {
                            if (raw === "") return; // untouched indeterminate field — no-op
                            const value = Number(raw);
                            if (!Number.isFinite(value)) return;
                            if (offsetValue !== undefined && value === offsetValue) return; // unchanged
                            void setFingerHoleOffset(value);
                          })}
                        />
                        <span className="text-knockout">mm</span>
                      </div>
                    </div>
                    <input
                      aria-label="Finger-hole position offset"
                      className="mt-1 w-full accent-teal"
                      type="range"
                      min={-offsetMax}
                      max={offsetMax}
                      step={0.5}
                      disabled={busy}
                      value={offsetValue ?? 0}
                      onChange={(event) => void setFingerHoleOffset(Number(event.target.value))}
                    />
                  </div>
                  {offsetAllOverridden && (
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
              {selectedTool && selectedTool.finger_hole && selectedTool.finger_hole_side === "center" && (
                <p className="mt-3 border-t border-line pt-3 text-muted">
                  This tool's shape doesn't sit on a single side — switch-sides/position
                  controls aren't available.
                </p>
              )}
              {alignButtons}
              {distributeButtons}
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
                  <span className="truncate font-bold" style={{ color: color(i) }}>{t.label || t.id.slice(0, 6)}</span>
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
              A tool crosses the locked bin edge (or a removed grid cell) — Preview 3D is blocked until it's back inside, but you can still export or save (the tool's location may come out wrong until you fix it).
            </p>
          )}
          <button className="btn w-full text-xs" disabled={busy} onClick={() => { pushSnapshot(); void load(undefined, overridesFor(tools), binStyle); }}>↻ Auto-pack</button>
          <button className="btn btn-primary w-full" disabled={busy || !tools.length || Boolean(err)} onClick={exportBin}>
            ↓ Export bin (3MF)
          </button>
          <button
            className="btn w-full text-xs"
            disabled={busy || !tools.length || Boolean(err)}
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
                  disabled={busy}
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
          <button
            className="btn w-full text-xs"
            disabled={busy || !tools.length || Boolean(err)}
            onClick={() => {
              setSaveName(defaultBinName());
              setSaveErr(null);
              setSaveDialogOpen(true);
            }}
          >
            💾 Save to Bin Library
          </button>
          {saveDone && <p className="font-mono text-[10px] text-teal">Saved.</p>}
          {saveDialogOpen && (
            <div className="border border-line bg-field p-3 font-mono text-[10px]" style={{ borderRadius: 2 }}>
              <label className="block">
                <span className="block uppercase text-muted">Name</span>
                <input
                  aria-label="Bin Library entry name"
                  className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
                  type="text"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  autoFocus
                />
              </label>
              {saveErr && <p className="mt-2 text-orange">{saveErr}</p>}
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  className="btn text-xs"
                  disabled={saveBusy}
                  onClick={() => setSaveDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary text-xs"
                  disabled={saveBusy}
                  onClick={() => void saveToBinLibrary()}
                >
                  Save
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
