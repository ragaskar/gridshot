import { combinePreview, type CombineOptions, type CombinePreview, type SavedBin } from "./api";

const CACHE_PREFIX = "gridshot:binPreview:";

function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Every field on a saved bin that affects its rendered 2D-arrange-view
 *  preview — placements/overrides plus every structural/style field, same
 *  set `CombineBin.tsx`'s `reopenInitial` feeds the editor. Deliberately
 *  excludes the cosmetic ones (`id`, `label`, `created_ts`, `tool_labels`,
 *  `applied_profile_id`) — renaming a bin, or a tool it uses losing its
 *  library entry, shouldn't invalidate its cached preview. */
export function binPreviewHash(bin: SavedBin): string {
  const geometry = {
    tool_ids: bin.tool_ids,
    placements: bin.placements,
    overrides: bin.overrides,
    overall_height: bin.overall_height,
    lip: bin.lip,
    fill_height_pct: bin.fill_height_pct,
    live_grid: bin.live_grid,
    magnet_holes: bin.magnet_holes,
    magnet_hole_diameter_mm: bin.magnet_hole_diameter_mm,
    magnet_hole_depth_mm: bin.magnet_hole_depth_mm,
    force_gx: bin.force_gx,
    force_gy: bin.force_gy,
    removed_cells: bin.removed_cells,
    lip_height_mm: bin.lip_height_mm,
    lip_chamfer_top_mm: bin.lip_chamfer_top_mm,
    lip_straight_mm: bin.lip_straight_mm,
    lip_chamfer_bottom_mm: bin.lip_chamfer_bottom_mm,
    min_wall_mm: bin.min_wall_mm,
    min_floor_mm: bin.min_floor_mm,
    floor_thickness_mm: bin.floor_thickness_mm,
    tool_wall_mm: bin.tool_wall_mm,
    tool_wall_flare_mm: bin.tool_wall_flare_mm,
    tool_wall_reinforcement_h_mm: bin.tool_wall_reinforcement_h_mm,
    edge_margin_mm: bin.edge_margin_mm,
    magnet_hole_inset_from_edge_mm: bin.magnet_hole_inset_from_edge_mm,
  };
  return fnv1a(JSON.stringify(geometry));
}

function optionsFor(bin: SavedBin): CombineOptions {
  return {
    placements: bin.placements,
    overallHeight: bin.overall_height,
    lip: bin.lip,
    overrides: bin.overrides,
    fillHeightPct: bin.fill_height_pct,
    liveGrid: bin.live_grid,
    magnetHoles: bin.magnet_holes,
    magnetHoleDiameterMm: bin.magnet_hole_diameter_mm,
    magnetHoleDepthMm: bin.magnet_hole_depth_mm,
    forceGx: bin.force_gx,
    forceGy: bin.force_gy,
    removedCells: bin.removed_cells,
    lipHeightMm: bin.lip_height_mm,
    lipChamferTopMm: bin.lip_chamfer_top_mm,
    lipStraightMm: bin.lip_straight_mm,
    lipChamferBottomMm: bin.lip_chamfer_bottom_mm,
    minWallMm: bin.min_wall_mm,
    minFloorMm: bin.min_floor_mm,
    floorThicknessMm: bin.floor_thickness_mm,
    toolWallMm: bin.tool_wall_mm,
    toolWallFlareMm: bin.tool_wall_flare_mm,
    toolWallReinforcementHMm: bin.tool_wall_reinforcement_h_mm,
    edgeMarginMm: bin.edge_margin_mm,
    magnetHoleInsetFromEdgeMm: bin.magnet_hole_inset_from_edge_mm,
  };
}

interface CacheEntry {
  hash: string;
  preview: CombinePreview;
}

function readCache(binId: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + binId);
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    return null; // localStorage unavailable (private browsing) or a corrupt entry
  }
}

function writeCache(binId: string, entry: CacheEntry) {
  try {
    localStorage.setItem(CACHE_PREFIX + binId, JSON.stringify(entry));
  } catch {
    // Quota exceeded or unavailable — the preview still renders this
    // session, it just re-fetches next time instead of hitting the cache.
  }
}

/** Fetches (or reuses a cached) 2D-arrange-view preview for a saved bin, for
 *  the Bin Library's per-entry thumbnail. Caches per bin id in
 *  `localStorage`, keyed against `binPreviewHash` — a hash match skips the
 *  network round-trip entirely; a re-arrange or any other geometry-affecting
 *  edit changes the hash and forces a fresh render. */
export async function getBinPreview(bin: SavedBin): Promise<CombinePreview> {
  const hash = binPreviewHash(bin);
  const cached = readCache(bin.id);
  if (cached && cached.hash === hash) return cached.preview;
  const preview = await combinePreview(bin.tool_ids, optionsFor(bin));
  writeCache(bin.id, { hash, preview });
  return preview;
}

/** Drops a bin's cached preview — call once it's deleted so a stale entry
 *  doesn't linger in localStorage under an id nothing will ever reuse. */
export function clearBinPreviewCache(binId: string) {
  try {
    localStorage.removeItem(CACHE_PREFIX + binId);
  } catch {
    // ignore
  }
}
