// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
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

import { combinePreview, combinePreviewGlb, listBinProfiles, saveBin } from "../api";

// 20mm-wide stamps 30mm apart center-to-center — the pair spans 50mm, wider
// than a single 1x1 gridfinity cell (~41.5mm).
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
    return {
      ...base,
      tx: placement?.tx ?? base.tx,
      ty: placement?.ty ?? base.ty,
      rot: placement?.rot ?? base.rot,
      clearance_mm: override?.clearance_mm ?? base.clearance_mm_inherited,
      clearance_mm_override: override?.clearance_mm ?? null,
    };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

const OVERFLOW_TEXT = /extends past the locked bin size/;

describe("CombineEditor 3D-preview overflow message", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) => Promise.resolve(buildResponse(options?.overrides, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin));
  });

  afterEach(() => cleanup());

  it("clears from the 3D-preview overlay as soon as the overflow condition resolves, not just from the sidebar banner", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByText("Preview 3D"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Force bin size" }));

    const widthInput = await screen.findByLabelText("Forced bin width in gridfinity units");
    fireEvent.change(widthInput, { target: { value: "1" } });

    expect(await screen.findByText(OVERFLOW_TEXT)).toBeTruthy();

    fireEvent.change(widthInput, { target: { value: "5" } });

    expect(screen.queryByText(OVERFLOW_TEXT)).toBeNull();
  });
});
