// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { Placement } from "../api";
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

const STAMP: [number, number][] = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
const PITCH = 42;

function baseTool(id: string, label: string, tx: number, ty: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_pct: null, depth_pct_override: null, depth_kind: "auto" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: false, finger_hole: false, finger_hole_inherited: false, finger_hole_override: null,
    finger_hole_arc_mm: 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null, finger_hole_radial_offset_mm: 0,
    finger_hole_radial_offset_mm_inherited: 0, finger_hole_radial_offset_mm_override: null,
    finger_hole_shape: "circular" as const, finger_hole_shape_inherited: "circular" as const, finger_hole_shape_override: null,
    finger_hole_length_mm: 16, finger_hole_length_mm_inherited: 16, finger_hole_length_mm_override: null,
    finger_hole_width_mm: 10, finger_hole_width_mm_inherited: 10, finger_hole_width_mm_override: null,
    finger_hole_corner_radius_mm: 2, finger_hole_corner_radius_mm_inherited: 2, finger_hole_corner_radius_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty, rot: 0, mirror_x: false, mirror_y: false,
  };
}

// A 2x2 forced grid, one small tool centered in each cell — "tool-XY" names
// its (ix, iy) cell directly so expectations below can read like coordinates.
const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-00": baseTool("tool-00", "A", -PITCH / 2, -PITCH / 2),
  "tool-10": baseTool("tool-10", "B", PITCH / 2, -PITCH / 2),
  "tool-01": baseTool("tool-01", "C", -PITCH / 2, PITCH / 2),
  "tool-11": baseTool("tool-11", "D", PITCH / 2, PITCH / 2),
  // 50mm wide (-25..25), centred on the row-0 seam between the two columns
  // (world x=0) — straddles cell (0,0) and (1,0) no matter which one is
  // selected on its own.
  "tool-wide": { ...baseTool("tool-wide", "Wide", 0, -PITCH / 2), stamp: [[-25, -5], [25, -5], [25, 5], [-25, 5]] },
};
const ALL_IDS = ["tool-00", "tool-10", "tool-01", "tool-11"];

function buildResponse(ids: string[], placements: Placement[] | null | undefined) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id] ?? baseTool(id, id, 0, 0);
    const placement = placements?.find((p) => p.id === id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 2, gy: 2, outer_w: 83.5, outer_d: 83.5,
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2,
    lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1,
    pitch: PITCH, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function initialPlacements(): Placement[] {
  return ALL_IDS.map((id) => ({
    id, tx: TOOL_POOL[id].tx, ty: TOOL_POOL[id].ty, rot: 0, mirror_x: false, mirror_y: false,
  }));
}

function baseInitial(placements: Placement[], removedCells: [number, number][] | null = null) {
  return {
    id: "bin-source", label: "Big Layout", notes: "", appliedProfileId: null,
    placements, overrides: [], fillHeightPct: 100, liveGrid: false, lip: true,
    magnetHoles: false, magnetHoleDiameterMm: 6.5, magnetHoleDepthMm: 2, magnetCornersOnly: false,
    magnetEasyRelease: "off" as const, bevelPockets: true, pocketRoundRadiusMm: 0.6,
    forceGx: 2, forceGy: 2, removedCells,
    lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
    minWallMm: null, minFloorMm: null, floorThicknessMm: null, toolWallMm: null,
    toolWallFlareMm: null, toolWallReinforcementHMm: null, edgeMarginMm: null,
    magnetHoleInsetFromEdgeMm: null,
  };
}

describe("CombineEditor Save Segment", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation((ids, options) =>
      Promise.resolve(buildResponse(ids, options?.placements)));
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
  });

  it("translates only the fully-selected tools' placements onto the new bin's own origin, unforced tools left behind", async () => {
    render(
      <CombineEditor
        ids={ALL_IDS}
        overallHeight={null}
        onClose={() => {}}
        initial={baseInitial(initialPlacements())}
      />,
    );
    await screen.findByText("B");
    expect(saveBin).not.toHaveBeenCalled(); // reopening with no edits never autosaves

    fireEvent.click(screen.getByRole("button", { name: "Save Segment…" }));
    // Default name is "$bin_name Segment" — "Big Layout" here.
    expect((screen.getByLabelText("Segment bin name") as HTMLInputElement).value).toBe("Big Layout Segment");
    // Right-hand column: (ix=1, iy=0) i.e. "column 2, row 1" and (ix=1, iy=1).
    fireEvent.click(screen.getByLabelText(/^Segment grid cell column 2, row 1/));
    fireEvent.click(screen.getByLabelText(/^Segment grid cell column 2, row 2/));

    const saveAsButton = screen.getByRole("button", { name: "Save As" }) as HTMLButtonElement;
    expect(saveAsButton.disabled).toBe(false);
    fireEvent.click(saveAsButton);

    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));
    const [, ids, options] = vi.mocked(saveBin).mock.calls[0];
    if (!options) throw new Error("saveBin called without options");
    expect([...ids].sort()).toEqual(["tool-10", "tool-11"]);
    expect(options.forceGx).toBe(1);
    expect(options.forceGy).toBe(2);
    expect(options.removedCells ?? null).toBeNull();

    const placements = options.placements as Placement[];
    const b = placements.find((p) => p.id === "tool-10")!;
    const d = placements.find((p) => p.id === "tool-11")!;
    expect(b.tx).toBeCloseTo(0);
    expect(b.ty).toBeCloseTo(-21);
    expect(d.tx).toBeCloseTo(0);
    expect(d.ty).toBeCloseTo(21);

    // The source bin's own layout is untouched by any of this.
    expect(screen.getAllByText("B").length).toBeGreaterThan(0);
  });

  it("disables Save As while a tool straddles the selection boundary, and re-enables once it's fully included", async () => {
    render(
      <CombineEditor
        ids={["tool-00", "tool-10", "tool-wide"]}
        overallHeight={null}
        onClose={() => {}}
        initial={baseInitial([
          { id: "tool-00", tx: TOOL_POOL["tool-00"].tx, ty: TOOL_POOL["tool-00"].ty, rot: 0, mirror_x: false, mirror_y: false },
          { id: "tool-10", tx: TOOL_POOL["tool-10"].tx, ty: TOOL_POOL["tool-10"].ty, rot: 0, mirror_x: false, mirror_y: false },
          { id: "tool-wide", tx: 0, ty: -PITCH / 2, rot: 0, mirror_x: false, mirror_y: false },
        ])}
      />,
    );
    await screen.findByText("Wide");

    fireEvent.click(screen.getByRole("button", { name: "Save Segment…" }));
    fireEvent.click(screen.getByLabelText(/^Segment grid cell column 2, row 1/));

    // "Wide" spans both column-1 and column-2 of row 1 — with only column 2
    // selected, it straddles the boundary and must block Save As.
    expect((screen.getByRole("button", { name: "Save As" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Wide.*straddles the selection/)).toBeTruthy();

    // Including the other cell it spans resolves the straddle.
    fireEvent.click(screen.getByLabelText(/^Segment grid cell column 1, row 1/));
    expect((screen.getByRole("button", { name: "Save As" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Cancel/reopen must not leave stale cells armed for next time.
    fireEvent.click(screen.getByRole("button", { name: "Save Segment…" }));
    expect((screen.getByRole("button", { name: "Save As" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("carries an unselected bbox cell into the new bin's removed_cells and drops its tool", async () => {
    render(
      <CombineEditor
        ids={ALL_IDS}
        overallHeight={null}
        onClose={() => {}}
        initial={baseInitial(initialPlacements())}
      />,
    );
    await screen.findByText("B");

    fireEvent.click(screen.getByRole("button", { name: "Save Segment…" }));
    // Select three of the four cells — (0,0), (1,0), (1,1) — leaving (0,1)
    // (tool "C") unselected but inside the resulting 2x2 bounding box, so it
    // becomes a hole in the new bin rather than shrinking the box.
    fireEvent.click(screen.getByLabelText(/^Segment grid cell column 1, row 1/));
    fireEvent.click(screen.getByLabelText(/^Segment grid cell column 2, row 1/));
    fireEvent.click(screen.getByLabelText(/^Segment grid cell column 2, row 2/));

    fireEvent.click(screen.getByRole("button", { name: "Save As" }));
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));
    const [, ids, options] = vi.mocked(saveBin).mock.calls[0];
    if (!options) throw new Error("saveBin called without options");
    expect([...ids].sort()).toEqual(["tool-00", "tool-10", "tool-11"]);
    expect(options.forceGx).toBe(2);
    expect(options.forceGy).toBe(2);
    expect(options.removedCells).toEqual([[0, 1]]);
  });

  it("Esc returns to normal arrange mode, whether or not the Name field has focus", async () => {
    render(
      <CombineEditor
        ids={ALL_IDS}
        overallHeight={null}
        onClose={() => {}}
        initial={baseInitial(initialPlacements())}
      />,
    );
    await screen.findByText("B");

    // Esc with focus elsewhere (e.g. right after clicking a grid cell).
    fireEvent.click(screen.getByRole("button", { name: "Save Segment…" }));
    fireEvent.click(screen.getByLabelText(/^Segment grid cell column 1, row 1/));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("Segment bin name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save As" })).toBeNull();

    // Esc while the autofocused Name field itself has focus — the field is
    // autofocused on open, so this is the common case, not an edge case.
    fireEvent.click(screen.getByRole("button", { name: "Save Segment…" }));
    const nameInput = screen.getByLabelText("Segment bin name");
    nameInput.focus();
    fireEvent.keyDown(nameInput, { key: "Escape" });
    expect(screen.queryByLabelText("Segment bin name")).toBeNull();

    // A later reopen starts from a clean selection either way.
    fireEvent.click(screen.getByRole("button", { name: "Save Segment…" }));
    expect((screen.getByRole("button", { name: "Save As" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
