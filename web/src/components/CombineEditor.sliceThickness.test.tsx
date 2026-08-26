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

import { combineLibrarySlice, combinePreview, combinePreviewGlb, listBinProfiles, saveBin } from "../api";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number, depthMm: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: depthMm, depth_mm_inherited: depthMm, depth_mm_override: null, depth_mode: "automatic" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: false, finger_hole: false, finger_hole_inherited: false, finger_hole_override: null,
    finger_hole_arc_mm: 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

function buildResponse(
  overrides: CombineToolOverride[] | null | undefined,
  placements: Placement[] | null | undefined,
  bases = [baseTool("tool-a", "Wrench", -15, 8), baseTool("tool-b", "Pliers", 15, 12)],
) {
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
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

describe("CombineEditor slice-thickness validation", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) => Promise.resolve(buildResponse(options?.overrides, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    vi.mocked(combineLibrarySlice).mockReset().mockResolvedValue(undefined);
    mockPassthroughSaves(vi.mocked(saveBin));
  });

  afterEach(() => {
    cleanup();
  });

  it("caps the field at the shallowest tool's own recess depth, not a fixed 5mm", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByText("↓ Export slice (3MF)"));
    const input = screen.getByLabelText("Slice thickness in millimetres") as HTMLInputElement;
    expect(input.max).toBe("8"); // min(8, 12) across the two tools
  });

  it("disables only the dialog's own Export button on an out-of-range value, as soon as the field changes", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByText("↓ Export slice (3MF)"));
    const input = screen.getByLabelText("Slice thickness in millimetres") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9" } }); // above the 8mm cap, no click needed

    expect(screen.getByText(/must be between/)).toBeTruthy();
    const dialogExport = screen.getAllByText("Export").find((el) => el.tagName === "BUTTON") as HTMLButtonElement;
    expect(dialogExport.disabled).toBe(true);

    // Unrelated actions stay enabled — this is a slice-thickness problem,
    // not a reason to block exporting the full bin.
    expect((screen.getByText("↓ Export bin (3MF)") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText("↓ Export slice (3MF)") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(input, { target: { value: "2" } });
    expect(screen.queryByText(/must be between/)).toBeNull();
    expect(dialogExport.disabled).toBe(false);
  });

  it("shows a readable message (not the unrelated buttons disabled) when the server itself rejects the slice", async () => {
    vi.mocked(combineLibrarySlice).mockRejectedValueOnce(new Error("shallowest recess is too thin for a 2.0mm slice"));
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByText("↓ Export slice (3MF)"));
    const dialogExport = screen.getAllByText("Export").find((el) => el.tagName === "BUTTON") as HTMLButtonElement;
    fireEvent.click(dialogExport);

    expect(await screen.findByText("shallowest recess is too thin for a 2.0mm slice")).toBeTruthy();
    expect((screen.getByText("↓ Export bin (3MF)") as HTMLButtonElement).disabled).toBe(false);
  });
});
