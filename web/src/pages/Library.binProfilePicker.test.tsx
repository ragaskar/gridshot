// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Library } from "./Library";
import type { BinProfile, LibraryTool } from "../api";

vi.mock("../api", () => ({
  listLibrary: vi.fn(),
  listBinProfiles: vi.fn(),
  cloneLibraryTool: vi.fn(),
  deleteLibraryTool: vi.fn(),
  updateLibraryTool: vi.fn(),
  composeLibrary: vi.fn(),
  drawerPreviewGlb: vi.fn(),
  exportDrawer: vi.fn(),
  getLibraryOutline: vi.fn(),
  getLibraryPhotoOutline: vi.fn(),
  getResult: vi.fn(),
  libraryEditClick: vi.fn(),
  libraryEditHistory: vi.fn(),
  libraryEditSave: vi.fn(),
  libraryEditStart: vi.fn(),
  createLibraryBackup: vi.fn(),
  downloadLibraryArchive: vi.fn(),
}));

import { listBinProfiles, listLibrary, updateLibraryTool } from "../api";

function tool(id: string, label: string): LibraryTool {
  return {
    id, label, grid_x: 2, grid_y: 1, thickness_mm: 4, silhouette_height_mm: 20,
    full_height_mm: null, clearance_mm: 1, bin_style: "pocket",
    pocket_depth_mm: null, derived_pocket_depth_mm: 10, derived_height_u: 3,
    derived_overall_height_mm: 25.4, derived_key: `${id}-key`,
    derived_reserved_cells: [], derived_available_cells: [],
    lip: true, round_tool: false, finger_hole: false, magnet_holes: false,
    magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2,
    has_photo: false, source_project: `${id}-proj`, source_tool: id,
    created_ts: 0, thumb: `/thumb/${id}.png`, photo_thumb: null,
    readiness: { status: "pass", checks: [], metrics: {} }, provenance: null, outline_revision: 1,
  };
}

const CORRAL_PROFILE: BinProfile = {
  id: "p1", name: "My Corral", created_ts: 0,
  base_style: "corral", lip: false, allow_custom_shape: false,
  magnet_holes_default: true, magnet_hole_diameter_mm_default: 5.0, magnet_hole_depth_mm_default: 1.5,
  lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
  min_wall_mm: null, min_floor_mm: null, corral_floor_mm: null, corral_wall_mm: null,
  corral_base_flare_mm: null, corral_base_reinforcement_h_mm: null, magnet_hole_inset_from_edge_mm: null,
  has_preview_image: false,
};

describe("Library per-tool bin profile picker", () => {
  beforeEach(() => {
    vi.mocked(listLibrary).mockResolvedValue([tool("t-a", "Wrench")]);
    vi.mocked(listBinProfiles).mockResolvedValue([CORRAL_PROFILE]);
    vi.mocked(updateLibraryTool).mockImplementation(async (id, changes) => ({
      ...tool(id, "Wrench"),
      ...changes,
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("applies a profile's base style and magnet-hole defaults to the tool", async () => {
    render(<Library />);
    await screen.findByDisplayValue("Wrench");

    const select = (await screen.findByLabelText("Bin profile for Wrench")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));

    fireEvent.change(select, { target: { value: "p1" } });

    await waitFor(() => {
      expect(updateLibraryTool).toHaveBeenCalledWith("t-a", {
        bin_style: "corral",
        magnet_holes: true,
        magnet_hole_diameter_mm: 5.0,
        magnet_hole_depth_mm: 1.5,
      });
    });
  });
});
