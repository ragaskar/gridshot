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

/** SavedBin fields that do NOT affect its rendered 2D-arrange-view preview —
 *  renaming a bin, or a tool it uses losing its library entry, shouldn't
 *  invalidate a cached preview or need forwarding to `combinePreview`. */
const COSMETIC_BIN_FIELDS = [
  "id", "label", "notes", "created_ts", "tool_labels", "applied_profile_id",
] as const satisfies readonly (keyof SavedBin)[];

/** Every remaining SavedBin field — one that DOES affect the rendered
 *  preview — paired with its `CombineOptions` key, so `binPreviewHash`'s
 *  cache key and `optionsFor`'s request body are both built from this one
 *  list instead of drifting out of sync with each other (as `bevel_pockets`/
 *  `pocket_round_radius_mm` did — added to `bin_solid` and `SavedBin` but
 *  never wired into either of these). `tool_ids` is geometry too, but isn't
 *  a `CombineOptions` key — it's passed positionally to `combinePreview` —
 *  so it's folded in separately below instead of listed here. */
const GEOMETRY_OPTION_FIELDS = [
  ["placements", "placements"],
  ["overrides", "overrides"],
  ["overall_height", "overallHeight"],
  ["lip", "lip"],
  ["fill_height_pct", "fillHeightPct"],
  ["live_grid", "liveGrid"],
  ["magnet_holes", "magnetHoles"],
  ["magnet_hole_diameter_mm", "magnetHoleDiameterMm"],
  ["magnet_hole_depth_mm", "magnetHoleDepthMm"],
  ["magnet_corners_only", "magnetCornersOnly"],
  ["magnet_easy_release", "magnetEasyRelease"],
  ["bevel_pockets", "bevelPockets"],
  ["pocket_round_radius_mm", "pocketRoundRadiusMm"],
  ["force_gx", "forceGx"],
  ["force_gy", "forceGy"],
  ["removed_cells", "removedCells"],
  ["lip_height_mm", "lipHeightMm"],
  ["lip_chamfer_top_mm", "lipChamferTopMm"],
  ["lip_straight_mm", "lipStraightMm"],
  ["lip_chamfer_bottom_mm", "lipChamferBottomMm"],
  ["min_wall_mm", "minWallMm"],
  ["min_floor_mm", "minFloorMm"],
  ["floor_thickness_mm", "floorThicknessMm"],
  ["tool_wall_mm", "toolWallMm"],
  ["tool_wall_flare_mm", "toolWallFlareMm"],
  ["tool_wall_reinforcement_h_mm", "toolWallReinforcementHMm"],
  ["edge_margin_mm", "edgeMarginMm"],
  ["magnet_hole_inset_from_edge_mm", "magnetHoleInsetFromEdgeMm"],
] as const satisfies readonly [keyof SavedBin, keyof CombineOptions][];

const GEOMETRY_BIN_FIELDS = [
  "tool_ids",
  ...GEOMETRY_OPTION_FIELDS.map(([snakeKey]) => snakeKey),
] as const;

// Compile-time guardrail: every SavedBin field must be classified as either
// cosmetic or geometry above. Adding a field to SavedBin without adding it to
// one of those two lists leaves it here as an "unclassified" key, which
// makes this assignment a type error (`true` isn't assignable to `never`) —
// `npm run build` fails until the new field is deliberately classified,
// instead of it silently defaulting to invisible-to-the-cache like
// bevel_pockets/pocket_round_radius_mm did.
type UnclassifiedBinField = Exclude<
  keyof SavedBin,
  typeof COSMETIC_BIN_FIELDS[number] | typeof GEOMETRY_BIN_FIELDS[number]
>;
const _assertAllBinFieldsClassified: UnclassifiedBinField extends never ? true : never = true;
void _assertAllBinFieldsClassified;

/** Every field on a saved bin that affects its rendered 2D-arrange-view
 *  preview — see GEOMETRY_OPTION_FIELDS/GEOMETRY_BIN_FIELDS above, the
 *  canonical list shared with `optionsFor`. */
export function binPreviewHash(bin: SavedBin): string {
  const geometry: Record<string, unknown> = { tool_ids: bin.tool_ids };
  for (const [snakeKey] of GEOMETRY_OPTION_FIELDS) geometry[snakeKey] = bin[snakeKey];
  return fnv1a(JSON.stringify(geometry));
}

function optionsFor(bin: SavedBin): CombineOptions {
  const options: Record<string, unknown> = {};
  for (const [snakeKey, camelKey] of GEOMETRY_OPTION_FIELDS) options[camelKey] = bin[snakeKey];
  return options as CombineOptions;
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
