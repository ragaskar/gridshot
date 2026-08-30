// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CombineEditor, type CombineEditorInitial } from "./CombineEditor";
import type { Placement } from "../api";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { combinePreview, combinePreviewGlb, listBinProfiles, saveBin } from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

// Same 20x10 rect as CombineEditor.fingerHole.test.tsx: arc 10 is the bottom
// edge's midpoint, world (0,-5), outward normal straight -y.
const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, radialOffset = 0) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_pct: null, depth_pct_override: null, depth_kind: "auto" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: true, finger_hole: true, finger_hole_inherited: true, finger_hole_override: null,
    finger_hole_arc_mm: 10, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null,
    finger_hole_radial_offset_mm: radialOffset, finger_hole_radial_offset_mm_inherited: 0,
    finger_hole_radial_offset_mm_override: radialOffset || null,
    finger_holes: [[0, -5 - radialOffset, 4]] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx: 0, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-a": baseTool("tool-a", "Wrench"),
  "tool-b": { ...baseTool("tool-b", "Pliers"), tx: 40 },
  "bintool-a": baseTool("bintool-a", "Wrench"),
  "bintool-b": { ...baseTool("bintool-b", "Pliers"), tx: 40 },
};

function buildResponse(ids: string[], placements: Placement[] | null | undefined) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id] ?? baseTool(id, id);
    const placement = placements?.find((p) => p.id === id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function fingerCircle(): SVGCircleElement {
  return document.querySelector("circle")!;
}
describe("CombineEditor finger-hole radial offset", () => {
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
      (ids, options) => Promise.resolve(buildResponse(ids, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin));
  });

  afterEach(() => cleanup());

  it("shows a radial offset input seeded from 0, with a 0.1mm step", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });

    const input = screen.getByLabelText(/radial offset/i) as HTMLInputElement;
    expect(input.value).toBe("0");
    expect(input.step).toBe("0.1");
  });

  it("a positive offset pushes the hole outward (off the outline) without changing its diameter", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    const before = {
      cx: Number(fingerCircle().getAttribute("cx")),
      cy: Number(fingerCircle().getAttribute("cy")),
      r: Number(fingerCircle().getAttribute("r")),
    };

    const input = screen.getByLabelText(/radial offset/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2" } });

    const circle = fingerCircle();
    // Bottom edge's outward normal is -y: x unchanged, y decreases by 2.
    expect(Number(circle.getAttribute("cx"))).toBeCloseTo(before.cx);
    expect(Number(circle.getAttribute("cy"))).toBeCloseTo(before.cy - 2);
    expect(Number(circle.getAttribute("r"))).toBeCloseTo(before.r);
  });

  it("a negative offset pushes the hole inward, the opposite way", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    const before = { cy: Number(fingerCircle().getAttribute("cy")) };

    const input = screen.getByLabelText(/radial offset/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-2" } });

    expect(Number(fingerCircle().getAttribute("cy"))).toBeCloseTo(before.cy + 2);
  });

  it("a radial offset change is included in the next 3D preview request", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    vi.mocked(combinePreviewGlb).mockClear();

    const input = screen.getByLabelText(/radial offset/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3" } });

    await vi.waitFor(() => expect(combinePreviewGlb).toHaveBeenCalled());
    const [, options] = vi.mocked(combinePreviewGlb).mock.calls.at(-1)!;
    const override = options?.overrides?.find((o) => o.id === "tool-a");
    expect(override?.finger_hole_radial_offset_mm).toBe(3);
  });

  it("a radial offset change is included in what gets sent to Save", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    await vi.waitFor(() => expect(saveBin).toHaveBeenCalled()); // mount-time auto-mint

    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    const input = screen.getByLabelText(/radial offset/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1.5" } });

    fireEvent.click(screen.getByText("Save As…"));
    fireEvent.click(screen.getByText("Save As"));
    await vi.waitFor(() => expect(saveBin).toHaveBeenCalledTimes(2));

    const [, , options] = vi.mocked(saveBin).mock.calls.at(-1)!;
    const override = options?.overrides?.find((o) => o.id === "tool-a");
    expect(override?.finger_hole_radial_offset_mm).toBe(1.5);
  });

  it("reopening a bin with a saved offset shows it in the input and on the circle", async () => {
    vi.mocked(combinePreview).mockImplementation(
      (ids, options) => Promise.resolve(buildResponse(
        ids.map((id) => (id === "tool-a" ? "bintool-a" : id === "tool-b" ? "bintool-b" : id)),
        options?.placements,
      )),
    );
    TOOL_POOL["bintool-a"] = baseTool("bintool-a", "Wrench", 2.5);

    const initial: CombineEditorInitial = {
      id: "bin-1", label: "Reopened bin", appliedProfileId: null,
      placements: [], overrides: [], fillHeightPct: 100, liveGrid: false, lip: true,
      magnetHoles: false, magnetHoleDiameterMm: 6.5, magnetHoleDepthMm: 2, magnetCornersOnly: false, bevelPockets: true,
      forceGx: null, forceGy: null, removedCells: null,
      lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
      minWallMm: null, minFloorMm: null, floorThicknessMm: null, toolWallMm: null,
      toolWallFlareMm: null, toolWallReinforcementHMm: null, edgeMarginMm: null,
      magnetHoleInsetFromEdgeMm: null,
    };
    render(
      <CombineEditor
        ids={["bintool-a", "bintool-b"]}
        overallHeight={null}
        onClose={() => {}}
        initial={initial}
      />,
    );
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });

    const input = screen.getByLabelText(/radial offset/i) as HTMLInputElement;
    expect(input.value).toBe("2.5");
  });
});
