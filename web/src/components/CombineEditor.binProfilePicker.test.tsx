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

import { combinePreview, combinePreviewGlb, listBinProfiles } from "../api";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, bin_style: "pocket" as const,
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
    tx, ty: 0, rot: 0,
  };
}

function buildResponse(placements: Placement[] | null | undefined, binStyle: "pocket" | "corral" | "grid") {
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
  const tools = bases.map((base) => {
    const placement = placements?.find((p) => p.id === base.id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    bin_style: binStyle, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

const CUSTOM_PROFILE: BinProfile = {
  id: "p1", name: "My Corral", created_ts: 0,
  base_style: "corral", lip: false, allow_custom_shape: false,
  magnet_holes_default: true, magnet_hole_diameter_mm_default: 5.0, magnet_hole_depth_mm_default: 1.5,
  lip_height_mm: 8.0, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
  min_wall_mm: 3.0, min_floor_mm: null, corral_floor_mm: null, corral_wall_mm: 4.0,
  corral_base_flare_mm: null, corral_base_reinforcement_h_mm: null, corral_edge_margin_mm: null,
  magnet_hole_inset_from_edge_mm: null,
  has_preview_image: false,
};

function magnetHolesCheckbox(): HTMLInputElement {
  return screen.getByText("Magnet holes").previousElementSibling as HTMLInputElement;
}

describe("CombineEditor bin profile picker", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) => Promise.resolve(buildResponse(options?.placements, options?.binStyle ?? "pocket")),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([CUSTOM_PROFILE]);
  });

  afterEach(() => {
    cleanup();
  });

  it("applies every field from the picked profile to the next combine request", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const select = await screen.findByLabelText("Bin profile") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));

    fireEvent.change(select, { target: { value: "p1" } });

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      const opts = last[1]!;
      expect(opts.binStyle).toBe("corral");
      expect(opts.lip).toBe(false);
      expect(opts.magnetHoles).toBe(true);
      expect(opts.magnetHoleDiameterMm).toBe(5.0);
      expect(opts.magnetHoleDepthMm).toBe(1.5);
      expect(opts.lipHeightMm).toBe(8.0);
      expect(opts.minWallMm).toBe(3.0);
      expect(opts.corralWallMm).toBe(4.0);
    });

    // reflected in the UI too
    expect(magnetHolesCheckbox().checked).toBe(true);
  });

  it("undoes a profile application as one step, reverting every field it changed", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const select = await screen.findByLabelText("Bin profile") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));

    fireEvent.change(select, { target: { value: "p1" } });
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(false));
    const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
    expect(last[1]?.binStyle).toBe("pocket");
    expect(last[1]?.lip).toBe(true);
  });

  it("keeps a profile-applied field independently editable afterward", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const select = await screen.findByLabelText("Bin profile") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));

    fireEvent.change(select, { target: { value: "p1" } });
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));

    // flip lip back on manually — a one-time copy, not a live link to the profile
    const lipCheckbox = screen.getByText("Stacking lip").previousElementSibling as HTMLInputElement;
    fireEvent.click(lipCheckbox);

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.lip).toBe(true);
      expect(last[1]?.binStyle).toBe("corral"); // unrelated fields stay as the profile set them
    });
  });
});
