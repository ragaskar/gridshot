// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CombineEditor, defaultBinName } from "./CombineEditor";
import type { CombineToolOverride, Placement } from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { combineLibrary, combineLibrarySlice, combinePreview, combinePreviewGlb, listBinProfiles, saveBin } from "../api";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_pct: null, depth_pct_override: null, depth_kind: "auto" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: false, finger_hole: false, finger_hole_inherited: false, finger_hole_override: null,
    finger_hole_arc_mm: 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null, finger_hole_radial_offset_mm: 0, finger_hole_radial_offset_mm_inherited: 0, finger_hole_radial_offset_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

function buildResponse(overrides: CombineToolOverride[] | null | undefined, placements: Placement[] | null | undefined) {
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
  const tools = bases.map((base) => {
    const override = overrides?.find((o) => o.id === base.id);
    const placement = placements?.find((p) => p.id === base.id);
    const clearance_mm_override = override?.clearance_mm ?? null;
    return {
      ...base,
      tx: placement?.tx ?? base.tx,
      ty: placement?.ty ?? base.ty,
      rot: placement?.rot ?? base.rot,
      clearance_mm: clearance_mm_override ?? base.clearance_mm_inherited,
      clearance_mm_override,
    };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

describe("CombineEditor export filenames", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) =>
        Promise.resolve(buildResponse(options?.overrides, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    vi.mocked(combineLibrary).mockReset().mockResolvedValue(undefined);
    vi.mocked(combineLibrarySlice).mockReset().mockResolvedValue(undefined);
    vi.mocked(saveBin).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("names a fresh export after the auto-minted bin's default name", async () => {
    mockPassthroughSaves(vi.mocked(saveBin));
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />,
    );
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalled()); // mount-time auto-mint

    fireEvent.click(screen.getByText("↓ Export bin (3MF)"));

    await waitFor(() => {
      expect(combineLibrary).toHaveBeenCalled();
    });
    const filename = vi.mocked(combineLibrary).mock.calls[0][2];
    expect(filename).toBe(defaultBinName());
  });

  it("names a reopened saved bin's export after the bin, not the tools", async () => {
    render(
      <CombineEditor
        ids={["tool-a", "tool-b"]}
        overallHeight={null}
        onClose={() => {}}
        initial={{
          id: "bin-3", label: "Workbench Drawer 3", appliedProfileId: null,
          placements: [], overrides: [], fillHeightPct: 100, liveGrid: false, lip: true,
          magnetHoles: false, magnetHoleDiameterMm: 6.5, magnetHoleDepthMm: 2, magnetCornersOnly: false, bevelPockets: true,
          forceGx: null, forceGy: null, removedCells: null,
          lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
          minWallMm: null, minFloorMm: null, floorThicknessMm: null, toolWallMm: null,
          toolWallFlareMm: null, toolWallReinforcementHMm: null, edgeMarginMm: null,
          magnetHoleInsetFromEdgeMm: null,
        }}
      />,
    );
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByText("↓ Export bin (3MF)"));

    await waitFor(() => expect(combineLibrary).toHaveBeenCalled());
    const filename = vi.mocked(combineLibrary).mock.calls[0][2];
    expect(filename).toBe("Workbench Drawer 3");
  });

  it("uses the newly-saved name for exports made later in the same session", async () => {
    vi.mocked(saveBin).mockResolvedValue({
      id: "bin-1", label: "Fresh Save", created_ts: 0,
      tool_ids: ["tool-a", "tool-b"], tool_labels: ["Wrench", "Pliers"],
      placements: [], overrides: [], overall_height: null, lip: true, fill_height_pct: 100, live_grid: false,
      magnet_holes: false, magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2, magnet_corners_only: false, bevel_pockets: true,
      force_gx: null, force_gy: null, removed_cells: null,
      lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
      min_wall_mm: null, min_floor_mm: null, floor_thickness_mm: null, tool_wall_mm: null,
      tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null, edge_margin_mm: null,
      magnet_hole_inset_from_edge_mm: null, applied_profile_id: null,
    });
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />,
    );
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1)); // mount-time auto-mint

    fireEvent.click(screen.getByText("Save As…"));
    const nameInput = screen.getByLabelText("Bin Library entry name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Fresh Save" } });
    fireEvent.click(screen.getByText("Save As"));
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByText("↓ Export bin (3MF)"));
    await waitFor(() => expect(combineLibrary).toHaveBeenCalled());
    const filename = vi.mocked(combineLibrary).mock.calls[0][2];
    expect(filename).toBe("Fresh Save");
  });

  it("names a slice export the same way as the full bin export", async () => {
    mockPassthroughSaves(vi.mocked(saveBin));
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />,
    );
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalled()); // mount-time auto-mint

    fireEvent.click(screen.getByText("↓ Export slice (3MF)"));
    fireEvent.click(screen.getByText("Export"));

    await waitFor(() => expect(combineLibrarySlice).toHaveBeenCalled());
    const filename = vi.mocked(combineLibrarySlice).mock.calls[0][2];
    expect(filename).toBe(defaultBinName());
  });
});
