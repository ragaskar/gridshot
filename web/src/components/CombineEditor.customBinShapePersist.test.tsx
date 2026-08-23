// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { Placement } from "../api";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { combinePreview, combinePreviewGlb, listBinProfiles } from "../api";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_mode: "automatic" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: false, finger_hole: false, finger_hole_inherited: false, finger_hole_override: null,
    finger_hole_side: "center" as const, finger_hole_offset_mm_max: 0,
    finger_hole_side_flip: false, finger_hole_side_flip_override: null,
    finger_hole_offset_mm: 0, finger_hole_offset_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

function buildResponse(
  placements: Placement[] | null | undefined,
  fillHeightPct: number,
) {
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
  const tools = bases.map((base) => {
    const placement = placements?.find((p) => p.id === base.id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: fillHeightPct, live_grid: false, gx: 4, gy: 4, outer_w: 168, outer_d: 168,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

const POCKET_PROFILE = {
  id: "seed-pocket", name: "Pocket", created_ts: 0,
  fill_height_pct: 100, live_grid: false, lip: true, allow_custom_shape: true,
  magnet_holes_default: false, magnet_hole_diameter_mm_default: 6.5, magnet_hole_depth_mm_default: 2.0,
  lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
  min_wall_mm: null, min_floor_mm: null, floor_thickness_mm: null, tool_wall_mm: null,
  tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null, edge_margin_mm: null,
  magnet_hole_inset_from_edge_mm: null,
  has_preview_image: false,
};
const CORRAL_PROFILE = {
  ...POCKET_PROFILE, id: "seed-corral", name: "Corral", fill_height_pct: 0, allow_custom_shape: false,
};

describe("CombineEditor custom bin shape persistence across bin profile switches", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) =>
        Promise.resolve(buildResponse(options?.placements, options?.fillHeightPct ?? 100)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([POCKET_PROFILE, CORRAL_PROFILE]);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the custom shape checkbox and removed cells when switching away from pocket and back, but omits them from non-pocket requests", async () => {
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />,
    );
    await screen.findByText("Wrench");
    const profileSelect = await screen.findByLabelText("Bin profile") as HTMLSelectElement;
    await waitFor(() => expect(profileSelect.options.length).toBe(3)); // placeholder + 2 profiles

    // 1 initial auto-pack + 1 auto-applied default profile (Pocket, first in
    // the list) + 1 for this click.
    fireEvent.click(screen.getByText("Force bin size"));
    await waitFor(() => expect(combinePreview).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByText("Custom bin shape"));
    const removeCell = await screen.findByLabelText("Grid cell column 1, row 1");
    fireEvent.click(removeCell);
    await screen.findByLabelText("Grid cell column 1, row 1 (removed)");

    // apply the Corral profile: the checkbox/grid UI disappears (Corral's
    // allow_custom_shape is false), and the removed cell must NOT be sent...
    fireEvent.change(profileSelect, { target: { value: "seed-corral" } });
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.fillHeightPct).toBe(0);
      expect(last[1]?.removedCells).toBeNull();
    });
    expect(screen.queryByText("Custom bin shape")).toBeNull();

    // ...but applying the Pocket profile again brings both the checkbox
    // state and the removed cell right back, without having to redraw it.
    fireEvent.change(profileSelect, { target: { value: "seed-pocket" } });
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.fillHeightPct).toBe(100);
      expect(last[1]?.removedCells).toEqual([[0, 0]]);
    });
    const checkbox = screen.getByText("Custom bin shape").previousElementSibling as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(await screen.findByLabelText("Grid cell column 1, row 1 (removed)")).toBeTruthy();
  });
});
