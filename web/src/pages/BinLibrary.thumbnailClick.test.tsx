// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SavedBin } from "../api";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/bin-library", navigate],
}));

vi.mock("../api", () => ({
  listBins: vi.fn(),
  deleteBin: vi.fn(),
  renameBin: vi.fn(),
  exportSavedBin: vi.fn(),
  exportSavedBinSlice: vi.fn(),
}));

vi.mock("../binPreviewCache", () => ({
  binPreviewHash: vi.fn(() => "fixed-hash"),
  getBinPreview: vi.fn(() => new Promise(() => {})), // never resolves — thumbnail stays a placeholder
  clearBinPreviewCache: vi.fn(),
}));

import { listBins } from "../api";
import { BinLibrary } from "./BinLibrary";

function savedBin(): SavedBin {
  return {
    id: "bin-1", label: "My bin", notes: "", created_ts: 0, tool_ids: ["t-a"], tool_labels: ["Wrench"],
    placements: [], overrides: [], overall_height: null, lip: true,
    fill_height_pct: 100, live_grid: false, magnet_holes: false, magnet_hole_diameter_mm: 6.5,
    magnet_hole_depth_mm: 2, magnet_corners_only: false, magnet_easy_release: "off", bevel_pockets: true, pocket_round_radius_mm: 0.6, force_gx: null, force_gy: null, removed_cells: null,
    lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null,
    lip_chamfer_bottom_mm: null, min_wall_mm: null, min_floor_mm: null, floor_thickness_mm: null,
    tool_wall_mm: null, tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null,
    edge_margin_mm: null, magnet_hole_inset_from_edge_mm: null, applied_profile_id: null,
  };
}

describe("BinLibrary thumbnail click", () => {
  beforeEach(() => {
    navigate.mockReset();
    vi.mocked(listBins).mockResolvedValue([savedBin()]);
  });
  afterEach(() => cleanup());

  it("reopens the combine editor when the preview thumbnail is clicked", async () => {
    render(<BinLibrary />);
    const thumbnailButton = await screen.findByRole("button", { name: /Reopen "My bin"/ });
    fireEvent.click(thumbnailButton);
    expect(navigate).toHaveBeenCalledWith("/combine/reopen/bin-1");
  });
});
