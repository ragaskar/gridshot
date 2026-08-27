// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { CombineOptions, Placement } from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
  overwriteBin: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { combinePreview, combinePreviewGlb, listBinProfiles, overwriteBin, saveBin } from "../api";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];
const BASE_H_MM = 4.75;
const FLOOR_THICKNESS_MM = 1.2;
const LIP_H_MM = 4.4;

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

function buildResponse(_ids: string[], options: CombineOptions | undefined, placements?: Placement[] | null) {
  const overall = options?.overallHeight ?? 25.4;
  const lipOn = options?.lip ?? true;
  const usable = overall - BASE_H_MM - FLOOR_THICKNESS_MM - (lipOn ? LIP_H_MM : 0);
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
  const tools = bases.map((base) => {
    const placement = placements?.find((p) => p.id === base.id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: overall, usable_height_mm: Math.round(usable * 100) / 100,
    base_h_mm: BASE_H_MM, floor_thickness_mm: FLOOR_THICKNESS_MM, lip_height_mm: LIP_H_MM,
    pitch: 42, bin_size: 41.5, wall: 2, lip: lipOn,
    reserved_cells: [], available_cells: [], tools,
  };
}

describe("CombineEditor usable height", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (ids, options) => Promise.resolve(buildResponse(ids, options, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the usable height derived from overall height minus base, floor, and lip", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    const input = await screen.findByLabelText("Usable height in millimetres") as HTMLInputElement;
    // 25.4 - 4.75 - 1.2 - 4.4 = 15.05
    await waitFor(() => expect(Number(input.value)).toBeCloseTo(15.05, 2));
  });

  it("editing usable height converts it to an overall height and reloads", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const input = await screen.findByLabelText("Usable height in millimetres") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.blur(input);

    // 20 + 4.75 + 1.2 + 4.4 = 30.35
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.overallHeight).toBeCloseTo(30.35, 2);
    });
  });

  it("clearing the field reverts to auto (null overall height)", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const input = await screen.findByLabelText("Usable height in millimetres") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.blur(input);
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.overallHeight).toBeCloseTo(30.35, 2);
    });

    const updated = await screen.findByLabelText("Usable height in millimetres") as HTMLInputElement;
    fireEvent.change(updated, { target: { value: "" } });
    fireEvent.blur(updated);

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.overallHeight).toBeNull();
    });
  });
});
