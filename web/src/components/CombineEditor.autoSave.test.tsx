// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { CombineToolOverride, Placement } from "../api";
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
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function listRow(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const row = matches.find((el) => el.className.includes("font-bold"));
  if (!row) throw new Error(`no tool-list row found for "${label}"`);
  return row;
}

function magnetHolesCheckbox(): HTMLInputElement {
  return screen.getByText("Magnet holes").previousElementSibling as HTMLInputElement;
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
}

describe("CombineEditor auto-mint and autosave", () => {
  beforeAll(() => {
    (SVGSVGElement.prototype as unknown as { createSVGPoint: () => unknown }).createSVGPoint = function () {
      const pt = { x: 0, y: 0, matrixTransform: () => ({ x: pt.x, y: pt.y }) };
      return pt;
    };
    (SVGSVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({
      inverse: () => ({}),
    });
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => {};
    }
  });

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

  it("mints a Bin Library entry immediately at mount, with no user interaction", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));
    const [label, ids] = vi.mocked(saveBin).mock.calls[0];
    expect(ids).toEqual(["tool-a", "tool-b"]);
    expect(label).toMatch(/^Combined Bin \d{4}-\d{2}-\d{2}$/);
    // The explicit "Save" button is gone; only "Save As…" remains.
    await waitFor(() => expect(screen.getByText("Save As…")).toBeTruthy());
    expect(screen.queryByText("💾 Save to Bin Library")).toBeNull();
    expect(screen.queryByText("💾 Save")).toBeNull();
  });

  it("debounces an edit after the mint into exactly one overwriteBin call", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    fireEvent.click(magnetHolesCheckbox());
    await vi.advanceTimersByTimeAsync(2000);

    expect(overwriteBin).toHaveBeenCalledTimes(1);
    expect(saveBin).toHaveBeenCalledTimes(1); // still only the mount-time mint
  });

  it("coalesces several rapid edits into a single overwriteBin call", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));

    fireEvent.click(listRow("Wrench"));
    const arrangeArea = document.querySelector("svg")!.parentElement!;

    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(arrangeArea, { key: "ArrowRight" });
      await vi.advanceTimersByTimeAsync(100); // well inside the debounce window
    }
    await vi.advanceTimersByTimeAsync(2000); // let it finally settle

    expect(overwriteBin).toHaveBeenCalledTimes(1);
  });

  it("firing an autosave doesn't touch the undo/redo stacks", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));

    fireEvent.click(listRow("Wrench"));
    const arrangeArea = document.querySelector("svg")!.parentElement!;
    vi.useFakeTimers();
    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" }); // exactly one undo-able nudge
    expect(undoButton().disabled).toBe(false);

    await vi.advanceTimersByTimeAsync(2000); // let the autosave fire
    expect(overwriteBin).toHaveBeenCalled();

    // Still exactly the one nudge on the undo stack — the autosave round
    // trip neither added an entry nor cleared it.
    expect(undoButton().disabled).toBe(false);
    fireEvent.click(undoButton());
    expect(undoButton().disabled).toBe(true);
  });

  it("flushes a pending autosave immediately when the editor is closed", async () => {
    const onClose = vi.fn();
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={onClose} />);
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));

    fireEvent.click(magnetHolesCheckbox()); // schedules a debounced autosave
    expect(overwriteBin).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => expect(overwriteBin).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
  });
});
