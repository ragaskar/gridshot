import type { CombineOptions, SavedBin } from "../api";

/** A fresh combine session now mints its own Bin Library entry immediately
 *  at mount (`CombineEditor`'s `mintInitialSave`), and autosaves on every
 *  change after that (`autoSave`) — so *every* test that renders one now
 *  triggers a `saveBin` call, whether or not it's testing Save itself.
 *
 *  This builds a `SavedBin` that never forks ids (`tool_ids` echoes exactly
 *  what was asked for) — the same no-op the real server does once ids are
 *  already `bintool-*`-prefixed — so it drops into any test's existing
 *  `combinePreview` mock without needing extra `bintool-*` fixture entries.
 *  Only a test specifically about the first-ever fork (ids actually
 *  changing) needs its own, different mock instead of this one. */
export function fakeSavedBin(
  id: string, label: string, ids: string[], options: CombineOptions,
): SavedBin {
  return {
    id,
    label,
    created_ts: 0,
    tool_ids: ids,
    tool_labels: ids,
    placements: options.placements ?? [],
    overrides: options.overrides ?? [],
    overall_height: options.overallHeight ?? null,
    lip: options.lip ?? true,
    fill_height_pct: options.fillHeightPct ?? 100,
    live_grid: options.liveGrid ?? false,
    magnet_holes: options.magnetHoles ?? false,
    magnet_hole_diameter_mm: options.magnetHoleDiameterMm ?? 6.5,
    magnet_hole_depth_mm: options.magnetHoleDepthMm ?? 2,
    magnet_corners_only: options.magnetCornersOnly ?? false,
    bevel_pockets: options.bevelPockets ?? true,
    force_gx: options.forceGx ?? null,
    force_gy: options.forceGy ?? null,
    removed_cells: options.removedCells ?? null,
    lip_height_mm: options.lipHeightMm ?? null,
    lip_chamfer_top_mm: options.lipChamferTopMm ?? null,
    lip_straight_mm: options.lipStraightMm ?? null,
    lip_chamfer_bottom_mm: options.lipChamferBottomMm ?? null,
    min_wall_mm: options.minWallMm ?? null,
    min_floor_mm: options.minFloorMm ?? null,
    floor_thickness_mm: options.floorThicknessMm ?? null,
    tool_wall_mm: options.toolWallMm ?? null,
    tool_wall_flare_mm: options.toolWallFlareMm ?? null,
    tool_wall_reinforcement_h_mm: options.toolWallReinforcementHMm ?? null,
    edge_margin_mm: options.edgeMarginMm ?? null,
    magnet_hole_inset_from_edge_mm: options.magnetHoleInsetFromEdgeMm ?? null,
    applied_profile_id: options.appliedProfileId ?? null,
  };
}

interface ResettableMock {
  mockReset: () => ResettableMock;
  mockImplementation: (fn: (...args: any[]) => any) => unknown;
}

/** Wires up passthrough `saveBin`/`overwriteBin` mocks (see `fakeSavedBin`) —
 *  call from a test file's `beforeEach` once both are already `vi.fn()`s from
 *  its own `vi.mock("../api", ...)`. `overwriteBin` is optional since not
 *  every file's factory declares it (autosave only needs it once `savedBinId`
 *  is set, which every mint here provides).
 *
 *  Resets both mocks first: `saveBin`/`overwriteBin` are shared, file-level
 *  `vi.fn()`s, and every fresh CombineEditor render now calls `saveBin` once
 *  at mount (see `fakeSavedBin`'s doc comment) — without a reset here, call
 *  counts and implementations from an earlier test in the same file leak
 *  into this one (e.g. `toHaveBeenCalledTimes` counting mounts from tests
 *  that already ran, or a `mockResolvedValue` a prior test set staying
 *  active for a render it was never meant for). */
export function mockPassthroughSaves(
  saveBinMock: ResettableMock,
  overwriteBinMock?: ResettableMock,
) {
  let counter = 0;
  saveBinMock.mockReset().mockImplementation(
    async (label: string, ids: string[], options: CombineOptions = {}) =>
      fakeSavedBin(`auto-bin-${++counter}`, label, ids, options),
  );
  overwriteBinMock?.mockReset().mockImplementation(
    async (id: string, label: string, ids: string[], options: CombineOptions = {}) =>
      fakeSavedBin(id, label, ids, options),
  );
}
