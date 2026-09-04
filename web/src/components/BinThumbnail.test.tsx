// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { CombinePreview, Placement, SavedBin } from "../api";

vi.mock("../binPreviewCache", () => ({
  binPreviewHash: vi.fn(() => "fixed-hash"),
  getBinPreview: vi.fn(),
}));

import { getBinPreview } from "../binPreviewCache";
import { BinThumbnail } from "./BinThumbnail";

function placement(id: string): Placement {
  return { id, tx: 5, ty: -3, rot: 0, mirror_x: false, mirror_y: false };
}

function savedBin(): SavedBin {
  return {
    id: "bin-1", label: "My bin", created_ts: 0, tool_ids: ["t-a"], tool_labels: ["Wrench"],
    placements: [placement("t-a")], overrides: [], overall_height: null, lip: true,
    fill_height_pct: 100, live_grid: false, magnet_holes: false, magnet_hole_diameter_mm: 6.5,
    magnet_hole_depth_mm: 2, magnet_corners_only: false, magnet_easy_release: "off", bevel_pockets: true, pocket_round_radius_mm: 0.6, force_gx: null, force_gy: null, removed_cells: null,
    lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null,
    lip_chamfer_bottom_mm: null, min_wall_mm: null, min_floor_mm: null, floor_thickness_mm: null,
    tool_wall_mm: null, tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null,
    edge_margin_mm: null, magnet_hole_inset_from_edge_mm: null, applied_profile_id: null,
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

describe("BinThumbnail", () => {
  beforeEach(() => {
    vi.mocked(getBinPreview).mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("shows a placeholder while the preview loads, then an svg with one tool polygon", async () => {
    let resolve!: (p: CombinePreview) => void;
    vi.mocked(getBinPreview).mockReturnValue(new Promise((r) => { resolve = r; }));

    const { container } = render(<BinThumbnail bin={savedBin()} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".animate-pulse")).toBeTruthy();

    resolve(preview());
    await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());
    expect(container.querySelectorAll("polygon")).toHaveLength(1);
  });

  it("shows a fallback message if the preview fails to load", async () => {
    vi.mocked(getBinPreview).mockRejectedValue(new Error("tool deleted"));
    render(<BinThumbnail bin={savedBin()} />);
    await screen.findByText("no preview");
  });

  it("centers a forced-size bin's footprint on world origin, not on its off-center tools", async () => {
    // A tool parked at tx=-40 inside a forced 3x2 (126x84mm) footprint is a
    // deliberate arrangement — the bin rect must stay centered at (0,0),
    // the same way the interactive editor's own locked branch never
    // re-centers on the tools (see CombineEditor.tsx's `layout` useMemo).
    const forcedBin: SavedBin = { ...savedBin(), force_gx: 3, force_gy: 2 };
    const forcedPreview: CombinePreview = {
      ...preview(),
      gx: 3, gy: 2, outer_w: 126, outer_d: 84,
      tools: [{ ...preview().tools[0], tx: -40 }],
    };
    vi.mocked(getBinPreview).mockResolvedValue(forcedPreview);

    const { container } = render(<BinThumbnail bin={forcedBin} />);
    await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());

    const rect = container.querySelector("rect")!;
    expect(rect.getAttribute("x")).toBe(String(-126 / 2));
    expect(rect.getAttribute("y")).toBe(String(-84 / 2));
  });
});
