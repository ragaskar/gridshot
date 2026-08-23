import { useEffect, useMemo, useRef, useState } from "react";
import {
  combineLibrary,
  combineLibrarySlice,
  combinePreview,
  combinePreviewGlb,
  duplicateTool,
  overwriteBin,
  saveBin,
  type BinProfile,
  type CombinePreview,
  type CombineTool,
  type CombineToolOverride,
  type Placement,
  type SavedBin,
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
  // The `ids` prop is only this editor's *starting* set — Duplicate appends
  // to this, and a successful Save/Save As adopts the (possibly just-forked)
  // ids the server returns, so a second save in the session doesn't re-fork
  // still-raw ids the client is holding locally (see saveToBinLibrary/
  // saveInPlace below).
  const [toolIds, setToolIds] = useState<string[]>(ids);
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
  // The Bin Library entry this editor is reopened from, if any — lets
  // "Save" overwrite it in place instead of always creating a new entry
  // ("Save As"). Updated once a fresh combine is saved for the first time,
  // so a subsequent Save overwrites *that* new entry.
  const [savedBinId, setSavedBinId] = useState<string | null>(initial?.id ?? null);
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
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [duplicateErr, setDuplicateErr] = useState<string | null>(null);
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
  ) {
    setBusy(true);
    setErr(null);
    try {
      const p = await combinePreview(idsOverride, {
        placements: placements ?? null,
        overallHeight,
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
        initial.placements, initial.overrides, initial.fillHeightPct,
        initial.forceGx && initial.forceGy ? [initial.forceGx, initial.forceGy] : null,
        initial.removedCells,
        undefined, undefined, undefined, undefined, undefined, toolIds, initial.liveGrid,
      );
    } else {
      void load().then(() => setAutoPacked(true)); // auto-pack on open
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
    const polys = tools.map((t) => placed(t.stamp, t.tx, t.ty, t.rot, t.mirror_x, t.mirror_y));
    const fingerCircles = tools.flatMap((tool) => tool.finger_holes.map(([x, y, diameter]) => {
      const [cx, cy] = placedPoint([x, y], tool.tx, tool.ty, tool.rot, tool.mirror_x, tool.mirror_y);
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

    return { polys, fingerCircles, gx, gy, ow, od, cx, cy, locked, overflowIds, viewCx, viewCy, viewW, viewH };
  }, [tools, meta, forceSize, forceGx, forceGy, fillHeightPct, liveGrid, customShape, removedCells]);

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
    pushSnapshotCoalesced();
    setTools((ts) => ts.map((t) => (selectedIds.has(t.id) ? { ...t, tx: t.tx + dx, ty: t.ty + dy } : t)));
  }
  function handleArrangeKeyDown(e: React.KeyboardEvent) {
    if (!selectedIds.size) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
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
  function setRotation(deg: number) {
    if (!selectedTool || !Number.isFinite(deg)) return;
    pushSnapshotCoalesced();
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

  async function exportSlice(thicknessMm: number) {
    setBusy(true);
    setErr(null);
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
    } catch (e) {
      setErr((e as Error).message);
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

  function saveOptions() {
    const force = forceSize && forceGx && forceGy;
    return {
      placements: placementsFor(tools),
      overrides: overridesFor(tools),
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
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaveBusy(false);
    }
  }

  /** "Save": overwrites the Bin Library entry this editor was reopened from
   *  (or already saved once this session), keeping its id/name. Only
   *  reachable once `savedBinId` is set. */
  async function saveInPlace() {
    if (!savedBinId) return;
    setSaveBusy(true);
    setSaveErr(null);
    try {
      const label = savedLabel || defaultBinName();
      const saved = await overwriteBin(savedBinId, label, toolIds, saveOptions());
      await adoptSavedBinIds(saved);
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
              </g>
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
                applyProfile(profile);
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
          <button className="btn w-full text-xs" disabled={busy} onClick={() => { pushSnapshot(); void load(undefined, overridesFor(tools), fillHeightPct); }}>↻ Auto-pack</button>
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
          {savedBinId ? (
            <div className="grid grid-cols-2 gap-1">
              <button
                className="btn text-xs"
                disabled={busy || saveBusy || !tools.length || Boolean(err)}
                onClick={() => void saveInPlace()}
              >
                💾 Save
              </button>
              <button
                className="btn btn-ghost text-xs"
                disabled={busy || !tools.length || Boolean(err)}
                onClick={() => {
                  setSaveName(savedLabel ?? defaultBinName());
                  setSaveErr(null);
                  setSaveDialogOpen(true);
                }}
              >
                Save As…
              </button>
            </div>
          ) : (
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
          <button className="btn w-full" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
