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

import { listBinProfiles, listLibrary } from "../api";

function readiness(status: ReadinessReport["status"]): ReadinessReport {
  return { status, checks: [], metrics: {} };
}

function tool(id: string, label: string, status: ReadinessReport["status"] = "pass"): LibraryTool {
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
    readiness: readiness(status), provenance: null, outline_revision: 1,
  };
}

const TOOLS = [
  tool("t-a", "Wrench"),
  tool("t-b", "Pliers"),
  tool("t-c", "Hammer"),
  tool("t-d", "Broken Tool", "block"),
];

describe("Library view toggle and selection", () => {
  beforeEach(() => {
    vi.mocked(listLibrary).mockResolvedValue(TOOLS);
    vi.mocked(listBinProfiles).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("switches to list view and shows a compact row per tool", async () => {
    render(<Library />);
    await screen.findByDisplayValue("Wrench");

    fireEvent.click(screen.getByText("List"));

    // list view has no per-tool bin-style/finger-access buttons
    expect(screen.queryByText("Finger access: off")).toBeNull();
    // but does show a readiness label as plain text (3 ready, 1 blocked)
    expect(screen.getAllByText("ready")).toHaveLength(3);
    expect(screen.getByText("blocked")).toBeTruthy();
  });

  it("select all selects every non-blocked tool, and clicking again clears it", async () => {
    render(<Library />);
    await screen.findByDisplayValue("Wrench");
    fireEvent.click(screen.getByText("List"));

    const selectAll = screen.getByLabelText(/select all/i) as HTMLInputElement;
    fireEvent.click(selectAll);

    // 3 non-blocked tools selected; the blocked one never joins
    await waitFor(() => expect(screen.getByText("3 selected")).toBeTruthy());

    fireEvent.click(selectAll);
    await waitFor(() => expect(screen.getByText("Select all")).toBeTruthy());
  });

  it("shift-click in list view selects the contiguous range", async () => {
    render(<Library />);
    await screen.findByDisplayValue("Wrench");
    fireEvent.click(screen.getByText("List"));

    const rowCheckbox = (label: string) => {
      const nameButton = screen.getByText(label);
      const row = nameButton.closest("div")!;
      return row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    };

    fireEvent.click(rowCheckbox("Wrench"));
    fireEvent.click(rowCheckbox("Hammer"), { shiftKey: true });

    await waitFor(() => expect(screen.getByText("3 selected")).toBeTruthy());
    expect(rowCheckbox("Wrench").checked).toBe(true);
    expect(rowCheckbox("Pliers").checked).toBe(true);
    expect(rowCheckbox("Hammer").checked).toBe(true);
  });
});
