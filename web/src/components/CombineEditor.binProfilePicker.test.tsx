// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { BinProfile, Placement } from "../api";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { combinePreview, combinePreviewGlb, listBinProfiles, saveBin } from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_mode: "automatic" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: false, finger_hole: false, finger_hole_inherited: false, finger_hole_override: null,
    finger_hole_arc_mm: 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

function buildResponse(
  placements: Placement[] | null | undefined, fillHeightPct: number, liveGrid = false,
) {
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
  const tools = bases.map((base) => {
    const placement = placements?.find((p) => p.id === base.id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: fillHeightPct, live_grid: liveGrid, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

// index 0 in the mocked profile list — auto-applied when the editor opens
// fresh, before any user interaction. Distinguishable from the hardcoded
// pre-Bin-Profiles defaults (fill 100/lip on/magnet off) by using live_grid,
// so a test can tell whether the auto-apply effect ran.
const DEFAULT_PROFILE: BinProfile = {
  id: "p0", name: "Default", created_ts: 0,
  fill_height_pct: 0, live_grid: true, lip: true, allow_custom_shape: true,
  magnet_holes_default: false, magnet_hole_diameter_mm_default: 6.5, magnet_hole_depth_mm_default: 2.0,
  lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
  min_wall_mm: null, min_floor_mm: null, floor_thickness_mm: null, tool_wall_mm: null,
  tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null, edge_margin_mm: null,
  magnet_hole_inset_from_edge_mm: null,
  has_preview_image: false,
};

const CUSTOM_PROFILE: BinProfile = {
  id: "p1", name: "My Corral", created_ts: 0,
  fill_height_pct: 0, live_grid: false, lip: false, allow_custom_shape: false,
  magnet_holes_default: true, magnet_hole_diameter_mm_default: 5.0, magnet_hole_depth_mm_default: 1.5,
  lip_height_mm: 8.0, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
  min_wall_mm: 3.0, min_floor_mm: null, floor_thickness_mm: null, tool_wall_mm: 4.0,
  tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null, edge_margin_mm: null,
  magnet_hole_inset_from_edge_mm: null,
  has_preview_image: false,
};

function magnetHolesCheckbox(): HTMLInputElement {
  return screen.getByText("Magnet holes").previousElementSibling as HTMLInputElement;
}

describe("CombineEditor bin profile picker", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) => Promise.resolve(
        buildResponse(options?.placements, options?.fillHeightPct ?? 100, options?.liveGrid ?? false),
      ),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([DEFAULT_PROFILE, CUSTOM_PROFILE]);
    mockPassthroughSaves(vi.mocked(saveBin));
  });

  afterEach(() => {
    cleanup();
  });

  it("applies the first bin profile automatically when opening a fresh combine", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const select = await screen.findByLabelText("Bin profile") as HTMLSelectElement;

    await waitFor(() => expect(select.value).toBe("p0"));
    const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
    expect(last[1]?.fillHeightPct).toBe(0);
    expect(last[1]?.liveGrid).toBe(true);
  });

  it("applies every field from the picked profile to the next combine request", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const select = await screen.findByLabelText("Bin profile") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));

    fireEvent.change(select, { target: { value: "p1" } });

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      const opts = last[1]!;
      expect(opts.fillHeightPct).toBe(0);
      expect(opts.liveGrid).toBe(false);
      expect(opts.lip).toBe(false);
      expect(opts.magnetHoles).toBe(true);
      expect(opts.magnetHoleDiameterMm).toBe(5.0);
      expect(opts.magnetHoleDepthMm).toBe(1.5);
      expect(opts.lipHeightMm).toBe(8.0);
      expect(opts.minWallMm).toBe(3.0);
      expect(opts.toolWallMm).toBe(4.0);
    });

    // reflected in the UI too
    expect(magnetHolesCheckbox().checked).toBe(true);
  });

  it("undoes a profile application as one step, reverting every field it changed", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const select = await screen.findByLabelText("Bin profile") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("p0")); // auto-applied default

    fireEvent.change(select, { target: { value: "p1" } });
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(false));
    const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
    // back to the auto-applied default profile
    expect(last[1]?.fillHeightPct).toBe(0);
    expect(last[1]?.liveGrid).toBe(true);
    expect(last[1]?.lip).toBe(true);
  });

  it("keeps a profile-applied field independently editable afterward", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const select = await screen.findByLabelText("Bin profile") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("p0"));

    fireEvent.change(select, { target: { value: "p1" } });
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));

    // flip lip back on manually — a one-time copy, not a live link to the profile
    const lipCheckbox = screen.getByText("Stacking lip").previousElementSibling as HTMLInputElement;
    fireEvent.click(lipCheckbox);

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.lip).toBe(true);
      // unrelated fields stay as the profile set them
      expect(last[1]?.fillHeightPct).toBe(0);
      expect(last[1]?.liveGrid).toBe(false);
    });
  });
});
