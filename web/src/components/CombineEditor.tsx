import { useEffect, useMemo, useRef, useState } from "react";
import {
  combineLibrary,
  combineLibrarySlice,
  combinePreview,
  combinePreviewGlb,
  createToolshape,
  duplicateTool,
  overwriteBin,
  saveBin,
  updateToolshape,
  type BinProfile,
  type CombinePreview,
  type CombineTool,
  type CombineToolOverride,
  type Placement,
  type RoundedRectToolshapeParams,
  type SavedBin,
} from "../api";
import { BinViewer } from "./BinViewer";
import { commitOnChange } from "../domEvents";
import { binExportName } from "../exportNaming";
import { computeFingerAlignPlan, type FingerAlignCandidate } from "../geometry/fingerAlign";
import { binOutlinePath, cellKey, isShapeConnected, type CellKey } from "../geometry/binOutline";
import { nearestArcLength, pointAtArcLength, ringLength, wrapArcLength } from "../geometry/perimeter";
import { nextToolAlongRay, type CardinalDirection } from "../geometry/nudgeDistance";
import { useBinProfiles } from "../useBinProfiles";

// No entry here should read as the same red as OVERFLOW_COLOR below — that
// color is reserved for a tool actually crossing the bin boundary, and a
// tool that merely happens to land on this index shouldn't look like one.
const PAL = ["#9ec850", "#5ab478", "#548cd6", "#e6be46", "#c85ac8", "#50c8c8", "#e69646", "#a050d6"];
const OVERFLOW_COLOR = "#ff4d4d";
// Mirrors gridshot/core/gridfinity.py's CORNER_R — the 2D preview's rounding
// only needs to look right, not be manufacturing-exact (the server builds
// the real geometry), so this is a plain constant rather than fetched data.
const BIN_CORNER_R = 3.75;

// Defaults for the "Rounded Rectangle" toolshape's placement panel — see
// gridshot/core/bintools.py TOOLSHAPE_DEFAULT_HEIGHT_MM for the (separate)
// default height a freshly-placed toolshape gets.
const DEFAULT_ROUNDED_RECT_TOOLSHAPE: RoundedRectToolshapeParams = {
  width_mm: 30, length_mm: 30, radius_mm: 1, fillet_bottom: false,
};

// Floor for edge-drag-resize — keeps a dragged edge from ever crossing its
// opposite one (width_mm/length_mm just need to stay > 0 server-side).
const MIN_TOOLSHAPE_DIM_MM = 1;

// Edge-drag-resize hit-line width, in on-screen CSS pixels (not world mm —
// see vectorEffect="non-scaling-stroke" where this is used): a ~2px buffer
// straddling the outline on either side, so grabbing an edge doesn't require
// pixel-precise aim on the exact boundary curve.
const TOOLSHAPE_RESIZE_HIT_PX = 4;

type Pt = [number, number];

/** A centroid-normalised rounded-rectangle outline for the placement-mode
 *  ghost preview only — the authoritative outline is generated server-side
 *  (gridfinity.py's toolshape_rounded_rect_outline) once a click commits the
 *  placement, so this doesn't need to match it vertex-for-vertex, just look
 *  right while dragging the shape around before that. */
function roundedRectPreviewPoints(width: number, length: number, radius: number): Pt[] {
  const hw = width / 2, hl = length / 2;
  const r = Math.max(0, Math.min(radius, hw, hl));
  if (r < 0.01) return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
  const segsPerCorner = 8;
  const corners: [number, number, number][] = [
    [hw - r, hl - r, 0], [-(hw - r), hl - r, 90],
    [-(hw - r), -(hl - r), 180], [hw - r, -(hl - r), 270],
  ];
  const pts: Pt[] = [];
  for (const [cx, cy, startDeg] of corners) {
    for (let i = 0; i <= segsPerCorner; i++) {
      const a = ((startDeg + (i / segsPerCorner) * 90) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

/** Apply a placement to a centroid-normalised stamp — mirror about the local
 *  axes, then rotate CCW about the origin (matching shapely on the server),
 *  then translate. Mirror is a separate transform from rotation (it can't be
 *  expressed as any `rot` value — a flip reverses handedness, a rotation
 *  never does), so it's applied first, in the same local frame `rot` uses. */
function placed(
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

function placedPoint(point: Pt, tx: number, ty: number, rot: number, mirrorX = false, mirrorY = false): Pt {
  return placed([point], tx, ty, rot, mirrorX, mirrorY)[0];
}

/** Which resize cursor best matches a toolshape edge's outward normal —
 *  `placed()` with no translation turns the local normal into a world-space
 *  direction, which (since the arrange view's `<g transform="scale(1,-1)">`
 *  and toData()'s own y-negation cancel out) reads directly as on-screen
 *  up/right, so a rotated toolshape's edges still get an intuitively
 *  directional cursor instead of a fixed ew/ns pair. */
function resizeCursorFor(normalLocal: Pt, tool: CombineTool): string {
  const [nx, ny] = placed([normalLocal], 0, 0, tool.rot, tool.mirror_x, tool.mirror_y)[0];
  const deg = ((Math.atan2(ny, nx) * 180) / Math.PI + 360) % 180;
  if (deg < 22.5 || deg >= 157.5) return "ew-resize";
  if (deg < 67.5) return "nesw-resize";
  if (deg < 112.5) return "ns-resize";
  return "nwse-resize";
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
  return tools.map(({ id, tx, ty, rot, mirror_x, mirror_y }) => ({ id, tx, ty, rot, mirror_x, mirror_y }));
}

/** Whether a tool's own interactively-driven fields (the ones a drag, nudge,
 *  or arrow key sets directly, with no server round-trip in between) differ
 *  between two snapshots of it. */
function toolInteractiveFieldsDiverged(before: CombineTool, now: CombineTool): boolean {
  return (
    before.tx !== now.tx || before.ty !== now.ty || before.rot !== now.rot
    || before.mirror_x !== now.mirror_x || before.mirror_y !== now.mirror_y
    || before.finger_hole_arc_mm !== now.finger_hole_arc_mm
    || before.finger_hole_arc_mm_override !== now.finger_hole_arc_mm_override
    || before.finger_hole_arc2_mm !== now.finger_hole_arc2_mm
    || before.finger_hole_arc2_mm_override !== now.finger_hole_arc2_mm_override
    || before.finger_hole_diameter_mm_override !== now.finger_hole_diameter_mm_override
    // Every edit that touches finger_holes replaces the array (see
    // commitFingerHoleArc et al.) rather than mutating it in place, so
    // reference equality alone tells us whether it changed.
    || before.finger_holes !== now.finger_holes
  );
}

function withLocalInteractiveFields(serverTool: CombineTool, local: CombineTool): CombineTool {
  return {
    ...serverTool,
    tx: local.tx, ty: local.ty, rot: local.rot,
    mirror_x: local.mirror_x, mirror_y: local.mirror_y,
    finger_hole_arc_mm: local.finger_hole_arc_mm,
    finger_hole_arc_mm_override: local.finger_hole_arc_mm_override,
    finger_hole_arc2_mm: local.finger_hole_arc2_mm,
    finger_hole_arc2_mm_override: local.finger_hole_arc2_mm_override,
    finger_hole_diameter_mm_override: local.finger_hole_diameter_mm_override,
    finger_holes: local.finger_holes,
  };
}

/** Reconciles a fresh `combinePreview` response with local state, without
 *  clobbering a drag/nudge/rotate that landed on some tool while *this*
 *  particular request was in flight (nothing gates those interactions on
 *  `busy`, by design — the whole point of the local-first, eventual-server
 *  pattern they already use is that they shouldn't have to wait).
 *
 *  `baseline` is what `tools` looked like the moment this request was built
 *  (before any concurrent edit); `current` is what it is right now, as the
 *  response comes back. A tool whose interactive fields haven't moved since
 *  baseline gets the server's response verbatim — including its freshly
 *  recomputed derived fields (depth, inherited clearance, etc.), which is
 *  the whole reason to apply the response at all. One that HAS diverged
 *  keeps its current interactive fields (the concurrent edit wins, since
 *  this response was computed from stale placements/overrides for it) but
 *  still adopts the server's other, derived fields. */
function mergeServerTools(
  serverTools: CombineTool[], baseline: CombineTool[], current: CombineTool[],
): CombineTool[] {
  return serverTools.map((serverTool) => {
    const before = baseline.find((t) => t.id === serverTool.id);
    const now = current.find((t) => t.id === serverTool.id);
    if (!before || !now || !toolInteractiveFieldsDiverged(before, now)) return serverTool;
    return withLocalInteractiveFields(serverTool, now);
  });
}

/** "Combined Bin YYYY-MM-DD" using the browser's local date (not UTC).
 *  Exported so tests can predict the name a fresh combine session's
 *  mount-time auto-mint (`mintInitialSave`) will use. */
export function defaultBinName(): string {
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
  id: string;
  label: string;
  appliedProfileId: string | null;
  placements: Placement[];
  overrides: CombineToolOverride[];
  fillHeightPct: number;
  liveGrid: boolean;
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
  floorThicknessMm: number | null;
  toolWallMm: number | null;
  toolWallFlareMm: number | null;
  toolWallReinforcementHMm: number | null;
  edgeMarginMm: number | null;
  magnetHoleInsetFromEdgeMm: number | null;
}

type StructuralOverrideKey =
  | "lipHeightMm" | "lipChamferTopMm" | "lipStraightMm" | "lipChamferBottomMm"
  | "minWallMm" | "minFloorMm" | "floorThicknessMm" | "toolWallMm"
  | "toolWallFlareMm" | "toolWallReinforcementHMm" | "edgeMarginMm"
  | "magnetHoleInsetFromEdgeMm";

/** The 12 Bin Profile structural overrides — set only by picking a profile
 *  (there's no per-field UI for these here; that lives on the Bin Profiles
 *  page), but carried in state so they thread into every request and
 *  survive undo/redo like every other profile-driven field. */
type StructuralOverrides = { [K in StructuralOverrideKey]: number | null };

const BLANK_STRUCTURAL: StructuralOverrides = {
  lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
  minWallMm: null, minFloorMm: null, floorThicknessMm: null, toolWallMm: null,
  toolWallFlareMm: null, toolWallReinforcementHMm: null, edgeMarginMm: null,
  magnetHoleInsetFromEdgeMm: null,
};

function structuralFrom(source: {
  lipHeightMm: number | null; lipChamferTopMm: number | null; lipStraightMm: number | null;
  lipChamferBottomMm: number | null; minWallMm: number | null; minFloorMm: number | null;
  floorThicknessMm: number | null; toolWallMm: number | null; toolWallFlareMm: number | null;
  toolWallReinforcementHMm: number | null; edgeMarginMm: number | null;
  magnetHoleInsetFromEdgeMm: number | null;
}): StructuralOverrides {
  return {
    lipHeightMm: source.lipHeightMm,
    lipChamferTopMm: source.lipChamferTopMm,
    lipStraightMm: source.lipStraightMm,
    lipChamferBottomMm: source.lipChamferBottomMm,
    minWallMm: source.minWallMm,
    minFloorMm: source.minFloorMm,
    floorThicknessMm: source.floorThicknessMm,
    toolWallMm: source.toolWallMm,
    toolWallFlareMm: source.toolWallFlareMm,
    toolWallReinforcementHMm: source.toolWallReinforcementHMm,
    edgeMarginMm: source.edgeMarginMm,
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
    floorThicknessMm: p.floor_thickness_mm,
    toolWallMm: p.tool_wall_mm,
    toolWallFlareMm: p.tool_wall_flare_mm,
    toolWallReinforcementHMm: p.tool_wall_reinforcement_h_mm,
    edgeMarginMm: p.edge_margin_mm,
    magnetHoleInsetFromEdgeMm: p.magnet_hole_inset_from_edge_mm,
  };
}

/** Everything undo/redo tracks — the editor's "content", as opposed to
 *  transient UI state like selection or dialog visibility. Positions/rotation
 *  live directly on each `CombineTool` (`tx`/`ty`/`rot`), so snapshotting
 *  `tools` captures them for free — no separate placements schema needed. */
interface Snapshot {
  toolIds: string[];
  tools: CombineTool[];
  fillHeightPct: number;
  liveGrid: boolean;
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
 *  "custom bin shape" — checking a cell removes it from the bin. Columns run
 *  left-to-right in increasing ix; rows run top-to-bottom in *decreasing*
 *  iy, matching the Arrange 2D view's own orientation (world y increases
 *  toward the top there, standard top-down convention — see the <g
 *  transform> in the arrange SVG). */
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
      {Array.from({ length: gy }, (_, row) => {
        const iy = gy - 1 - row;
        return Array.from({ length: gx }, (_, ix) => {
          const removed = removedCells.has(cellKey(ix, iy));
          return (
            <button
              key={cellKey(ix, iy)}
              type="button"
              aria-pressed={removed}
              aria-label={`Grid cell column ${ix + 1}, row ${row + 1}${removed ? " (removed)" : ""}`}
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
        });
      })}
    </div>
  );
}

/** Interactive multi-tool-bin editor: auto-packed layout you can drag + rotate,
 *  inspect as the exact generated solid, then export the arrangement as one 3MF. */
export function CombineEditor({
  ids,
  overallHeight: initialOverallHeight,
  initial,
  onClose,
  onSaved,
}: {
  ids: string[];
  overallHeight: number | null;
  /** When set, the editor opens seeded from this saved arrangement instead
   *  of auto-packing fresh — see `initial`-aware mount effect below. */
  initial?: CombineEditorInitial;
  onClose: () => void;
  /** Fired after "Save As" mints a new Bin Library entry (not the initial
   *  auto-mint, and not a plain autosave to the same entry) — lets the
   *  caller redirect to the new bin's own URL, so a later refresh/Back
   *  reopens *that* bin instead of the one this session started from. */
  onSaved?: (saved: SavedBin) => void;
}) {
  const binProfiles = useBinProfiles();
  // Editable from the arrange page itself (see the "Usable height" control),
  // not just a fixed value the caller set before opening the editor — seeded
  // once from the prop, same pattern as lip/magnetHoles/etc below.
  const [overallHeight, setOverallHeight] = useState<number | null>(initialOverallHeight);
  // The `ids` prop is only this editor's *starting* set — Duplicate appends
  // to this, and a successful mint/Save As adopts the (possibly just-forked)
  // ids the server returns, so a later save in the session doesn't re-fork
  // still-raw ids the client is holding locally (see mintInitialSave/
  // saveToBinLibrary below).
  const [toolIds, setToolIds] = useState<string[]>(ids);
  const [meta, setMeta] = useState<CombinePreview | null>(null);
  const [tools, setTools] = useState<CombineTool[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Mutually exclusive with selectedIds: selecting a finger hole deselects
  // every tool, and vice versa (see down()/downFingerHole() below). A plain
  // click replaces this with a single-tool set (and starts a drag); a
  // shift-click toggles membership instead (no drag) — multi-selecting
  // finger holes is what enables Align/Copy style and multi-hole nudge.
  const [selectedFingerHoleToolIds, setSelectedFingerHoleToolIds] = useState<Set<string>>(new Set());
  // Which focal point (0 = P1, 1 = P2) a span hole's selection/drag/nudge
  // currently addresses. Meaningless (stays 0) for a single-point hole, and
  // only meaningful for the single-select case (size === 1) — a multi-hole
  // nudge moves both points of a span hole regardless.
  const [selectedFingerPointIndex, setSelectedFingerPointIndex] = useState<0 | 1>(0);
  // The non-selected point of a selected span hole, while the pointer sits
  // within its click-to-select slop radius — renders a "select hint" ring.
  const [hoveredFingerPoint, setHoveredFingerPoint] = useState<{ toolId: string; pointIndex: 0 | 1 } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // The direction of the most recent tool nudge, while it's still "live" —
  // drives the "distance to next tool" annotation. Cleared on deselect/
  // reselect and on any non-nudge action (see pushSnapshot/pushSnapshotCoalesced).
  const [nudgeAnnotationDir, setNudgeAnnotationDir] = useState<CardinalDirection | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"arrange" | "preview">("arrange");
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [fillHeightPct, setFillHeightPct] = useState<number>(initial?.fillHeightPct ?? 100);
  const [liveGrid, setLiveGrid] = useState<boolean>(initial?.liveGrid ?? false);
  const [lip, setLip] = useState(initial?.lip ?? true);
  // Independent of fillHeightPct/liveGrid — not derived from them. Set only
  // by picking a profile (or true by default, matching every style's
  // behaviour before Bin Profiles existed); the "Custom bin shape" control
  // still separately requires fillHeightPct === 100 && !liveGrid, since the
  // geometry itself can't do custom shapes off that fast path regardless of
  // this flag.
  const [allowCustomShape, setAllowCustomShape] = useState(true);
  const [structural, setStructural] = useState<StructuralOverrides>(
    () => (initial ? structuralFrom(initial) : BLANK_STRUCTURAL),
  );
  // Purely which profile the dropdown displays as picked — cosmetic only.
  // Fields copied from a profile are independently editable afterward, so
  // this can go stale relative to the live style state; that's expected.
  const [appliedProfileId, setAppliedProfileId] = useState<string | null>(initial?.appliedProfileId ?? null);
  // Set once the auto-pack from the initial mount `load()` resolves — gates
  // the "apply the first bin profile automatically" effect below so it never
  // races that load with a stale/empty placements array.
  const [autoPacked, setAutoPacked] = useState(false);
  const defaultProfileApplied = useRef(false);
  // The Bin Library entry this session is attached to — either reopened, or
  // (for a fresh session) minted immediately at mount by mintInitialSave.
  // Every edit from then on autosaves here; "Save As…" attaches to a new
  // entry instead, forked off the current state.
  const [savedBinId, setSavedBinId] = useState<string | null>(initial?.id ?? null);
  const [magnetHoles, setMagnetHoles] = useState(initial?.magnetHoles ?? false);
  const [magnetHoleDiameter, setMagnetHoleDiameter] = useState(String(initial?.magnetHoleDiameterMm ?? "6.5"));
  const [magnetHoleDepth, setMagnetHoleDepth] = useState(String(initial?.magnetHoleDepthMm ?? "2"));
  const [nudge, setNudge] = useState("0.1");
  const [sliceDialogOpen, setSliceDialogOpen] = useState(false);
  const [sliceThickness, setSliceThickness] = useState("1.0"); // mirrors grid_mod.SLICE_THICKNESS_MM
  // Own error slot, separate from the shared `err` — a slice-export failure
  // shouldn't disable Export bin/Save-to-library, which have nothing to do
  // with the slice dialog.
  const [sliceErr, setSliceErr] = useState<string | null>(null);
  const [lockedRotations, setLockedRotations] = useState<Set<string>>(new Set());
  const [forceSize, setForceSize] = useState(Boolean(initial?.forceGx && initial?.forceGy));
  const [forceGx, setForceGx] = useState(initial?.forceGx ? String(initial.forceGx) : "");
  const [forceGy, setForceGy] = useState(initial?.forceGy ? String(initial.forceGy) : "");
  const [customShape, setCustomShape] = useState(Boolean(initial?.removedCells?.length));
  const [removedCells, setRemovedCells] = useState<Set<CellKey>>(
    () => new Set((initial?.removedCells ?? []).map(([ix, iy]) => cellKey(ix, iy))),
  );
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [duplicateErr, setDuplicateErr] = useState<string | null>(null);
  // Toolshape placement mode: non-null while the "Rounded Rectangle" palette
  // control is active, carrying the params the panel edits before a click
  // commits them. `ghostPos` (world mm) tracks the pointer for the live
  // outline preview — see toData()/the arrange <svg>'s pointer handlers.
  const [placingToolshape, setPlacingToolshape] = useState<RoundedRectToolshapeParams | null>(null);
  const [ghostPos, setGhostPos] = useState<Pt | null>(null);
  const [placeToolshapeBusy, setPlaceToolshapeBusy] = useState(false);
  const [placeToolshapeErr, setPlaceToolshapeErr] = useState<string | null>(null);
  const [toolshapeUpdateBusy, setToolshapeUpdateBusy] = useState(false);
  const [toolshapeUpdateErr, setToolshapeUpdateErr] = useState<string | null>(null);
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
  const fingerDrag = useRef<{ toolId: string; pointIndex: 0 | 1; moved: boolean } | null>(null);
  // Edge-drag-resize of a selected rounded-rectangle toolshape: `valueMm` is
  // kept current on every pointermove so onPointerUp can read the final
  // dragged size synchronously (no reliance on React state having flushed
  // between the last pointermove and the pointerup that commits it).
  const toolshapeResizeDrag = useRef<{
    toolId: string; axis: "width" | "length"; moved: boolean; valueMm: number;
  } | null>(null);
  // Drives the live preview polygon and hides the tool's finger hole for the
  // duration of a resize gesture — set at drag start, and (unlike the ref
  // above) not cleared until updateSelectedToolshape's round-trip actually
  // lands, so the finger hole never flashes at its stale pre-resize spot
  // before jumping to its new one.
  const [toolshapeResizeLive, setToolshapeResizeLive] = useState<{
    toolId: string; axis: "width" | "length"; valueMm: number;
  } | null>(null);
  const previewSequence = useRef(0);
  const glbUrlRef = useRef<string | null>(null);
  // Non-null exactly while a debounced autosave is scheduled but hasn't
  // fired yet — Close flushes it immediately instead of losing the edit.
  const pendingAutosaveTimer = useRef<number | null>(null);
  const depthCheckboxRef = useRef<HTMLInputElement>(null);

  const selectedTools = tools.filter((t) => selectedIds.has(t.id));
  const selectedTool = selectedTools.length === 1 ? selectedTools[0] : null;
  // The tools whose finger hole is currently selected — Align/Copy style and
  // the multi-hole nudge all iterate this, not the tool multi-selection above.
  const selectedFingerHoleTools = tools.filter((t) => selectedFingerHoleToolIds.has(t.id));
  const selectionKey = [...selectedIds].sort().join(",");

  useEffect(() => {
    setDepthOverrideDraft(null);
    setNudgeAnnotationDir(null);
  }, [selectionKey]);

  // Esc clears the selection, and Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z undo/redo,
  // from anywhere in the modal — except while typing in a field, where none
  // of that has an obvious meaning and could surprise someone mid-edit.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        if (placingToolshape) {
          setPlacingToolshape(null);
          setGhostPos(null);
          return;
        }
        setSelectedIds(new Set());
        setSelectedFingerHoleToolIds(new Set());
        setSelectedFingerPointIndex(0);
      } else if ((e.metaKey || e.ctrlKey) && (e.code === "KeyZ" || e.key.toLowerCase() === "z")) {
        e.preventDefault();
        // On macOS, Cmd+Shift+Z can reach here with e.shiftKey read as false
        // (the browser's own Cmd+Shift+Z "Redo" menu shortcut appears to
        // race the DOM event's modifier snapshot) — e.key still comes
        // through as the shifted "Z" even then, so treat that as an
        // equally valid signal rather than trusting e.shiftKey alone.
        // Never let an ambiguous signal fall through to undo(): the whole
        // point is Cmd+Shift+Z must not silently undo instead of redo.
        if (e.shiftKey || e.key === "Z") redo(); else undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, placingToolshape]);

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
      finger_hole_arc_mm_override, finger_hole_diameter_mm_override,
      finger_hole_span_override, finger_hole_arc2_mm_override,
      depth_mm_override,
    }) => ({
      id,
      finger_hole: finger_hole_override,
      clearance_mm: clearance_mm_override,
      finger_hole_arc_mm: finger_hole_arc_mm_override,
      finger_hole_diameter_mm: finger_hole_diameter_mm_override,
      finger_hole_span: finger_hole_span_override,
      finger_hole_arc2_mm: finger_hole_arc2_mm_override,
      locked_rotation_deg: lockedRotationsOverride.has(id) ? rot : null,
      pocket_depth_mm: depth_mm_override,
    }));
  }

  function removedCellsArray(cells: Set<CellKey>): [number, number][] {
    return [...cells].map((k) => k.split(",").map(Number) as [number, number]);
  }

  // Custom bin shape only applies on the fast path (fill_height_pct=100,
  // live_grid off), and only when the active profile allows it — the
  // checkbox state and removed cells stay intact across a style/profile
  // switch (so they reappear if you switch back), but are ignored otherwise.
  function effectiveRemovedCells(
    fillPct: number, liveGridVal: boolean = liveGrid, allow: boolean = allowCustomShape,
  ): [number, number][] | null {
    return fillPct === 100 && !liveGridVal && allow && customShape && removedCells.size > 0
      ? removedCellsArray(removedCells)
      : null;
  }

  async function load(
    placements?: Placement[],
    overrides: CombineToolOverride[] = overridesFor(tools),
    fillHeightPctOverride: number = fillHeightPct,
    force: [number, number] | null = forceSize && forceGx && forceGy
      ? [Number(forceGx), Number(forceGy)]
      : null,
    removed: [number, number][] | null = effectiveRemovedCells(fillHeightPctOverride),
    lipOverride: boolean = lip,
    structuralOverride: StructuralOverrides = structural,
    magnetHolesOverride: boolean = magnetHoles,
    magnetHoleDiameterOverride: string = magnetHoleDiameter,
    magnetHoleDepthOverride: string = magnetHoleDepth,
    // Only Duplicate needs this — it must load with the just-appended id
    // immediately, before React re-renders with the new `toolIds` state.
    idsOverride: string[] = toolIds,
    liveGridOverride: boolean = liveGrid,
    // Set only when placements themselves are unchanged but a tool's own
    // geometry just changed (a resized toolshape) — see updateSelectedToolshape.
    preservePlacementsOverride: boolean = false,
    overallHeightOverride: number | null = overallHeight,
  ) {
    const baseline = tools; // local state as of the moment this request was built
    setBusy(true);
    setErr(null);
    try {
      const p = await combinePreview(idsOverride, {
        placements: placements ?? null,
        preservePlacements: preservePlacementsOverride,
        overallHeight: overallHeightOverride,
        lip: lipOverride,
        overrides,
        fillHeightPct: fillHeightPctOverride,
        liveGrid: liveGridOverride,
        magnetHoles: magnetHolesOverride,
        magnetHoleDiameterMm: Number(magnetHoleDiameterOverride),
        magnetHoleDepthMm: Number(magnetHoleDepthOverride),
        forceGx: force ? force[0] : null,
        forceGy: force ? force[1] : null,
        removedCells: removed,
        ...structuralOverride,
      });
      setMeta(p);
      // A functional update, not `setTools(p.tools)`: `tools` (this closure's
      // `baseline`) may already be stale by the time this response lands, if
      // a drag/nudge landed on some tool while this request was in flight —
      // reconcile against whatever's *actually* current, not what was true
      // when this call started. React runs the updater synchronously, so
      // `merged` is settled by the time this function returns it below.
      let merged: CombineTool[] = p.tools;
      setTools((current) => {
        merged = mergeServerTools(p.tools, baseline, current);
        return merged;
      });
      setSelectedIds((current) => new Set([...current].filter((id) => p.tools.some((tool) => tool.id === id))));
      return merged;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initial) {
      // Reopening a saved bin: honour its placements as a manual arrangement,
      // not a fresh auto-pack.
      void load(
        initial.placements, initial.overrides, initial.fillHeightPct,
        initial.forceGx && initial.forceGy ? [initial.forceGx, initial.forceGy] : null,
        initial.removedCells,
        undefined, undefined, undefined, undefined, undefined, toolIds, initial.liveGrid,
      );
    } else {
      void load().then(async (freshTools) => {
        setAutoPacked(true); // auto-pack on open
        if (freshTools) await mintInitialSave(freshTools);
      });
    }
  }, []); // eslint-disable-line

  /** Copies a profile's fields into local state and reloads with them —
   *  shared by the picker's onChange (a discrete, undo-able user action) and
   *  the auto-default effect below (silent, not undo-able: it's the starting
   *  state, not something the user did). Every field is a one-time copy, not
   *  a live link — editing or deleting the profile later never changes this
   *  bin. */
  function applyProfile(profile: BinProfile, { snapshot = true }: { snapshot?: boolean } = {}) {
    if (snapshot) pushSnapshot();
    setAppliedProfileId(profile.id);
    setFillHeightPct(profile.fill_height_pct);
    setLiveGrid(profile.live_grid);
    setLip(profile.lip);
    setAllowCustomShape(profile.allow_custom_shape);
    setMagnetHoles(profile.magnet_holes_default);
    setMagnetHoleDiameter(String(profile.magnet_hole_diameter_mm_default));
    setMagnetHoleDepth(String(profile.magnet_hole_depth_mm_default));
    const nextStructural = structuralFromProfile(profile);
    setStructural(nextStructural);
    void load(
      placementsFor(tools), overridesFor(tools), profile.fill_height_pct, undefined,
      effectiveRemovedCells(profile.fill_height_pct, profile.live_grid, profile.allow_custom_shape),
      profile.lip, nextStructural,
      profile.magnet_holes_default,
      String(profile.magnet_hole_diameter_mm_default),
      String(profile.magnet_hole_depth_mm_default),
      toolIds, profile.live_grid,
    );
  }

  // Opening a fresh combine (no `initial`) with no profile explicitly
  // applied yet: default the picker to the first Bin Profile, same as a
  // manual pick but without an undo step — this is the starting state, not
  // a user action. Gated on `autoPacked` so it never races the initial
  // auto-pack `load()` with a stale/empty placements array; gated on the ref
  // (not just `appliedProfileId`) so a manual pick before profiles finish
  // loading can't be clobbered once they do.
  useEffect(() => {
    if (initial) return;
    if (!autoPacked) return;
    if (defaultProfileApplied.current) return;
    if (binProfiles.length === 0) return;
    defaultProfileApplied.current = true;
    applyProfile(binProfiles[0], { snapshot: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPacked, binProfiles]);

  const UNDO_HISTORY_LIMIT = 50;
  const NUDGE_BURST_MS = 1000;
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const burstActive = useRef(false);
  const burstTimer = useRef<number | null>(null);
  // What the current burst is *of* — a tool's rotation, a specific finger
  // hole's arc position, etc. A burst only continues coalescing into the
  // same undo step while every call names the same key; a different key
  // (nudging a different tool, or a different finger hole) ends the
  // previous burst and starts its own step instead, even if it lands inside
  // the previous burst's coalescing window.
  const burstKey = useRef<string | null>(null);

  function snapshot(): Snapshot {
    return {
      toolIds: [...toolIds],
      tools: tools.map((t) => ({ ...t })),
      fillHeightPct,
      liveGrid,
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
    setNudgeAnnotationDir(null);
  }

  /** Same as `pushSnapshot`, but for a *burst* of rapid-fire actions (nudge
   *  keys, fine-rotate clicks, typing a rotation value) — pushes once at the
   *  start of the burst, then holds off until `NUDGE_BURST_MS` after the
   *  last call, so undo reverts the whole burst in one step.
   *
   *  `key` scopes the burst to what's actually being changed (e.g.
   *  `rotate:${toolId}`, `fingerArc:${toolId}:${pointIndex}`): a call with a
   *  different key always starts a fresh step, even inside the previous
   *  burst's coalescing window, so nudging tool A then quickly nudging tool
   *  B's finger hole doesn't silently merge B's change into A's undo step. */
  function pushSnapshotCoalesced(key: string) {
    if (!burstActive.current || burstKey.current !== key) {
      pushSnapshot();
      burstActive.current = true;
      burstKey.current = key;
    }
    if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
    burstTimer.current = window.setTimeout(() => {
      burstActive.current = false;
      burstKey.current = null;
      burstTimer.current = null;
    }, NUDGE_BURST_MS);
  }

  function applySnapshot(s: Snapshot) {
    setToolIds(s.toolIds);
    setTools(s.tools);
    setFillHeightPct(s.fillHeightPct);
    setLiveGrid(s.liveGrid);
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
    const removed = s.fillHeightPct === 100 && !s.liveGrid && s.allowCustomShape && s.customShape && s.removedCells.size > 0
      ? removedCellsArray(s.removedCells)
      : null;
    void load(
      placementsFor(s.tools), overridesFor(s.tools, s.lockedRotations), s.fillHeightPct, force, removed,
      s.lip, s.structural, s.magnetHoles, s.magnetHoleDiameter, s.magnetHoleDepth, s.toolIds, s.liveGrid,
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

  const idsKey = toolIds.join("|");
  const geometryKey = useMemo(
    () => JSON.stringify(tools.map((tool) => [
      tool.id,
      tool.tx,
      tool.ty,
      tool.rot,
      tool.mirror_x,
      tool.mirror_y,
      tool.finger_hole_override,
      tool.clearance_mm_override,
      tool.finger_hole_arc_mm_override,
      tool.finger_hole_diameter_mm_override,
      tool.finger_hole_span_override,
      tool.finger_hole_arc2_mm_override,
      tool.depth_mm_override,
    ])),
    [tools],
  );

  // live footprint from the current arrangement (mirrors the server's auto_grid) —
  // unless "force bin size" is on, in which case the footprint is LOCKED to the
  // forced gx/gy and never re-fit to wherever tools currently sit (drag included).
  const layout = useMemo(() => {
    if (!meta || !tools.length) return null;
    const polys = tools.map((t) => placed(t.stamp, t.tx, t.ty, t.rot, t.mirror_x, t.mirror_y));
    const fingerCircles = tools.flatMap((tool) => tool.finger_holes.map(([x, y, diameter], pointIndex) => {
      const [cx, cy] = placedPoint([x, y], tool.tx, tool.ty, tool.rot, tool.mirror_x, tool.mirror_y);
      return { toolId: tool.id, pointIndex: pointIndex as 0 | 1, cx, cy, radius: diameter / 2 };
    }));
    // A span hole's two lobes read as one pill — draw a stroke between their
    // centers, as wide as the hole diameter, under the circles themselves.
    const fingerConnectors = fingerCircles.reduce<{ toolId: string; x1: number; y1: number; x2: number; y2: number; diameter: number }[]>(
      (acc, hole) => {
        if (hole.pointIndex !== 1) return acc;
        const p1 = fingerCircles.find((h) => h.toolId === hole.toolId && h.pointIndex === 0);
        if (!p1) return acc;
        acc.push({ toolId: hole.toolId, x1: p1.cx, y1: p1.cy, x2: hole.cx, y2: hole.cy, diameter: hole.radius * 2 });
        return acc;
      },
      [],
    );
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
    if (locked && fillHeightPct === 100 && !liveGrid && customShape && removedCells.size > 0) {
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

    return { polys, fingerCircles, fingerConnectors, gx, gy, ow, od, cx, cy, locked, overflowIds, viewCx, viewCy, viewW, viewH };
  }, [tools, meta, forceSize, forceGx, forceGy, fillHeightPct, liveGrid, customShape, removedCells]);

  const hasOverflow = Boolean(layout?.locked && layout.overflowIds.size > 0);
  // Derived straight from `hasOverflow` rather than latched into `previewErr`
  // — a value that's just "the current state of the arrangement" can't get
  // stuck showing a stale warning the way a one-shot `setState` can.
  const previewMessage = hasOverflow
    ? "A tool extends past the locked bin size (or over a removed grid cell) — move it back inside, or adjust the forced shape, before rendering."
    : previewErr;

  // The slice coupon is a real cross-section of the actual solid (see
  // grid_mod.slice_layer) — the server already clamps the requested
  // thickness down to the shallowest pocket's own depth
  // (grid_mod.slice_window's `min_depth`), so anything past that is a no-op,
  // not a genuinely larger slice. Cap the field at that same bound instead
  // of an arbitrary fixed number, so a bin with deep pockets isn't stuck at
  // a limit that was never about the geometry.
  const SLICE_MIN_THICKNESS_MM = 0.5;
  const maxSliceThicknessMm = tools.length
    ? Math.min(...tools.map((t) => t.depth_mm))
    : SLICE_MIN_THICKNESS_MM;
  const sliceThicknessNum = Number(sliceThickness);
  const sliceThicknessInvalid = !Number.isFinite(sliceThicknessNum)
    || sliceThicknessNum < SLICE_MIN_THICKNESS_MM
    || sliceThicknessNum > maxSliceThicknessMm;

  // "Distance to next tool" nudge annotation — a ray from the selected
  // tool's own placed bbox center, in the direction just nudged AND its
  // opposite, to wherever it first meets another tool's placed outline or
  // (if nothing's closer) the grid's own edge. Kept out of the `layout`
  // memo above so nudging (which only changes `tools`/`nudgeAnnotationDir`,
  // both already deps here) doesn't force it to recompute bin/grid geometry.
  const nudgeAnnotation = useMemo(() => {
    if (!selectedTool || !nudgeAnnotationDir || !layout) return null;
    const selfIndex = tools.findIndex((t) => t.id === selectedTool.id);
    if (selfIndex < 0) return null;
    const box = bboxOf(layout.polys[selfIndex]);
    const center: Pt = [(box.minx + box.maxx) / 2, (box.miny + box.maxy) / 2];
    // A synthetic rectangle at the grid's own footprint edges, fed into the
    // same ray cast as every other tool — the ray naturally prefers a real
    // tool over this whenever one sits closer, and only ever reaches this
    // rect's near edge (the far edge needs a negative ray parameter from
    // inside the rect, so it never wins).
    const gridBoundaryId = "__grid_edge__";
    const halfW = layout.ow / 2, halfD = layout.od / 2;
    const gridBoundary: Pt[] = [
      [layout.cx - halfW, layout.cy - halfD],
      [layout.cx + halfW, layout.cy - halfD],
      [layout.cx + halfW, layout.cy + halfD],
      [layout.cx - halfW, layout.cy + halfD],
    ];
    const polys = [
      ...tools.map((t, i) => ({ id: t.id, poly: layout.polys[i] })),
      { id: gridBoundaryId, poly: gridBoundary },
    ];
    const oppositeDir: CardinalDirection = nudgeAnnotationDir === "up" ? "down"
      : nudgeAnnotationDir === "down" ? "up"
      : nudgeAnnotationDir === "left" ? "right" : "left";
    const toward = nextToolAlongRay(center, nudgeAnnotationDir, polys, selectedTool.id);
    const away = nextToolAlongRay(center, oppositeDir, polys, selectedTool.id);
    if (!toward && !away) return null;
    const bold = toward !== null && away !== null && toward.distanceMm === away.distanceMm;
    return { toward, away, bold };
  }, [tools, layout, selectedTool, nudgeAnnotationDir]);

  // Generate after the arrangement settles. This endpoint calls the same solid
  // builder as 3MF export; no browser-side mesh approximation is involved.
  useEffect(() => {
    // `previewErr` only ever holds a real fetch failure now — the overflow
    // message is derived straight from `hasOverflow` at the render site
    // instead, so it can never outlive the condition that produced it (a
    // stale fetch error used to survive here too: this guard used to return
    // before clearing it, so dropping back below 2 tools while an error was
    // showing left it stuck until the editor was remounted).
    if (!meta || tools.length < 2) { setPreviewErr(null); return; }
    const sequence = ++previewSequence.current;
    if (hasOverflow) {
      setPreviewBusy(false);
      setPreviewErr(null);
      return;
    }
    const placements = placementsFor(tools);
    const overrides = overridesFor(tools);
    setPreviewBusy(true);
    setPreviewErr(null);
    const forceGxVal = forceSize && forceGx && forceGy ? Number(forceGx) : null;
    const forceGyVal = forceSize && forceGx && forceGy ? Number(forceGy) : null;
    const removedVal = effectiveRemovedCells(fillHeightPct);
    const timer = window.setTimeout(() => {
      combinePreviewGlb(toolIds, {
        placements, overallHeight, lip, overrides, fillHeightPct, liveGrid,
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
  }, [idsKey, geometryKey, overallHeight, lip, fillHeightPct, liveGrid, allowCustomShape, structural, magnetHoles, magnetHoleDiameter, magnetHoleDepth, forceSize, forceGx, forceGy, customShape, removedCells, hasOverflow, Boolean(meta)]); // eslint-disable-line

  useEffect(() => () => {
    previewSequence.current += 1;
    if (glbUrlRef.current) URL.revokeObjectURL(glbUrlRef.current);
  }, []);

  const AUTOSAVE_DEBOUNCE_MS = 1500;
  // Persists the recipe automatically once this session has its own bin
  // (see mintInitialSave) — same debounced-settle shape as the GLB preview
  // effect above, and the same "everything that defines the saved recipe"
  // dependency list, just with its own (longer) debounce and a save instead
  // of a preview rebuild. Deliberately doesn't touch `tools`/`setTools` at
  // all, so it can never interact with undo/redo (see `autoSave` above).
  useEffect(() => {
    if (!savedBinId) return;
    const timer = window.setTimeout(() => {
      pendingAutosaveTimer.current = null;
      void autoSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    pendingAutosaveTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (pendingAutosaveTimer.current === timer) pendingAutosaveTimer.current = null;
    };
  }, [savedBinId, savedLabel, idsKey, geometryKey, overallHeight, lip, fillHeightPct, liveGrid, allowCustomShape, structural, magnetHoles, magnetHoleDiameter, magnetHoleDepth, forceSize, forceGx, forceGy, customShape, removedCells]); // eslint-disable-line

  /** Close never silently drops a still-debouncing autosave — flush it right
   *  now (the request survives this component unmounting; only the local
   *  success/error UI feedback wouldn't be seen, which is fine on Close). */
  function handleClose() {
    if (pendingAutosaveTimer.current !== null) {
      window.clearTimeout(pendingAutosaveTimer.current);
      pendingAutosaveTimer.current = null;
      void autoSave();
    }
    onClose();
  }

  function toData(e: React.PointerEvent): Pt {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const d = p.matrixTransform(svg.getScreenCTM()!.inverse());
    // getScreenCTM() reflects the <svg>'s own viewBox mapping, not the
    // content <g>'s mirror — undo that same y mirror here so callers get
    // true world (tx/ty) coordinates straight back.
    return [d.x, -d.y];
  }
  function down(id: string, e: React.PointerEvent) {
    // Placement mode owns every click on the canvas while it's armed — let
    // it bubble to the <svg>'s own onPointerDown instead of this tool
    // grabbing it, or a click meant to place a new toolshape on top of an
    // existing tool would silently select that tool instead and leave
    // placement mode stuck open.
    if (placingToolshape) return;
    e.stopPropagation();
    arrangeRef.current?.focus();
    setSelectedFingerHoleToolIds(new Set());
    setSelectedFingerPointIndex(0);
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
  /** Apply a new arc-length position to one tool's finger hole — wraps it
   *  onto the ring and updates both the value sent to the server
   *  (`finger_hole_arc_mm`/`_override`, or the `arc2` pair when `pointIndex`
   *  is 1) and the local point used for instant rendering
   *  (`finger_holes[pointIndex]`, patched in place — the other point, if
   *  any, is left untouched), the same two-tier pattern tx/ty dragging
   *  already uses (local state now, a debounced server round-trip once the
   *  gesture settles). */
  function commitFingerHoleArc(id: string, arcMm: number, pointIndex: 0 | 1 = 0) {
    setTools((ts) => ts.map((t) => {
      if (t.id !== id) return t;
      if (pointIndex === 1 && !t.finger_hole_span) return t;
      const wrapped = wrapArcLength(t.stamp, arcMm);
      const [lx, ly] = pointAtArcLength(t.stamp, wrapped);
      const diameter = t.finger_holes[pointIndex]?.[2] ?? t.finger_holes[0]?.[2] ?? 20;
      const finger_holes = t.finger_holes.map((entry, i) => (i === pointIndex ? [lx, ly, diameter] : entry)) as typeof t.finger_holes;
      return pointIndex === 1
        ? { ...t, finger_hole_arc2_mm: wrapped, finger_hole_arc2_mm_override: wrapped, finger_holes }
        : { ...t, finger_hole_arc_mm: wrapped, finger_hole_arc_mm_override: wrapped, finger_holes };
    }));
  }
  /** Turn a selected hole's span on/off. On: seeds a fresh second point
   *  "diametrically opposite" P1 (same rule as the Up/Down jump — see
   *  `arcOnOppositeSide`) and appends it to `finger_holes`. Off: drops
   *  exactly the point span-on added — P1 (and whichever point is currently
   *  selected, if it was P1) is left exactly where it was, so toggling span
   *  on then off is a no-op round-trip. */
  function spanFingerHole(toolId: string, on: boolean) {
    setTools((ts) => ts.map((t) => {
      if (t.id !== toolId) return t;
      if (on) {
        const arc2 = arcOnOppositeSide(t, t.finger_hole_arc_mm) ?? t.finger_hole_arc_mm;
        const wrapped = wrapArcLength(t.stamp, arc2);
        const [lx, ly] = pointAtArcLength(t.stamp, wrapped);
        const diameter = t.finger_holes[0]?.[2] ?? 20;
        return {
          ...t,
          finger_hole_span: true,
          finger_hole_span_override: true,
          finger_hole_arc2_mm: wrapped,
          finger_hole_arc2_mm_override: wrapped,
          finger_holes: [t.finger_holes[0] ?? [0, 0, diameter], [lx, ly, diameter]],
        };
      }
      return {
        ...t,
        finger_hole_span: false,
        finger_hole_span_override: false,
        finger_hole_arc2_mm_override: null,
        finger_holes: t.finger_holes.slice(0, 1),
      };
    }));
    setSelectedFingerPointIndex(0);
  }
  /** Resize the selected finger hole in place — same two-tier local/eventual-
   *  server pattern as `commitFingerHoleArc`: the center (x/y) is untouched,
   *  only the diameter changes, so the circle grows/shrinks around its
   *  current position on the outline. */
  function setFingerHoleDiameter(toolId: string, diameterMm: number) {
    if (!Number.isFinite(diameterMm) || diameterMm <= 0) return;
    setTools((ts) => ts.map((t) => {
      if (t.id !== toolId) return t;
      return {
        ...t,
        finger_hole_diameter_mm_override: diameterMm,
        finger_holes: t.finger_holes.map(([x, y]) => [x, y, diameterMm]),
      };
    }));
  }
  /** World point → the arc-length of the nearest point on `tool`'s own ring,
   *  undoing mirror/rotate/translate to reach the tool's local frame first
   *  (the inverse of `placed()`). */
  function localArcForWorldPoint(tool: CombineTool, mx: number, my: number): number {
    return nearestArcLength(tool.stamp, worldToLocal(tool, mx, my));
  }
  /** World point → `tool`'s own local frame, undoing translate/rotate/mirror
   *  (the inverse of `placed()`). Shared by finger-hole arc-length lookup
   *  (above) and toolshape edge-drag-resize (below). */
  function worldToLocal(tool: CombineTool, mx: number, my: number): Pt {
    const wx = mx - tool.tx, wy = my - tool.ty;
    const rad = (-tool.rot * Math.PI) / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    let lx = wx * c - wy * s, ly = wx * s + wy * c;
    if (tool.mirror_x) lx = -lx;
    if (tool.mirror_y) ly = -ly;
    return [lx, ly];
  }
  /** Start dragging one edge of the selected toolshape to resize it along a
   *  single axis (width from left/right, length from top/bottom) — see the
   *  arrange <svg>'s onPointerMove/onPointerUp below for the rest of the
   *  gesture. Committing reuses updateSelectedToolshape, so a drag gets the
   *  same single-undo-step and preserve-other-tools'-placements behaviour as
   *  typing directly into the width/length fields. */
  function downToolshapeResize(tool: CombineTool, axis: "width" | "length", e: React.PointerEvent) {
    e.stopPropagation();
    arrangeRef.current?.focus();
    const valueMm = (axis === "width" ? tool.toolshape_width_mm : tool.toolshape_length_mm) ?? 0;
    toolshapeResizeDrag.current = { toolId: tool.id, axis, moved: false, valueMm };
    setToolshapeResizeLive({ toolId: tool.id, axis, valueMm });
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function moveToolshapeResize(e: React.PointerEvent) {
    const d = toolshapeResizeDrag.current;
    if (!d) return;
    const tool = tools.find((t) => t.id === d.toolId);
    if (!tool) return;
    const [mx, my] = toData(e);
    const [lx, ly] = worldToLocal(tool, mx, my);
    // The shape stays centred on (tx, ty) as it resizes, so a dragged edge's
    // distance from that centre *is* half the new dimension — true no matter
    // which of the two edges on that axis was grabbed.
    const raw = 2 * Math.abs(d.axis === "width" ? lx : ly);
    const valueMm = Math.max(MIN_TOOLSHAPE_DIM_MM, Math.round(raw * 10) / 10);
    d.moved = true;
    d.valueMm = valueMm;
    setToolshapeResizeLive({ toolId: d.toolId, axis: d.axis, valueMm });
  }
  /** Plain click replaces the finger-hole selection with just this tool's
   *  hole and starts a drag, exactly as before multi-select existed.
   *  Shift-click instead toggles this tool's membership in the selection
   *  (mirroring nextSelection's tool-selection behavior) and does *not*
   *  start a drag — dragging stays a single-hole-only action. Either way,
   *  the point just clicked becomes the "active" one for point-specific
   *  actions (diameter, span toggle, Up/Down jump), which only apply while
   *  exactly one tool's hole is selected. */
  function downFingerHole(toolId: string, pointIndex: 0 | 1, e: React.PointerEvent) {
    // Same reasoning as down() above — don't let an existing finger hole
    // swallow a click meant to place a new toolshape.
    if (placingToolshape) return;
    e.stopPropagation();
    arrangeRef.current?.focus();
    setSelectedIds(new Set());
    setSelectedFingerPointIndex(pointIndex);
    setHoveredFingerPoint(null);
    if (e.shiftKey) {
      setSelectedFingerHoleToolIds((current) => {
        const next = new Set(current);
        next.has(toolId) ? next.delete(toolId) : next.add(toolId);
        return next;
      });
      return;
    }
    setSelectedFingerHoleToolIds(new Set([toolId]));
    fingerDrag.current = { toolId, pointIndex, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function moveFingerHole(e: React.PointerEvent) {
    if (!fingerDrag.current) return;
    const tool = tools.find((t) => t.id === fingerDrag.current!.toolId);
    if (!tool) return;
    const [mx, my] = toData(e);
    if (!fingerDrag.current.moved) pushSnapshot();
    fingerDrag.current.moved = true;
    commitFingerHoleArc(tool.id, localArcForWorldPoint(tool, mx, my), fingerDrag.current.pointIndex);
  }
  /** Number of ring samples used to find the "straight across" jump target
   *  for Up/Down — a `argmax`/`argmin` of world y would tie across every
   *  sample on a long flat edge (e.g. a knife blade's straight top) and land
   *  on an arbitrary corner; matching world x instead lands where "jump to
   *  the other side" actually reads as meaning. */
  /** Extra click/hover radius (beyond the lobe's own drawn radius) for
   *  selecting the *other* focal point of a span hole — so switching between
   *  P1/P2 doesn't require pixel-perfect precision on the small circle. */
  const FINGER_SELECT_SLOP_MM = 4;
  const FINGER_JUMP_SAMPLES = 200;
  const FINGER_JUMP_EPS_MM = 0.25;
  /** The arc-length of the point on the opposite half (by world y, split at
   *  the tool's own placed bounding-box midline) from `arcMm`'s point, whose
   *  world x is closest to it — "where the hole would go if flipped to the
   *  other side," unconditionally. Null only for a degenerate (near-zero-
   *  length) ring. Shared by `jumpFingerHoleArc` (Up/Down nudge, gated on
   *  already being on the requested side) and turning span on (always
   *  applied, to seed the second focal point opposite the first). */
  function arcOnOppositeSide(tool: CombineTool, arcMm: number): number | null {
    const ring = tool.stamp;
    const len = ringLength(ring);
    if (len < 1e-6) return null;
    const placedRing = placed(ring, tool.tx, tool.ty, tool.rot, tool.mirror_x, tool.mirror_y);
    const box = bboxOf(placedRing);
    const midY = (box.miny + box.maxy) / 2;
    const [curX, curY] = placedPoint(
      pointAtArcLength(ring, arcMm), tool.tx, tool.ty, tool.rot, tool.mirror_x, tool.mirror_y,
    );
    const currentlyTop = curY >= midY;

    let best: { arc: number; dist: number } | null = null;
    for (let i = 0; i <= FINGER_JUMP_SAMPLES; i++) {
      const arc = (i / FINGER_JUMP_SAMPLES) * len;
      const [wx, wy] = placedPoint(
        pointAtArcLength(ring, arc), tool.tx, tool.ty, tool.rot, tool.mirror_x, tool.mirror_y,
      );
      const onTargetSide = currentlyTop ? wy <= midY : wy >= midY;
      if (!onTargetSide) continue;
      const dist = Math.abs(wx - curX);
      if (best === null || dist < best.dist) best = { arc, dist };
    }
    return best ? best.arc : null;
  }
  /** The arc-length to jump a finger hole to when nudging "up"/"down". Null
   *  if the hole is already on the requested side (no-op) or the ring is
   *  degenerate. */
  function jumpFingerHoleArc(tool: CombineTool, direction: "up" | "down"): number | null {
    const ring = tool.stamp;
    const len = ringLength(ring);
    if (len < 1e-6) return null;
    const placedRing = placed(ring, tool.tx, tool.ty, tool.rot, tool.mirror_x, tool.mirror_y);
    const box = bboxOf(placedRing);
    const midY = (box.miny + box.maxy) / 2;
    const [, curY] = placedPoint(
      pointAtArcLength(ring, tool.finger_hole_arc_mm), tool.tx, tool.ty, tool.rot, tool.mirror_x, tool.mirror_y,
    );
    const currentlyTop = curY >= midY - FINGER_JUMP_EPS_MM;
    const currentlyBottom = curY <= midY + FINGER_JUMP_EPS_MM;
    if (direction === "up" && currentlyTop) return null;
    if (direction === "down" && currentlyBottom) return null;
    return arcOnOppositeSide(tool, tool.finger_hole_arc_mm);
  }
  /** The local-frame direction of the ring segment containing (already-
   *  wrapped) `arcMm` — the ring is piecewise-linear, so this is the exact
   *  tangent there, not an approximation. Mirrors `pointAtArcLength`'s own
   *  segment walk so the two agree on which segment "contains" a boundary
   *  arc length. */
  function segmentDirectionAtArc(ring: Pt[], arcMm: number): Pt {
    if (ring.length < 2) return [1, 0];
    let remaining = arcMm;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      const segLen = Math.hypot(x1 - x0, y1 - y0);
      if (segLen <= 1e-12) continue;
      if (remaining <= segLen) return [x1 - x0, y1 - y0];
      remaining -= segLen;
    }
    return [1, 0];
  }
  /** Whether *increasing* local arc-length at `arcMm` moves the placed point
   *  toward world +x (screen right) — the ring's own tangent there, carried
   *  through the tool's current mirror/rotation. Left/Right nudging uses
   *  this to flip the arc-length step's sign as needed, so ArrowLeft/
   *  ArrowRight always mean "toward screen left/right," not "toward this
   *  tool's own increasing/decreasing local arc parametrization" — which
   *  would otherwise visually rotate along with the tool. */
  function arcIncreasesWorldX(tool: CombineTool, arcMm: number): boolean {
    const [dx, dy] = segmentDirectionAtArc(tool.stamp, wrapArcLength(tool.stamp, arcMm));
    const lx = tool.mirror_x ? -dx : dx, ly = tool.mirror_y ? -dy : dy;
    const rad = (tool.rot * Math.PI) / 180;
    return lx * Math.cos(rad) - ly * Math.sin(rad) >= 0;
  }
  function rotate(deg: number) {
    if (!selectedTool) return;
    pushSnapshotCoalesced(`rotate:${selectedTool.id}`);
    const id = selectedTool.id;
    setTools((ts) => ts.map((t) => (t.id === id ? { ...t, rot: t.rot + deg } : t)));
  }
  /** Align every selected tool to a common edge/center of the selection's own
   *  bounding boxes (each tool's placed `stamp` outline, not its finger-hole
   *  scallop). Horizontal alignment only ever changes tx; vertical only ty. */
  function alignSelected(edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
    if (selectedTools.length < 2) return;
    pushSnapshot();
    const boxes = new Map(selectedTools.map((t) => [t.id, bboxOf(placed(t.stamp, t.tx, t.ty, t.rot, t.mirror_x, t.mirror_y))]));
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
      // World y increases toward the top of the (now-correct) top-down
      // view, so "top" targets the max y, "bottom" the min.
      const target = edge === "top" ? Math.max(...all.map((b) => b.maxy))
        : edge === "bottom" ? Math.min(...all.map((b) => b.miny))
        : (Math.min(...all.map((b) => b.miny)) + Math.max(...all.map((b) => b.maxy))) / 2;
      setTools((ts) => ts.map((t) => {
        const b = boxes.get(t.id);
        if (!b) return t;
        const from = edge === "top" ? b.maxy : edge === "bottom" ? b.miny : (b.miny + b.maxy) / 2;
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
        const b = bboxOf(placed(t.stamp, t.tx, t.ty, t.rot, t.mirror_x, t.mirror_y));
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
    pushSnapshotCoalesced(`nudge:${selectionKey}`);
    setTools((ts) => ts.map((t) => (selectedIds.has(t.id) ? { ...t, tx: t.tx + dx, ty: t.ty + dy } : t)));
    // Only a single selected tool has an unambiguous "own center" to annotate
    // from — a multi-tool nudge shows no annotation at all.
    setNudgeAnnotationDir(selectedIds.size === 1 ? (dx !== 0 ? (dx > 0 ? "right" : "left") : (dy > 0 ? "up" : "down")) : null);
  }
  function handleArrangeKeyDown(e: React.KeyboardEvent) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
    if (selectedFingerHoleToolIds.size === 1) {
      handleFingerHoleKeyDown(e, [...selectedFingerHoleToolIds][0]);
      return;
    }
    if (selectedFingerHoleToolIds.size > 1) {
      handleFingerHoleKeyDownMulti(e, [...selectedFingerHoleToolIds]);
      return;
    }
    if (!selectedIds.size) return;
    const step = (Number(nudge) || 0.1) * (e.shiftKey ? 10 : 1);
    // World y increases toward the top of the (now-correct) top-down view —
    // see the <g transform> in the arrange SVG — so "up" nudges +y.
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const d = deltas[e.key];
    if (!d) return;
    e.preventDefault();
    nudgeSelected(d[0], d[1]);
  }
  /** Left/Right slide the hole along the ring by the same nudge step (and
   *  shift-10x) as tool nudging. Up/Down jump it "straight across" to the
   *  opposite side (see `jumpFingerHoleArc`) — a no-op if it's already
   *  there. Shift+Up/Shift+Down are explicit no-ops, not a bigger jump. */
  function handleFingerHoleKeyDown(e: React.KeyboardEvent, toolId: string) {
    const tool = tools.find((t) => t.id === toolId);
    if (!tool) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = (Number(nudge) || 0.1) * (e.shiftKey ? 10 : 1);
      const current = selectedFingerPointIndex === 1 ? tool.finger_hole_arc2_mm : tool.finger_hole_arc_mm;
      // Screen-relative, not tool-relative: flip the arc step's sign so
      // ArrowRight always moves the hole toward world +x here, regardless
      // of which way that maps onto the tool's own rotated arc direction.
      const wantsRight = e.key === "ArrowRight";
      const arcGoesRight = arcIncreasesWorldX(tool, current);
      const delta = (arcGoesRight === wantsRight) ? step : -step;
      pushSnapshotCoalesced(`fingerArc:${tool.id}:${selectedFingerPointIndex}`);
      commitFingerHoleArc(tool.id, current + delta, selectedFingerPointIndex);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (e.shiftKey || tool.finger_hole_span) return;
      const target = jumpFingerHoleArc(tool, e.key === "ArrowUp" ? "up" : "down");
      if (target === null) return;
      pushSnapshot();
      commitFingerHoleArc(tool.id, target);
    }
  }
  /** Left/Right (+ Shift ×10) across a finger-hole multi-selection — the
   *  only finger-hole action that supports multi-select (see
   *  handleFingerHoleKeyDown's single-select version for Up/Down/etc, which
   *  stay single-hole-only). Up/Down are an explicit no-op here: there's no
   *  per-tool "active point" once more than one hole is selected. Unlike
   *  the single-select case (which nudges only the active P1/P2), this
   *  moves *both* focal points of a span hole — nudging a multi-selection
   *  reads as "move the whole hole," not "move whichever lobe I happened to
   *  click last." */
  function handleFingerHoleKeyDownMulti(e: React.KeyboardEvent, toolIds: string[]) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = (Number(nudge) || 0.1) * (e.shiftKey ? 10 : 1);
    const wantsRight = e.key === "ArrowRight";
    const sortedIds = [...toolIds].sort();
    pushSnapshotCoalesced(`fingerArcBulk:${sortedIds.join(",")}`);
    for (const id of sortedIds) {
      const tool = tools.find((t) => t.id === id);
      if (!tool) continue;
      const arcGoesRight1 = arcIncreasesWorldX(tool, tool.finger_hole_arc_mm);
      const delta1 = (arcGoesRight1 === wantsRight) ? step : -step;
      commitFingerHoleArc(tool.id, tool.finger_hole_arc_mm + delta1, 0);
      if (tool.finger_hole_span) {
        const arcGoesRight2 = arcIncreasesWorldX(tool, tool.finger_hole_arc2_mm);
        const delta2 = (arcGoesRight2 === wantsRight) ? step : -step;
        commitFingerHoleArc(tool.id, tool.finger_hole_arc2_mm + delta2, 1);
      }
    }
  }
  function setRotation(deg: number) {
    if (!selectedTool || !Number.isFinite(deg)) return;
    pushSnapshotCoalesced(`rotate:${selectedTool.id}`);
    const id = selectedTool.id;
    setTools((ts) => ts.map((t) => (t.id === id ? { ...t, rot: deg } : t)));
  }

  /** Flip the selected tool's own outline across its local horizontal or
   *  vertical axis — a genuinely different transform from rotation (it
   *  reverses handedness, which no `rot` value can), so it's a pair of
   *  independent booleans rather than folded into `rot`. Only meaningful
   *  for a single selected tool — never shown during multi-select. */
  function toggleMirror(axis: "x" | "y") {
    if (!selectedTool) return;
    pushSnapshot();
    const id = selectedTool.id;
    setTools((ts) => ts.map((t) => (t.id === id
      ? axis === "x" ? { ...t, mirror_x: !t.mirror_x } : { ...t, mirror_y: !t.mirror_y }
      : t)));
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

  /** Snap every selected finger hole (selectedFingerHoleTools, not the tool
   *  multi-select) onto the bottom-most one's world X (or, for a left/right
   *  group, the left-most one's world Y) — see `computeFingerAlignPlan` for
   *  the eligibility rules. Each tool gets its own new arc-length position;
   *  local state updates immediately, same as a drag. */
  function alignFingerHoles() {
    if (!fingerAlignPlan) return;
    pushSnapshot();
    for (const [id, update] of fingerAlignPlan.updates) {
      if (update.arc1 !== undefined) commitFingerHoleArc(id, update.arc1, 0);
      if (update.arc2 !== undefined) commitFingerHoleArc(id, update.arc2, 1);
    }
  }
  /** The "base" tool for Copy style: the bottom-most **tool-multi-selected**
   *  (selectedTools, deliberately not the finger-hole multi-selection Align
   *  uses) tool by its own placed bounding box — not its hole's position,
   *  which might not exist — so the pick stays defined even when some/all
   *  selected tools have no finger hole yet. Copy style's whole point is to
   *  work in exactly that case (turning a hole on for a tool that has none),
   *  which is exactly what the finger-hole selection model can't represent —
   *  a hole-less tool has no circle to click — so Copy style keeps the old
   *  tool-selection gating rather than moving to Align's new one. */
  function copyStyleBaseTool(): CombineTool | null {
    if (selectedTools.length < 2) return null;
    return selectedTools.reduce((best, t) => {
      const tMinY = bboxOf(placed(t.stamp, t.tx, t.ty, t.rot, t.mirror_x, t.mirror_y)).miny;
      const bestMinY = bboxOf(placed(best.stamp, best.tx, best.ty, best.rot, best.mirror_x, best.mirror_y)).miny;
      return tMinY < bestMinY ? t : best;
    });
  }
  /** Copy the base tool's finger-hole *style* — on/off, span, diameter — onto
   *  every other selected tool, without moving any existing point (that's
   *  what [[alignFingerHoles]] is for). A tool with no hole yet that gains
   *  one gets its own auto-placed point from the server, exactly as if its
   *  own "Finger access" toggle had just been switched on — copy style
   *  never copies the base's *position*. If the base has no hole, every
   *  other selected tool's hole is turned off. */
  async function copyFingerHoleStyle() {
    const base = copyStyleBaseTool();
    if (!base) return;
    const targetIds = new Set(selectedTools.filter((t) => t.id !== base.id).map((t) => t.id));
    if (!targetIds.size) return;
    pushSnapshot();
    const wantsHole = base.finger_hole;
    const wantsSpan = base.finger_hole_span;
    const diameter = base.finger_holes[0]?.[2] ?? 20;
    const updated = tools.map((t) => {
      if (!targetIds.has(t.id)) return t;
      const gainingFresh = wantsHole && !t.finger_hole;
      return {
        ...t,
        finger: wantsHole,
        finger_hole: wantsHole,
        finger_hole_override: wantsHole,
        ...(wantsHole ? { finger_hole_diameter_mm_override: diameter } : {}),
        // A tool losing its hole no longer needs a placed point; a tool
        // gaining one fresh must NOT inherit any stale prior position —
        // both let the server's own auto/legacy placement resolve it next
        // time the hole is turned back on, same as a from-scratch toggle.
        ...(gainingFresh || !wantsHole ? { finger_hole_arc_mm_override: null } : {}),
      };
    });
    const refreshed = await load(placementsFor(updated), overridesFor(updated));
    if (!wantsHole || !refreshed) return;
    // Span needs each target's own (possibly just-resolved) P1 to seed P2
    // from — apply it now that `refreshed` reflects the server round-trip
    // above, not from the pre-round-trip `tools` closure.
    for (const t of refreshed) {
      if (targetIds.has(t.id) && t.finger_hole_span !== wantsSpan) spanFingerHole(t.id, wantsSpan);
    }
  }

  async function exportBin() {
    setBusy(true);
    setErr(null);
    try {
      const force = forceSize && forceGx && forceGy;
      await combineLibrary(toolIds, {
        placements: placementsFor(tools),
        overallHeight,
        lip,
        overrides: overridesFor(tools),
        fillHeightPct, liveGrid,
        magnetHoles,
        magnetHoleDiameterMm: Number(magnetHoleDiameter),
        magnetHoleDepthMm: Number(magnetHoleDepth),
        forceGx: force ? Number(forceGx) : null,
        forceGy: force ? Number(forceGy) : null,
        removedCells: effectiveRemovedCells(fillHeightPct),
        ...structural,
      }, binExportName(savedLabel, tools.map((t) => t.label)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Returns whether it succeeded — the caller keeps the slice dialog open
   *  on failure so `sliceErr` (rendered inside it) stays visible instead of
   *  vanishing along with the dialog. */
  async function exportSlice(thicknessMm: number): Promise<boolean> {
    setBusy(true);
    setSliceErr(null);
    try {
      const force = forceSize && forceGx && forceGy;
      await combineLibrarySlice(toolIds, {
        placements: placementsFor(tools),
        overallHeight,
        lip,
        overrides: overridesFor(tools),
        fillHeightPct, liveGrid,
        magnetHoles,
        magnetHoleDiameterMm: Number(magnetHoleDiameter),
        magnetHoleDepthMm: Number(magnetHoleDepth),
        sliceThicknessMm: thicknessMm,
        forceGx: force ? Number(forceGx) : null,
        forceGy: force ? Number(forceGy) : null,
        removedCells: effectiveRemovedCells(fillHeightPct),
        ...structural,
      }, binExportName(savedLabel, tools.map((t) => t.label)));
      return true;
    } catch (e) {
      setSliceErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** "⧉ Duplicate": a second, independently-editable copy of the single
   *  selected tool's geometry within this bin (own rotation, own finger-hole/
   *  clearance overrides — the existing per-id override/placement model
   *  already supports that, since the copy gets its own id). Forks
   *  immediately via the bin-tools store (gridshot/core/bintools.py), not
   *  deferred to Save — so it previews and undoes like any other tool. */
  async function duplicateSelectedTool() {
    if (!selectedTool) return;
    setDuplicateBusy(true);
    setDuplicateErr(null);
    try {
      const duplicated = await duplicateTool(selectedTool.id);
      pushSnapshot();
      const nextIds = [...toolIds, duplicated.id];
      setToolIds(nextIds);
      await load(placementsFor(tools), overridesFor(tools), fillHeightPct, undefined, undefined, lip, structural, magnetHoles, magnetHoleDiameter, magnetHoleDepth, nextIds);
      setSelectedIds(new Set([duplicated.id]));
    } catch (e) {
      setDuplicateErr((e as Error).message);
    } finally {
      setDuplicateBusy(false);
    }
  }

  /** "Rounded Rectangle" toolshape palette control — enters placement mode
   *  with defaults the panel can edit before a click on the canvas commits
   *  them (see the arrange <svg>'s onPointerDown/onPointerMove below). */
  function startPlacingToolshape() {
    setSelectedIds(new Set());
    setPlaceToolshapeErr(null);
    setPlacingToolshape({ ...DEFAULT_ROUNDED_RECT_TOOLSHAPE });
  }

  function cancelPlacingToolshape() {
    setPlacingToolshape(null);
    setGhostPos(null);
  }

  /** Creates the toolshape bin-tool, then places it at the exact clicked
   *  point (an explicit `Placement`, not auto-pack) the same way ⧉ Duplicate
   *  appends a freshly-forked id and reloads with it — see `load`'s
   *  `idsOverride` param. */
  async function placeToolshapeAt(tx: number, ty: number) {
    if (!placingToolshape) return;
    setPlaceToolshapeBusy(true);
    setPlaceToolshapeErr(null);
    try {
      const created = await createToolshape(placingToolshape);
      pushSnapshot();
      const nextIds = [...toolIds, created.id];
      setToolIds(nextIds);
      const placements: Placement[] = [
        ...placementsFor(tools),
        { id: created.id, tx, ty, rot: 0, mirror_x: false, mirror_y: false },
      ];
      await load(placements, overridesFor(tools), fillHeightPct, undefined, undefined, lip, structural, magnetHoles, magnetHoleDiameter, magnetHoleDepth, nextIds);
      setSelectedIds(new Set([created.id]));
      setPlacingToolshape(null);
      setGhostPos(null);
    } catch (e) {
      setPlaceToolshapeErr((e as Error).message);
    } finally {
      setPlaceToolshapeBusy(false);
    }
  }

  /** Editing a placed toolshape's own width/length/radius/fillet — unlike
   *  clearance/depth/finger-hole, these change the tool's actual outline, so
   *  (unlike those) there's no local-override shortcut: patch the bin-tool
   *  record first (regenerating its outline server-side), then reload the
   *  combine layout to pick up the new stamp/pockets. */
  async function updateSelectedToolshape(patch: Partial<RoundedRectToolshapeParams>) {
    if (!selectedTool || !selectedTool.toolshape_type) {
      setToolshapeResizeLive(null);
      return;
    }
    setToolshapeUpdateBusy(true);
    setToolshapeUpdateErr(null);
    try {
      pushSnapshot();
      await updateToolshape(selectedTool.id, patch);
      await load(
        placementsFor(tools), overridesFor(tools), undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        true,
      );
    } catch (e) {
      setToolshapeUpdateErr((e as Error).message);
    } finally {
      setToolshapeUpdateBusy(false);
      // Cleared here (not at drag-end) so a resized toolshape's finger hole
      // stays hidden through the round-trip above and reappears already at
      // its correct new spot, instead of flashing at the stale one first.
      setToolshapeResizeLive(null);
    }
  }

  /** Convert a typed "usable height" (the depth below the 100% fill line —
   *  what's left after base, floor, and any lip) into the equivalent
   *  overall_height_mm, using the server's own base_h_mm/floor_thickness_mm/
   *  lip_height_mm from the last preview — never duplicated as constants
   *  client-side, since their effective values depend on Bin Profile
   *  overrides this component doesn't otherwise resolve itself. */
  function setUsableHeight(raw: string) {
    if (!meta) return;
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (overallHeight === null) return;
      pushSnapshot();
      setOverallHeight(null);
      void load(
        placementsFor(tools), overridesFor(tools), undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, null,
      );
      return;
    }
    const usableMm = Number(trimmed);
    if (!Number.isFinite(usableMm) || usableMm <= 0) return;
    const nextOverall = usableMm + meta.base_h_mm + meta.floor_thickness_mm + (lip ? meta.lip_height_mm : 0);
    pushSnapshot();
    setOverallHeight(nextOverall);
    void load(
      placementsFor(tools), overridesFor(tools), undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, nextOverall,
    );
  }

  function saveOptions(toolsOverride: CombineTool[] = tools) {
    const force = forceSize && forceGx && forceGy;
    return {
      placements: placementsFor(toolsOverride),
      overrides: overridesFor(toolsOverride),
      overallHeight,
      lip,
      fillHeightPct, liveGrid,
      magnetHoles,
      magnetHoleDiameterMm: Number(magnetHoleDiameter),
      magnetHoleDepthMm: Number(magnetHoleDepth),
      forceGx: force ? Number(forceGx) : null,
      forceGy: force ? Number(forceGy) : null,
      removedCells: effectiveRemovedCells(fillHeightPct),
      appliedProfileId,
      ...structural,
    };
  }

  /** Adopts a just-saved bin's (possibly just-forked) ids into local state.
   *  Saving can fork every tool id (see `_build_saved_bin` in app.py), so
   *  `toolIds` alone isn't enough to update — `tools`, `selectedIds`, and
   *  `lockedRotations` all key off the *old* ids too. Reloading with the
   *  server's own `placements`/`overrides` (rather than remapping this
   *  client's `tools` positionally) keeps this correct even if the server
   *  dropped a tool id along the way. Selection/locked-rotation state is
   *  remapped old→new only when the id count matches 1:1; otherwise it's
   *  safer to just clear it than to guess a mapping.
   *
   *  Note: undoing back past this Save restores the pre-fork raw ids from
   *  that snapshot (see `applySnapshot` below) — a later Save from there
   *  re-forks fresh copies and orphans the ones minted here. Harmless (just
   *  disk usage `gridshot bin-tools gc` reclaims), not worth guarding against. */
  async function adoptSavedBinIds(saved: SavedBin) {
    const oldIds = toolIds;
    const remap = oldIds.length === saved.tool_ids.length
      ? new Map(oldIds.map((id, i) => [id, saved.tool_ids[i]]))
      : null;
    setSelectedIds((current) => (
      remap ? new Set([...current].map((id) => remap.get(id) ?? id)) : new Set()
    ));
    setLockedRotations((current) => (
      remap ? new Set([...current].map((id) => remap.get(id) ?? id)) : new Set()
    ));
    setToolIds(saved.tool_ids);
    await load(
      saved.placements, saved.overrides, fillHeightPct, undefined, undefined,
      lip, structural, magnetHoles, magnetHoleDiameter, magnetHoleDepth,
      saved.tool_ids, liveGrid,
    );
  }

  /** "Save As": always creates a new Bin Library entry, even when reopened
   *  from an existing one — the dialog's Name field. Once it succeeds, this
   *  editor is now "attached" to the new entry, so a later plain Save
   *  overwrites *that* one, not the one this session started from. */
  async function saveToBinLibrary() {
    setSaveBusy(true);
    setSaveErr(null);
    try {
      const label = saveName.trim() || defaultBinName();
      const saved = await saveBin(label, toolIds, saveOptions());
      setSavedBinId(saved.id);
      setSavedLabel(label);
      await adoptSavedBinIds(saved);
      setSaveDialogOpen(false);
      setSaveDone(true);
      window.setTimeout(() => setSaveDone(false), 3000);
      onSaved?.(saved);
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaveBusy(false);
    }
  }

  /** Mints this fresh combine's own Bin Library entry immediately at mount —
   *  every new session (never a reopened one; see the mount effect below)
   *  always has its own bin-tool copies from the start, rather than only
   *  forking on an explicit first Save. `freshTools` is the auto-pack's own
   *  result, passed explicitly rather than read off the `tools` closure —
   *  this runs inside that same `load()`'s `.then()`, before React has
   *  re-rendered with the auto-pack's `setTools`, so the closure's `tools`
   *  is still the pre-auto-pack `[]`. */
  async function mintInitialSave(freshTools: CombineTool[]) {
    try {
      const label = defaultBinName();
      const saved = await saveBin(label, toolIds, saveOptions(freshTools));
      setSavedBinId(saved.id);
      setSavedLabel(label);
      await adoptSavedBinIds(saved);
    } catch (e) {
      setSaveErr((e as Error).message);
    }
  }

  /** Persists the current recipe to the bin this session is already attached
   *  to (`savedBinId`) — called from the debounced autosave effect below, and
   *  flushed immediately on Close if one is still pending. Never re-forks or
   *  reloads: once `toolIds` are bin-tool ids, the server's own fork step is
   *  a no-op, so nothing about local state could change from this response. */
  async function autoSave() {
    if (!savedBinId) return;
    try {
      await overwriteBin(savedBinId, savedLabel ?? defaultBinName(), toolIds, saveOptions());
      setSaveDone(true);
      window.setTimeout(() => setSaveDone(false), 3000);
    } catch (e) {
      setSaveErr((e as Error).message);
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
    selectedFingerHoleTools
      .filter((t) => t.finger_hole)
      .flatMap((t): FingerAlignCandidate[] => {
        const p1 = layout.fingerCircles.find((h) => h.toolId === t.id && h.pointIndex === 0);
        if (!p1) return [];
        const p2 = layout.fingerCircles.find((h) => h.toolId === t.id && h.pointIndex === 1);
        return [{
          id: t.id,
          rot: t.rot, mirrorX: t.mirror_x, mirrorY: t.mirror_y,
          p1: { cx: p1.cx, cy: p1.cy, ring: t.stamp, arcMm: t.finger_hole_arc_mm },
          ...(p2 ? { p2: { cx: p2.cx, cy: p2.cy, ring: t.stamp, arcMm: t.finger_hole_arc2_mm } } : {}),
        }];
      }),
  ) : null;
  const selectedFingerHoleTool = selectedFingerHoleTools.length === 1 ? selectedFingerHoleTools[0] : null;
  const selectedFingerHoleWorld = selectedFingerHoleTool && layout
    ? layout.fingerCircles.find((h) => h.toolId === selectedFingerHoleTool.id) ?? null
    : null;
  // "Lower-left corner of the overall grid is (0,0)" — layout.ow/od already
  // reflect the full gx*gy footprint before any custom-shape cell removal
  // (see the layout memo above), so the bin rect's own bottom-left corner
  // (cx - ow/2, cy - od/2) is exactly that origin.
  const fingerHoleReadout = selectedFingerHoleWorld && layout ? {
    x: selectedFingerHoleWorld.cx - (layout.cx - layout.ow / 2),
    y: selectedFingerHoleWorld.cy - (layout.cy - layout.od / 2),
  } : null;
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
  // The content group mirrors y for display (see the <g transform> above),
  // so the viewBox's own y origin must track the mirrored range too: world
  // y's max becomes the smallest (topmost) SVG-space y.
  const vb = layout
    ? `${layout.viewCx - layout.viewW / 2 - m} ${-(layout.viewCy + layout.viewH / 2) - m} ${layout.viewW + 2 * m} ${layout.viewH + 2 * m}`
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
      <div className="grp-label mb-1">Arrange multi-tool bin</div>
      <input
        aria-label="Bin name"
        className="mb-2 block w-full min-w-0 bg-transparent border-b border-line font-mono text-lg text-knockout py-1 outline-none placeholder:text-muted disabled:opacity-50"
        defaultValue={savedLabel ?? ""}
        placeholder={defaultBinName()}
        disabled={!savedBinId}
        key={`${savedBinId ?? "pending"}-${savedLabel ?? ""}`}
        ref={commitOnChange((raw) => {
          const next = raw.trim() || defaultBinName();
          if (next !== (savedLabel ?? "")) setSavedLabel(next);
        })}
      />
      <div className="grp-label mb-2 flex flex-wrap justify-between gap-2">
        <span className="flex items-center gap-2">
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
            {layout.gx}×{layout.gy}u{layout.locked ? " (locked)" : ""} · {meta!.overall_height_mm}mm tall · fill {fillHeightPct}%
            {liveGrid ? ` · ${meta!.available_cells.length} live sockets` : ""}
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
          {view === "arrange" && (
            <div className="mb-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase text-muted">Toolshapes</span>
                <button
                  type="button"
                  className={`btn text-[10px] !px-2 !py-1 ${placingToolshape ? "btn-primary" : "btn-ghost"}`}
                  title="A parametric outline with no source tool — placed by clicking the grid"
                  onClick={() => (placingToolshape ? cancelPlacingToolshape() : startPlacingToolshape())}
                >
                  ▢ Rounded Rectangle
                </button>
                {placingToolshape && (
                  <span className="font-mono text-[10px] text-muted">
                    {placeToolshapeBusy ? "Placing…" : "Click the grid to place · Esc to cancel"}
                  </span>
                )}
              </div>
              {placingToolshape && (
                <div className="mt-2 border border-line bg-field p-2 font-mono text-[10px]" style={{ borderRadius: 2 }}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="block">
                      <span className="text-muted">Width (mm)</span>
                      <input
                        aria-label="New toolshape width in millimetres"
                        className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
                        type="number" min={1} step={0.5}
                        value={placingToolshape.width_mm}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setPlacingToolshape((p) => p && { ...p, width_mm: v });
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="text-muted">Length (mm)</span>
                      <input
                        aria-label="New toolshape length in millimetres"
                        className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
                        type="number" min={1} step={0.5}
                        value={placingToolshape.length_mm}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setPlacingToolshape((p) => p && { ...p, length_mm: v });
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="text-muted">Radius (mm)</span>
                      <input
                        aria-label="New toolshape corner radius in millimetres"
                        className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
                        type="number" min={0} step={0.1}
                        value={placingToolshape.radius_mm}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setPlacingToolshape((p) => p && { ...p, radius_mm: v });
                        }}
                      />
                    </label>
                    <label className="flex items-end gap-2 pb-1">
                      <input
                        type="checkbox"
                        checked={placingToolshape.fillet_bottom}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setPlacingToolshape((p) => p && { ...p, fillet_bottom: checked });
                        }}
                      />
                      <span className="text-muted">Fillet bottom</span>
                    </label>
                  </div>
                  {placeToolshapeErr && <p className="mt-1 text-orange">{placeToolshapeErr}</p>}
                  <button
                    type="button"
                    className="btn btn-ghost mt-2 w-full !py-1 text-[10px]"
                    onClick={cancelPlacingToolshape}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
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
            style={{ minHeight: 360, maxHeight: "68vh", cursor: placingToolshape ? "crosshair" : drag.current ? "grabbing" : "default" }}
            preserveAspectRatio="xMidYMid meet"
            onPointerMove={(e) => {
              if (placingToolshape) { setGhostPos(toData(e)); return; }
              move(e); moveFingerHole(e); moveToolshapeResize(e);
            }}
            onPointerUp={() => {
              const d = drag.current;
              if (d && d.clickNarrowsTo && !d.moved) setSelectedIds(new Set([d.clickNarrowsTo]));
              drag.current = null;
              fingerDrag.current = null;
              const tr = toolshapeResizeDrag.current;
              toolshapeResizeDrag.current = null;
              if (tr && tr.moved) {
                void updateSelectedToolshape(tr.axis === "width" ? { width_mm: tr.valueMm } : { length_mm: tr.valueMm });
              } else if (tr) {
                setToolshapeResizeLive(null);
              }
            }}
            onPointerDown={(e) => {
              if (placingToolshape) {
                const [tx, ty] = toData(e);
                void placeToolshapeAt(tx, ty);
                return;
              }
              setSelectedIds(new Set()); setSelectedFingerHoleToolIds(new Set()); setSelectedFingerPointIndex(0);
            }}
          >
            {layout && (
              // World y increases toward the back of the bin (standard
              // top-down/CAD convention, matching the 3D preview and the
              // exported STL/3MF) — SVG's own y axis increases downward, so
              // this group mirrors y once for display only. Every world
              // coordinate below (bin outline, grid lines, removed cells,
              // sockets, finger circles, tool polygons) is left as raw world
              // mm; toData() undoes the same mirror on the way back in for
              // pointer/drag handling.
              <g transform="scale(1,-1)">
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
                {liveGrid && meta!.available_cells.map(([cellX, cellY]) => {
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
                {/* cleared pockets — turn red once locked and past the locked footprint;
                    hovering an unselected tool shades it to hint it's clickable */}
                {tools.map((t, i) => {
                  const toolColor = layout.overflowIds.has(t.id) ? OVERFLOW_COLOR : color(i);
                  const isSelected = selectedIds.has(t.id);
                  const isHovered = hoverId === t.id && !isSelected;
                  // Mid-resize, draw a client-side approximation of the new
                  // outline (same one placement-mode's ghost preview uses)
                  // instead of the stale server-computed polygon, so the
                  // shape visibly tracks the drag before the round-trip lands.
                  const resizing = toolshapeResizeLive?.toolId === t.id;
                  const points = resizing
                    ? placed(
                        roundedRectPreviewPoints(
                          toolshapeResizeLive!.axis === "width" ? toolshapeResizeLive!.valueMm : (t.toolshape_width_mm ?? 0),
                          toolshapeResizeLive!.axis === "length" ? toolshapeResizeLive!.valueMm : (t.toolshape_length_mm ?? 0),
                          t.toolshape_radius_mm ?? 0,
                        ),
                        t.tx, t.ty, t.rot, t.mirror_x, t.mirror_y,
                      )
                    : layout.polys[i];
                  return <polygon
                    key={t.id}
                    points={points.map((p) => `${p[0]},${p[1]}`).join(" ")}
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
                {/* Edge-drag-resize handles for the selected rounded-rectangle
                    toolshape only — invisible (transparent stroke) hit-lines
                    along each straight edge, cursor-only affordance. Selecting
                    a finger hole instead always clears the tool selection (see
                    downFingerHole), so these disappear on their own the moment
                    a finger hole takes over.

                    vectorEffect="non-scaling-stroke" keeps the hit width a
                    constant number of *screen* pixels regardless of the
                    viewBox's current world-to-pixel scale (which varies with
                    bin size/zoom) — a fixed mm-wide strip would otherwise
                    shrink to a couple of screen pixels on a larger bin,
                    making the outline effectively impossible to hover: the
                    tool polygon's own "grab" cursor wins almost everywhere
                    nearby instead. */}
                {selectedTool?.toolshape_type === "rounded_rect" && (() => {
                  const t = selectedTool;
                  const resizing = toolshapeResizeLive?.toolId === t.id;
                  const liveWidth = resizing && toolshapeResizeLive!.axis === "width"
                    ? toolshapeResizeLive!.valueMm : (t.toolshape_width_mm ?? 0);
                  const liveLength = resizing && toolshapeResizeLive!.axis === "length"
                    ? toolshapeResizeLive!.valueMm : (t.toolshape_length_mm ?? 0);
                  const hw = liveWidth / 2, hl = liveLength / 2;
                  const edges: { axis: "width" | "length"; testid: string; a: Pt; b: Pt; normal: Pt }[] = [
                    { axis: "width", testid: "toolshape-resize-right", a: [hw, -hl], b: [hw, hl], normal: [1, 0] },
                    { axis: "width", testid: "toolshape-resize-left", a: [-hw, -hl], b: [-hw, hl], normal: [-1, 0] },
                    { axis: "length", testid: "toolshape-resize-top", a: [-hw, hl], b: [hw, hl], normal: [0, 1] },
                    { axis: "length", testid: "toolshape-resize-bottom", a: [-hw, -hl], b: [hw, -hl], normal: [0, -1] },
                  ];
                  return edges.map((edge) => {
                    const [x1, y1] = placedPoint(edge.a, t.tx, t.ty, t.rot, t.mirror_x, t.mirror_y);
                    const [x2, y2] = placedPoint(edge.b, t.tx, t.ty, t.rot, t.mirror_x, t.mirror_y);
                    return <line
                      key={edge.testid}
                      data-testid={edge.testid}
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke="transparent"
                      strokeWidth={TOOLSHAPE_RESIZE_HIT_PX}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: resizeCursorFor(edge.normal, t) }}
                      onPointerDown={(e) => downToolshapeResize(t, edge.axis, e)}
                    />;
                  });
                })()}
                {/* finger-access scallops are part of the exact cut envelope —
                    rendered after (on top of) the tool polygons so a click
                    lands on the hole, not the pocket fill beneath it */}
                {layout.fingerConnectors.filter((conn) => toolshapeResizeLive?.toolId !== conn.toolId).map((conn) => {
                  const toolIndex = tools.findIndex((tool) => tool.id === conn.toolId);
                  const connColor = layout.overflowIds.has(conn.toolId) ? OVERFLOW_COLOR : color(toolIndex);
                  const isSelected = selectedFingerHoleToolIds.has(conn.toolId);
                  return <line
                    key={`${conn.toolId}-finger-connector`}
                    x1={conn.x1} y1={conn.y1} x2={conn.x2} y2={conn.y2}
                    stroke={connColor + (isSelected ? "55" : "2f")}
                    strokeWidth={conn.diameter}
                    strokeLinecap="round"
                  />;
                })}
                {layout.fingerCircles.filter((hole) => toolshapeResizeLive?.toolId !== hole.toolId).map((hole, index) => {
                  const toolIndex = tools.findIndex((tool) => tool.id === hole.toolId);
                  const holeColor = layout.overflowIds.has(hole.toolId) ? OVERFLOW_COLOR : color(toolIndex);
                  const holeSelected = selectedFingerHoleToolIds.has(hole.toolId);
                  const isActive = holeSelected && selectedFingerHoleToolIds.size === 1 && selectedFingerPointIndex === hole.pointIndex;
                  const isSpan = tools.find((t) => t.id === hole.toolId)?.finger_hole_span ?? false;
                  const isHinted = hoveredFingerPoint?.toolId === hole.toolId && hoveredFingerPoint.pointIndex === hole.pointIndex;
                  return <g key={`${hole.toolId}-finger-${index}`}>
                    {isSpan && (
                      <circle
                        cx={hole.cx} cy={hole.cy} r={hole.radius + FINGER_SELECT_SLOP_MM}
                        fill="transparent"
                        style={{ cursor: "pointer" }}
                        onPointerDown={(e) => downFingerHole(hole.toolId, hole.pointIndex, e)}
                        onPointerEnter={() => !isActive && setHoveredFingerPoint({ toolId: hole.toolId, pointIndex: hole.pointIndex })}
                        onPointerLeave={() => setHoveredFingerPoint((h) => (
                          h?.toolId === hole.toolId && h.pointIndex === hole.pointIndex ? null : h
                        ))}
                      />
                    )}
                    <circle
                      cx={hole.cx}
                      cy={hole.cy}
                      r={hole.radius}
                      fill={holeColor + (isActive ? "55" : holeSelected ? "40" : "2f")}
                      stroke={holeColor}
                      strokeWidth={isActive ? 1.4 : holeSelected ? 1 : 0.6}
                      strokeDasharray="2 1"
                      className={isActive ? "marching-ants" : undefined}
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => downFingerHole(hole.toolId, hole.pointIndex, e)}
                    />
                    {isHinted && !isActive && (
                      <circle
                        cx={hole.cx} cy={hole.cy} r={hole.radius + 1.5}
                        fill="none" stroke={holeColor} strokeWidth={0.8} strokeDasharray="1 1"
                      />
                    )}
                  </g>;
                })}
                {nudgeAnnotation && [nudgeAnnotation.toward, nudgeAnnotation.away].map((hit, i) => {
                  if (!hit) return null;
                  const [sx, sy] = hit.start;
                  const [ex, ey] = hit.end;
                  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
                  return (
                    <g key={i}>
                      <line
                        x1={sx} y1={sy} x2={ex} y2={ey} stroke="#2f8f95"
                        strokeWidth={nudgeAnnotation.bold ? 0.8 : 0.4}
                        strokeDasharray="1.5 1"
                      />
                      {/* Counter-flip: the parent group mirrors y for display,
                          which would otherwise draw this label upside down. */}
                      <g transform={`translate(${mx} ${my}) scale(1,-1)`}>
                        <text
                          x={0} y={-2} textAnchor="middle" fontSize={3} fill="#2f8f95"
                          fontWeight={nudgeAnnotation.bold ? "bold" : undefined}
                          style={{ fontFamily: "monospace" }}
                        >
                          {hit.distanceMm.toFixed(2)} mm
                        </text>
                      </g>
                    </g>
                  );
                })}
                {placingToolshape && ghostPos && (
                  <polygon
                    points={roundedRectPreviewPoints(
                      placingToolshape.width_mm, placingToolshape.length_mm, placingToolshape.radius_mm,
                    ).map(([x, y]) => `${x + ghostPos[0]},${y + ghostPos[1]}`).join(" ")}
                    fill="#9ec85055" stroke="#9ec850" strokeWidth={0.8} strokeDasharray="2 1.5"
                    pointerEvents="none"
                  />
                )}
              </g>
            )}
            </svg> : (
              <div className="relative h-[clamp(360px,62vh,620px)] w-full">
                {glbUrl && <BinViewer url={glbUrl} />}
                {!glbUrl && !previewMessage && (
                  <div className="absolute inset-0 grid place-items-center font-mono text-xs text-muted">
                    Building exact bin preview…
                  </div>
                )}
                {previewMessage && (
                  <div className="absolute inset-0 grid place-items-center p-6 text-center font-mono text-xs text-orange">
                    {previewMessage}
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
                applyProfile(profile);
              }}
            >
              <option value="" disabled>Apply a bin profile…</option>
              {binProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <label className="block">
            <span className="font-mono text-[10px] uppercase text-muted">Usable height (mm)</span>
            <input
              aria-label="Usable height in millimetres"
              className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
              type="number" step={1} min={0.1}
              placeholder="auto (per tool)"
              disabled={busy || !meta}
              defaultValue={meta ? String(meta.usable_height_mm) : ""}
              key={`${meta?.usable_height_mm ?? "pending"}-${overallHeight ?? "auto"}`}
              ref={commitOnChange((raw) => setUsableHeight(raw))}
            />
            <span className="font-mono text-[10px] text-muted">
              Depth below the 100% fill line — base + floor{lip ? " + lip" : ""} sit on top;
              blank = auto per tool
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={lip}
              disabled={busy}
              onChange={(e) => {
                pushSnapshot();
                const checked = e.target.checked;
                setLip(checked);
                void load(placementsFor(tools), overridesFor(tools), fillHeightPct, undefined, undefined, checked);
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
                    placementsFor(tools), overridesFor(tools), fillHeightPct,
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
                    onChange={(event) => { pushSnapshotCoalesced("forceGx"); setForceGx(event.target.value); }}
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
                    onChange={(event) => { pushSnapshotCoalesced("forceGy"); setForceGy(event.target.value); }}
                    ref={commitOnChange(() => void load(placementsFor(tools), overridesFor(tools)))}
                  />
                </label>
              </div>
            )}
            {forceSize && fillHeightPct === 100 && !liveGrid && allowCustomShape && (
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
                        void load(placementsFor(tools), overridesFor(tools), fillHeightPct, undefined, null);
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
                    onChange={(event) => { pushSnapshotCoalesced("magnetHoleDiameter"); setMagnetHoleDiameter(event.target.value); }}
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
                    onChange={(event) => { pushSnapshotCoalesced("magnetHoleDepth"); setMagnetHoleDepth(event.target.value); }}
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
          <div className="grid grid-cols-2 gap-1">
            <button
              className={`btn text-[10px] !px-1 !py-2 ${selectedTool?.mirror_x ? "btn-primary" : "btn-ghost"}`}
              disabled={!selectedTool}
              aria-pressed={selectedTool?.mirror_x ?? false}
              onClick={() => toggleMirror("x")}
            >
              ↔ Mirror horizontal
            </button>
            <button
              className={`btn text-[10px] !px-1 !py-2 ${selectedTool?.mirror_y ? "btn-primary" : "btn-ghost"}`}
              disabled={!selectedTool}
              aria-pressed={selectedTool?.mirror_y ?? false}
              onClick={() => toggleMirror("y")}
            >
              ↕ Mirror vertical
            </button>
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
              {selectedTool && (
                <div className="mb-2">
                  <button
                    type="button"
                    className="btn btn-ghost w-full !py-1 text-[10px]"
                    disabled={busy || duplicateBusy}
                    onClick={() => void duplicateSelectedTool()}
                  >
                    {duplicateBusy ? "Duplicating…" : "⧉ Duplicate"}
                  </button>
                  {duplicateErr && <p className="mt-1 text-orange">{duplicateErr}</p>}
                </div>
              )}
              {selectedTool?.toolshape_type === "rounded_rect" && (
                <div className="mb-2 border-b border-line pb-2">
                  <span className="font-mono text-[9px] uppercase text-muted">Rounded rectangle</span>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-muted">Width (mm)</span>
                      <input
                        aria-label="Toolshape width in millimetres"
                        className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
                        type="number" min={1} step={0.5}
                        disabled={busy || toolshapeUpdateBusy}
                        defaultValue={selectedTool.toolshape_width_mm ?? 0}
                        key={`${selectedTool.id}-tw-${selectedTool.toolshape_width_mm}`}
                        ref={commitOnChange((raw) => {
                          const value = Number(raw);
                          if (Number.isFinite(value) && value > 0 && value !== selectedTool.toolshape_width_mm) {
                            void updateSelectedToolshape({ width_mm: value });
                          }
                        })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-muted">Length (mm)</span>
                      <input
                        aria-label="Toolshape length in millimetres"
                        className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
                        type="number" min={1} step={0.5}
                        disabled={busy || toolshapeUpdateBusy}
                        defaultValue={selectedTool.toolshape_length_mm ?? 0}
                        key={`${selectedTool.id}-tl-${selectedTool.toolshape_length_mm}`}
                        ref={commitOnChange((raw) => {
                          const value = Number(raw);
                          if (Number.isFinite(value) && value > 0 && value !== selectedTool.toolshape_length_mm) {
                            void updateSelectedToolshape({ length_mm: value });
                          }
                        })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-muted">Radius (mm)</span>
                      <input
                        aria-label="Toolshape corner radius in millimetres"
                        className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
                        type="number" min={0} step={0.1}
                        disabled={busy || toolshapeUpdateBusy}
                        defaultValue={selectedTool.toolshape_radius_mm ?? 0}
                        key={`${selectedTool.id}-tr-${selectedTool.toolshape_radius_mm}`}
                        ref={commitOnChange((raw) => {
                          const value = Number(raw);
                          if (Number.isFinite(value) && value >= 0 && value !== selectedTool.toolshape_radius_mm) {
                            void updateSelectedToolshape({ radius_mm: value });
                          }
                        })}
                      />
                    </label>
                    <label className="flex items-end gap-2 pb-1">
                      <input
                        type="checkbox"
                        disabled={busy || toolshapeUpdateBusy}
                        checked={selectedTool.toolshape_fillet_bottom}
                        onChange={(e) => void updateSelectedToolshape({ fillet_bottom: e.target.checked })}
                      />
                      <span className="text-muted">Fillet bottom</span>
                    </label>
                  </div>
                  {toolshapeUpdateErr && <p className="mt-1 text-orange">{toolshapeUpdateErr}</p>}
                </div>
              )}
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-muted">
                <dt>{fillHeightPct === 100 ? "Pocket depth" : "Tool recess"}</dt>
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
                disabled={busy || selectedTools.length < 2}
                title="Copy the bottom-most selected tool's finger-hole style (on/off, span, diameter) onto every other selected tool — a tool with no hole yet gets its own auto-placed point, existing points never move"
                onClick={() => void copyFingerHoleStyle()}
              >
                ⎘ Copy style
              </button>
              {alignButtons}
              {distributeButtons}
            </div>
          ) : selectedFingerHoleToolIds.size > 0 ? (
            <div className="border border-line bg-field p-3 font-mono text-[10px]" style={{ borderRadius: 2 }}>
              {selectedFingerHoleTool ? (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-knockout">
                      {selectedFingerHoleTool.label || selectedFingerHoleTool.id.slice(0, 8)} — finger hole
                      {selectedFingerHoleTool.finger_hole_span && (
                        <span className="ml-1 text-muted">· P{selectedFingerPointIndex + 1}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] uppercase text-muted">Esc to clear</span>
                  </div>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-muted">
                    <dt>X</dt>
                    <dd className="text-right text-knockout">{fingerHoleReadout ? fingerHoleReadout.x.toFixed(2) : "–"} mm</dd>
                    <dt>Y</dt>
                    <dd className="text-right text-knockout">{fingerHoleReadout ? fingerHoleReadout.y.toFixed(2) : "–"} mm</dd>
                  </dl>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                    <span className="text-muted">Diameter</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <input
                        aria-label="Finger hole diameter in millimetres"
                        className="mono-input min-w-0 w-16 !px-2 !py-1 !text-sm"
                        type="number" step={1} min={0.1}
                        disabled={busy}
                        defaultValue={selectedFingerHoleTool.finger_holes[0]?.[2] ?? 20}
                        key={selectedFingerHoleTool.id}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value) && value > 0) {
                            setFingerHoleDiameter(selectedFingerHoleTool.id, value);
                          }
                        }}
                      />
                      <span className="text-muted">mm</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                    <span className="text-muted">Span both sides</span>
                    <button
                      aria-pressed={selectedFingerHoleTool.finger_hole_span}
                      className={`btn shrink-0 !px-3 !py-1 text-[10px] ${selectedFingerHoleTool.finger_hole_span ? "border-teal text-teal" : "btn-ghost text-knockout border-line"}`}
                      disabled={busy}
                      onClick={() => spanFingerHole(selectedFingerHoleTool.id, !selectedFingerHoleTool.finger_hole_span)}
                    >
                      {selectedFingerHoleTool.finger_hole_span ? "On" : "Off"}
                    </button>
                  </div>
                  <p className="mt-3 border-t border-line pt-3 text-muted">
                    {selectedFingerHoleTool.finger_hole_span ? (
                      <>
                        Drag the active point, or use Left/Right to slide it along the
                        outline (same nudge step and Shift ×10 as tools). Click near the
                        other lobe (or the hinted ring around it) to switch which point
                        moves. Up/Down is disabled while span is on.
                      </>
                    ) : (
                      <>
                        Drag the hole, or use the arrow keys — Left/Right slide it along the
                        outline (same nudge step and Shift ×10 as tools), Up/Down jump it
                        across to the opposite side.
                      </>
                    )}
                  </p>
                </>
              ) : (
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-knockout">
                    {selectedFingerHoleToolIds.size} finger holes selected
                  </span>
                  <span className="shrink-0 font-mono text-[9px] uppercase text-muted">Esc to clear</span>
                </div>
              )}
              <button
                className="mt-3 w-full btn btn-ghost text-knockout border-line text-[10px] !py-1"
                disabled={busy || selectedFingerHoleTools.length < 2 || !fingerAlignPlan}
                title="Align every selected finger hole onto one line — needs at least 2 holes travelling on the same axis (horizontal or vertical), aligned to the bottom-most (or left-most) one"
                onClick={alignFingerHoles}
              >
                ⟷ Align finger holes
              </button>
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
          <button className="btn w-full text-xs" disabled={busy} onClick={() => { pushSnapshot(); void load(undefined, overridesFor(tools), fillHeightPct); }}>↻ Auto-pack</button>
          <button className="btn btn-primary w-full" disabled={busy || !tools.length || Boolean(err)} onClick={exportBin}>
            ↓ Export bin (3MF)
          </button>
          <button
            className="btn w-full text-xs"
            disabled={busy || !tools.length || Boolean(err)}
            onClick={() => { setSliceErr(null); setSliceDialogOpen(true); }}
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
                  type="number" step={0.1} min={SLICE_MIN_THICKNESS_MM} max={maxSliceThicknessMm}
                  value={sliceThickness}
                  onChange={(event) => { setSliceThickness(event.target.value); setSliceErr(null); }}
                />
              </label>
              {sliceThicknessInvalid && (
                <p className="mt-1 text-orange">
                  Slice thickness must be between {SLICE_MIN_THICKNESS_MM}mm and {maxSliceThicknessMm.toFixed(1)}mm
                  (the shallowest tool's own recess depth).
                </p>
              )}
              {sliceErr && <p className="mt-1 text-orange">{sliceErr}</p>}
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  className="btn text-xs"
                  onClick={() => setSliceDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary text-xs"
                  disabled={busy || sliceThicknessInvalid}
                  onClick={() => {
                    void exportSlice(sliceThicknessNum).then((ok) => {
                      if (ok) setSliceDialogOpen(false);
                    });
                  }}
                >
                  Export
                </button>
              </div>
            </div>
          )}
          {savedBinId ? (
            <>
              <button
                className="btn w-full text-xs"
                disabled={busy || !tools.length || Boolean(err)}
                onClick={() => {
                  setSaveName(savedLabel ?? defaultBinName());
                  setSaveErr(null);
                  setSaveDialogOpen(true);
                }}
              >
                Save As…
              </button>
              {saveErr && !saveDialogOpen && <p className="mt-1 text-orange">{saveErr}</p>}
            </>
          ) : (
            <div className="font-mono text-[10px]">
              <p className="text-muted">
                {saveErr ? "Couldn't create this bin's Bin Library entry." : "Creating this bin's Bin Library entry…"}
              </p>
              {saveErr && (
                <>
                  <p className="mt-1 text-orange">{saveErr}</p>
                  <button
                    className="btn w-full text-xs mt-1"
                    disabled={busy || !tools.length}
                    onClick={() => void mintInitialSave(tools)}
                  >
                    ⟳ Retry
                  </button>
                </>
              )}
            </div>
          )}
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
                  Save As
                </button>
              </div>
            </div>
          )}
          <button className="btn w-full" onClick={handleClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
