// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { CombineToolOverride, Placement, SavedBin } from "../api";
import { fakeSavedBin, mockPassthroughSaves } from "./combineTestSupport";

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
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

describe("CombineEditor bin name + Save As redirect", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) =>
        Promise.resolve(buildResponse(options?.overrides, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the auto-minted bin's name in the header, editable", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    const nameInput = await screen.findByLabelText("Bin name") as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toMatch(/^Combined Bin \d{4}-\d{2}-\d{2}$/));
    expect(nameInput.disabled).toBe(false);
  });

  it("renaming the header field autosaves the new name to the same bin", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const nameInput = await screen.findByLabelText("Bin name") as HTMLInputElement;
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));
    const minted = await vi.mocked(saveBin).mock.results[0].value as SavedBin;

    vi.useFakeTimers();
    fireEvent.change(nameInput, { target: { value: "My Toolbox Drawer" } });
    fireEvent.blur(nameInput);
    await vi.advanceTimersByTimeAsync(2000);

    expect(overwriteBin).toHaveBeenCalledWith(
      minted.id, "My Toolbox Drawer", expect.anything(), expect.anything(),
    );
  });

  it("calls onSaved with the new bin after Save As, not on the initial mint", async () => {
    const onSaved = vi.fn();
    const newBin: SavedBin = fakeSavedBin("bintool-new-bin", "Forked Bin", ["tool-a", "tool-b"], {});
    vi.mocked(saveBin).mockImplementation((label, ids, options) => {
      if (label === "Forked Bin") return Promise.resolve(newBin);
      return Promise.resolve(fakeSavedBin("1-mint", label, ids, options ?? {}));
    });
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} onSaved={onSaved} />);
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Save As…"));
    fireEvent.change(screen.getByLabelText("Bin Library entry name"), { target: { value: "Forked Bin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save As" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(newBin));
  });
});
