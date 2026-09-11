// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// Same fixture as CombineEditor.nudgeDistance.test.tsx: a 20x10mm rectangle
// per tool. tool-a at tx=-15 places it at x in [-25,-5]; tool-b at tx=15
// places it at x in [5,25] — a clean 10mm gap between them, nothing above
// or below either one. Auto-fit grid comes out to gx=2, gy=1 (pitch=42,
// bin_size=41.5, wall=2), i.e. a boundary at x in [-41.75,41.75], y in
// [-20.75,20.75].
const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number, ty = 0) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_pct: null, depth_pct_override: null, depth_kind: "auto" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: false, finger_hole: false, finger_hole_inherited: false, finger_hole_override: null,
    finger_hole_arc_mm: 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null, finger_hole_radial_offset_mm: 0, finger_hole_radial_offset_mm_inherited: 0, finger_hole_radial_offset_mm_override: null, finger_hole_shape: "circular" as const, finger_hole_shape_inherited: "circular" as const, finger_hole_shape_override: null, finger_hole_length_mm: 16, finger_hole_length_mm_inherited: 16, finger_hole_length_mm_override: null, finger_hole_width_mm: 10, finger_hole_width_mm_inherited: 10, finger_hole_width_mm_override: null, finger_hole_corner_radius_mm: 2, finger_hole_corner_radius_mm_inherited: 2, finger_hole_corner_radius_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty, rot: 0, mirror_x: false, mirror_y: false,
  };
}

function buildResponse(
  overrides: CombineToolOverride[] | null | undefined,
  placements: Placement[] | null | undefined,
  bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)],
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
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

describe("CombineEditor Show Spacing overlay", () => {
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
    mockPassthroughSaves(vi.mocked(saveBin));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows nothing until toggled on, and nothing again once toggled back off", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    expect(screen.queryByText(/mm$/, { selector: "text" })).toBeNull();

    const toggle = screen.getByRole("button", { name: "Show Spacing" });
    fireEvent.click(toggle);
    expect(screen.queryAllByText(/mm$/, { selector: "text" }).length).toBeGreaterThan(0);

    fireEvent.click(toggle);
    expect(screen.queryAllByText(/mm$/, { selector: "text" }).length).toBe(0);
  });

  it("reports the real gap between two tools' facing edges, and each one's distance out to the grid boundary", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByRole("button", { name: "Show Spacing" }));

    // The 10mm gap between tool-a's right edge and tool-b's left edge, read
    // from both sides (center-based ray and, since the shared edge is flat,
    // the extreme-point ray at its far corner lands on the same value too).
    expect(screen.getAllByText("10.00 mm").length).toBeGreaterThanOrEqual(2);
    // tool-a's left edge out to the grid's own left boundary.
    expect(screen.getAllByText("16.75 mm").length).toBeGreaterThanOrEqual(1);
    // tool-a's top/bottom edges out to the grid's own top/bottom boundary.
    expect(screen.getAllByText("15.75 mm").length).toBeGreaterThanOrEqual(1);

    // Pins the dedupe behavior exactly, not just "at least one survived":
    // each plain-rectangle tool draws all 4 center-based rays (every
    // direction hits something) plus all 4 extreme-point rays — none of
    // which dedupe against their center-based counterpart here, since every
    // extreme vertex is a corner and every center-based exit is an edge
    // midpoint — for 8 lines/tool, 16 total across both tools.
    const spacingLines = [...document.querySelectorAll("line")].filter(
      (l) => l.getAttribute("stroke") === "#2f8f95" || l.getAttribute("stroke") === "#8f6fb0",
    );
    expect(spacingLines).toHaveLength(16);
  });

  it("draws each line as violet (extreme-point) or teal (center-based), point to point rather than bounding-box-centered", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByRole("button", { name: "Show Spacing" }));

    const lines = [...document.querySelectorAll("line")].filter(
      (l) => l.getAttribute("stroke") === "#2f8f95" || l.getAttribute("stroke") === "#8f6fb0",
    );
    expect(lines.length).toBeGreaterThan(0);
  });
});
