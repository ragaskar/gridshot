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
}));

import { combinePreview, combinePreviewGlb } from "../api";

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

function buildResponse(
  placements: Placement[] | null | undefined,
  binStyle: "pocket" | "corral" | "grid",
) {
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
  const tools = bases.map((base) => {
    const placement = placements?.find((p) => p.id === base.id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    bin_style: binStyle, gx: 4, gy: 4, outer_w: 168, outer_d: 168,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

describe("CombineEditor custom bin shape persistence across bin style switches", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, placements, _overallHeight, _lip, _overrides, binStyle) =>
        Promise.resolve(buildResponse(placements, binStyle ?? "pocket")),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the custom shape checkbox and removed cells when switching away from pocket and back, but omits them from non-pocket requests", async () => {
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} lip={true} onClose={() => {}} />,
    );
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByText("Force bin size"));
    await waitFor(() => expect(combinePreview).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByText("Custom bin shape"));
    const removeCell = await screen.findByLabelText("Grid cell column 1, row 1");
    fireEvent.click(removeCell);
    await screen.findByLabelText("Grid cell column 1, row 1 (removed)");

    // switch to corral: the checkbox/grid UI disappears, and the removed
    // cell must NOT be sent for a non-pocket style...
    fireEvent.click(screen.getByRole("button", { name: "Corral" }));
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[5]).toBe("corral");
      expect(last[11]).toBeNull();
    });
    expect(screen.queryByText("Custom bin shape")).toBeNull();

    // ...but switching back to pocket brings both the checkbox state and the
    // removed cell right back, without having to redraw it.
    fireEvent.click(screen.getByRole("button", { name: "Pocket" }));
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[5]).toBe("pocket");
      expect(last[11]).toEqual([[0, 0]]);
    });
    const checkbox = screen.getByText("Custom bin shape").previousElementSibling as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(await screen.findByLabelText("Grid cell column 1, row 1 (removed)")).toBeTruthy();
  });
});
