// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Library } from "./Library";
import type { LibraryTool, ReadinessReport } from "../api";

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

function readiness(status: ReadinessReport["status"]): ReadinessReport {
  return { status, checks: [], metrics: {} };
}

function tool(id: string, label: string): LibraryTool {
  return {
    id, label, grid_x: 2, grid_y: 1, thickness_mm: 4, silhouette_height_mm: 20,
    full_height_mm: null, clearance_mm: 1, fill_height_pct: 100, live_grid: false,
    pocket_depth_mm: null, derived_pocket_depth_mm: 10, derived_height_u: 3,
    derived_overall_height_mm: 25.4, derived_key: `${id}-key`,
    derived_reserved_cells: [], derived_available_cells: [],
    lip: true, round_tool: false, finger_hole: false, magnet_holes: false,
    magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2,
    has_photo: false, source_project: `${id}-proj`, source_tool: id,
    created_ts: 0, thumb: `/thumb/${id}.png`, photo_thumb: null,
    readiness: readiness("pass"), provenance: null, outline_revision: 1,
  };
}

describe("Library number-field commit", () => {
  beforeEach(() => {
    vi.mocked(listLibrary).mockResolvedValue([tool("t-a", "Wrench")]);
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    vi.mocked(updateLibraryTool).mockImplementation(async (id, changes) => ({
      ...tool(id, "Wrench"),
      ...changes,
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("persists a clearance value changed via the native change event without a blur (spin buttons)", async () => {
    render(<Library />);
    await screen.findByDisplayValue("Wrench");

    const clearanceInput = screen.getByLabelText("Pocket clearance in millimetres") as HTMLInputElement;
    fireEvent.change(clearanceInput, { target: { value: "2.5" } });

    await waitFor(() => {
      expect(updateLibraryTool).toHaveBeenCalledWith("t-a", { clearance_mm: 2.5 });
    });
  });

  it("persists a thickness value changed via the native change event without a blur", async () => {
    render(<Library />);
    await screen.findByDisplayValue("Wrench");

    const input = screen.getByLabelText("Tool thickness in millimetres") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "6" } });

    await waitFor(() => {
      expect(updateLibraryTool).toHaveBeenCalledWith("t-a", { thickness_mm: 6 });
    });
  });
});
