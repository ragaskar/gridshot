// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CombinePreview, Placement, SavedBin } from "./api";

vi.mock("./api", () => ({
  combinePreview: vi.fn(),
}));

import { combinePreview } from "./api";
import { binPreviewHash, clearBinPreviewCache, getBinPreview } from "./binPreviewCache";

function placement(id: string, tx = 0): Placement {
  return { id, tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false };
}

function savedBin(overrides: Partial<SavedBin> = {}): SavedBin {
  return {
    id: "bin-1",
    label: "My bin",
    created_ts: 0,
    tool_ids: ["t-a"],
    tool_labels: ["Wrench"],
    placements: [placement("t-a")],
    overrides: [],
    overall_height: null,
    lip: true,
    fill_height_pct: 100,
    live_grid: false,
    magnet_holes: false,
    magnet_hole_diameter_mm: 6.5,
    magnet_hole_depth_mm: 2, magnet_corners_only: false,
    bevel_pockets: true,
    force_gx: null,
    force_gy: null,
    removed_cells: null,
    lip_height_mm: null,
    lip_chamfer_top_mm: null,
    lip_straight_mm: null,
    lip_chamfer_bottom_mm: null,
    min_wall_mm: null,
    min_floor_mm: null,
    floor_thickness_mm: null,
    tool_wall_mm: null,
    tool_wall_flare_mm: null,
    tool_wall_reinforcement_h_mm: null,
    edge_margin_mm: null,
    magnet_hole_inset_from_edge_mm: null,
    applied_profile_id: null,
    ...overrides,
  };
}

function preview(): CombinePreview {
  return {
    fill_height_pct: 100, live_grid: false, gx: 2, gy: 2, outer_w: 84, outer_d: 84,
    overall_height_mm: 25, usable_height_mm: 20, base_h_mm: 5, floor_thickness_mm: 1,
    lip_height_mm: 2, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5,
    wall: 1.2, lip: true, reserved_cells: [], available_cells: [],
    tools: [{
      ...placement("t-a"), label: "Wrench", fill_height_pct: 100, live_grid: false,
      depth_mm: 10, depth_mm_inherited: 10, depth_mm_override: null, depth_pct: null,
      depth_pct_override: null, depth_kind: "auto", clearance_mm: 1, clearance_mm_inherited: 1,
      clearance_mm_override: null, round_tool: false, finger: false, finger_hole: false,
      finger_hole_inherited: false, finger_hole_override: null, finger_hole_arc_mm: 0,
      finger_hole_arc_mm_override: null, finger_hole_diameter_mm_override: null,
      finger_hole_diameter_mm_inherited: 10, finger_hole_span: false,
      finger_hole_span_override: null, finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null, finger_hole_radial_offset_mm: 0, finger_hole_radial_offset_mm_inherited: 0, finger_hole_radial_offset_mm_override: null,
      finger_holes: [], stamp: [[-1, -1], [1, -1], [1, 1], [-1, 1]], toolshape_type: null,
      toolshape_width_mm: null, toolshape_length_mm: null, toolshape_radius_mm: null,
      toolshape_fillet_bottom: false,
    }],
  };
}

describe("binPreviewHash", () => {
  it("is stable for the same geometry-relevant fields", () => {
    expect(binPreviewHash(savedBin())).toBe(binPreviewHash(savedBin()));
  });

  it("ignores cosmetic fields (label, created_ts, tool_labels, id, applied_profile_id)", () => {
    const a = savedBin();
    const b = savedBin({
      id: "bin-2", label: "Renamed", created_ts: 999,
      tool_labels: ["(deleted tool)"], applied_profile_id: "profile-x",
    });
    expect(binPreviewHash(a)).toBe(binPreviewHash(b));
  });

  it("changes when a geometry-relevant field changes", () => {
    const a = savedBin();
    const b = savedBin({ placements: [placement("t-a", 10)] });
    expect(binPreviewHash(a)).not.toBe(binPreviewHash(b));
  });
});

describe("getBinPreview", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(combinePreview).mockReset();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("fetches on a cache miss and caches the result", async () => {
    vi.mocked(combinePreview).mockResolvedValue(preview());
    const bin = savedBin();

    const first = await getBinPreview(bin);
    expect(first.gx).toBe(2);
    expect(combinePreview).toHaveBeenCalledTimes(1);

    const second = await getBinPreview(bin);
    expect(second).toEqual(first);
    expect(combinePreview).toHaveBeenCalledTimes(1); // hash unchanged — served from cache
  });

  it("re-fetches once the bin's geometry-relevant hash changes", async () => {
    vi.mocked(combinePreview).mockResolvedValue(preview());
    const bin = savedBin();
    await getBinPreview(bin);
    expect(combinePreview).toHaveBeenCalledTimes(1);

    const changed = savedBin({ placements: [placement("t-a", 20)] });
    await getBinPreview(changed);
    expect(combinePreview).toHaveBeenCalledTimes(2);
  });

  it("does not re-fetch when only a cosmetic field (label) changes", async () => {
    vi.mocked(combinePreview).mockResolvedValue(preview());
    const bin = savedBin();
    await getBinPreview(bin);
    await getBinPreview(savedBin({ label: "New name" }));
    expect(combinePreview).toHaveBeenCalledTimes(1);
  });

  it("clearBinPreviewCache forces the next call to re-fetch", async () => {
    vi.mocked(combinePreview).mockResolvedValue(preview());
    const bin = savedBin();
    await getBinPreview(bin);
    clearBinPreviewCache(bin.id);
    await getBinPreview(bin);
    expect(combinePreview).toHaveBeenCalledTimes(2);
  });
});
