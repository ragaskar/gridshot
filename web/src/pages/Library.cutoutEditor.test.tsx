// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  getLibraryCutout: vi.fn(),
  getLibraryPhotoOutline: vi.fn(),
  getResult: vi.fn(),
  libraryEditClick: vi.fn(),
  libraryEditHistory: vi.fn(),
  libraryEditSave: vi.fn(),
  libraryEditStart: vi.fn(),
  createLibraryBackup: vi.fn(),
  downloadLibraryArchive: vi.fn(),
}));

import { getLibraryCutout, listBinProfiles, listLibrary, updateLibraryTool } from "../api";

// Mirrors PhysicalCutoutEditor's own bakeCornerRing exactly, so a fixture
// built here matches what the component independently recomputes from the
// same OutlineCurves graph — see resolveInitialCornerPoly's "does this graph
// actually bake back to `initial`" check.
function bakeEasedCorner(node: [number, number], p1: [number, number], p2: [number, number]) {
  const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => (
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  );
  const pts: [number, number][] = [];
  for (let s = 0; s <= 10; s++) {
    const t = s / 10;
    pts.push(lerp(lerp(p1, node, t), lerp(node, p2, t), t));
  }
  return pts;
}

function readiness(status: ReadinessReport["status"] = "pass"): ReadinessReport {
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
    magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2, magnet_corners_only: false, magnet_easy_release: "off",
    has_photo: false, source_project: `${id}-proj`, source_tool: id,
    created_ts: 0, thumb: `/thumb/${id}.png`, photo_thumb: null,
    readiness: readiness(), provenance: null, outline_revision: 1,
  };
}

describe("Library 'Edit physical cutout' wires the photo baseline through", () => {
  beforeEach(() => {
    vi.mocked(listLibrary).mockResolvedValue([tool("t-a", "Wrench")]);
    vi.mocked(listBinProfiles).mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("passes the fetched photo_baseline into the editor, enabling Revert when diverged", async () => {
    vi.mocked(getLibraryCutout).mockResolvedValue({
      outline: { exterior: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] },
      photo_baseline: { exterior: [[1, 1], [11, 1], [11, 11], [1, 11]], holes: [] },
      diverged: true,
      outline_curves: null,
    });
    render(<Library />);
    await screen.findByDisplayValue("Wrench");

    fireEvent.click(screen.getByText(/Edit physical cutout/));

    await screen.findByText("Library cutout · Wrench");
    expect(getLibraryCutout).toHaveBeenCalledWith("t-a");
    const revert = await screen.findByText("Revert to photo selection");
    expect((revert.closest("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows no shadow outline or revert button when the tool has no photo baseline", async () => {
    vi.mocked(getLibraryCutout).mockResolvedValue({
      outline: { exterior: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] },
      photo_baseline: null,
      diverged: false,
      outline_curves: null,
    });
    render(<Library />);
    await screen.findByDisplayValue("Wrench");

    fireEvent.click(screen.getByText(/Edit physical cutout/));

    await screen.findByText("Library cutout · Wrench");
    expect(screen.queryByText("Revert to photo selection")).toBeNull();
  });

  it("reopens with a persisted eased corner adjustable again, and saves it back as outline_curves", async () => {
    const CUTOUT: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];
    const curvePts = bakeEasedCorner([-10, -5], [-10, -2], [-7, -5]);
    const bakedOutline = { exterior: [...curvePts, CUTOUT[1], CUTOUT[2], CUTOUT[3]], holes: [] };
    const curves = {
      exterior: [
        { p: CUTOUT[0], h_in: 3, h_out: 3 },
        { p: CUTOUT[1], h_in: null, h_out: null },
        { p: CUTOUT[2], h_in: null, h_out: null },
        { p: CUTOUT[3], h_in: null, h_out: null },
      ],
      holes: [],
    };
    vi.mocked(getLibraryCutout).mockResolvedValue({
      outline: bakedOutline, photo_baseline: null, diverged: false, outline_curves: curves,
    });
    vi.mocked(updateLibraryTool).mockResolvedValue({ ...tool("t-a", "Wrench"), readiness: readiness() });
    render(<Library />);
    await screen.findByDisplayValue("Wrench");
    fireEvent.click(screen.getByText(/Edit physical cutout/));
    await screen.findByText("Library cutout · Wrench");

    fireEvent.click(screen.getByText("Edit curves"));

    // The persisted corner reopens already eased (green), with its handles
    // ready to drag again — not as one ordinary vertex among the 14 baked
    // points.
    expect(document.querySelectorAll("circle")).toHaveLength(4);
    expect(document.querySelectorAll("circle")[0].getAttribute("fill")).toBe("var(--c-olive)");
    expect(document.querySelectorAll("rect")).toHaveLength(2);

    // Round-trip: un-round it, then save — outline_curves sent back reflects
    // the edit, not just the outline the tool arrived with.
    fireEvent.pointerDown(document.querySelectorAll("circle")[0]);
    fireEvent.click(screen.getByText("Save cutout and regenerate"));

    await Promise.resolve();
    const [, changes] = vi.mocked(updateLibraryTool).mock.calls[0];
    expect(changes.outline_curves).toEqual({
      exterior: [
        { p: [-10, -5], h_in: null, h_out: null },
        { p: [10, -5], h_in: null, h_out: null },
        { p: [10, 5], h_in: null, h_out: null },
        { p: [-10, 5], h_in: null, h_out: null },
      ],
      holes: [],
    });
  });
});
