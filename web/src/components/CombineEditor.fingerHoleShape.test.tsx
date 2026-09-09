// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
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
import type { CombineToolOverride } from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

// Same 20x10 rect convention as CombineEditor.fingerHole.test.tsx: bottom
// edge midpoint is arc 10, world (0, -5).
const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_pct: null, depth_pct_override: null, depth_kind: "auto" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: true, finger_hole: true, finger_hole_inherited: true, finger_hole_override: null,
    finger_hole_arc_mm: 10, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 4,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null,
    finger_hole_radial_offset_mm: 0, finger_hole_radial_offset_mm_inherited: 0, finger_hole_radial_offset_mm_override: null,
    finger_hole_shape: "circular" as const, finger_hole_shape_inherited: "circular" as const, finger_hole_shape_override: null,
    finger_hole_length_mm: 16, finger_hole_length_mm_inherited: 16, finger_hole_length_mm_override: null,
    finger_hole_width_mm: 10, finger_hole_width_mm_inherited: 10, finger_hole_width_mm_override: null,
    finger_hole_corner_radius_mm: 2, finger_hole_corner_radius_mm_inherited: 2, finger_hole_corner_radius_mm_override: null,
    finger_holes: [[0, -5, 4]] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-a": baseTool("tool-a", "Wrench", 0),
  "tool-b": baseTool("tool-b", "Pliers", 40),
};

function buildResponse(
  ids: string[], placements: Placement[] | null | undefined, overrides: CombineToolOverride[] | null | undefined,
) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id];
    const placement = placements?.find((p) => p.id === id);
    const override = overrides?.find((o) => o.id === id);
    const shape = override?.finger_hole_shape ?? base.finger_hole_shape;
    const length = override?.finger_hole_length_mm ?? base.finger_hole_length_mm;
    const width = override?.finger_hole_width_mm ?? base.finger_hole_width_mm;
    const cornerRadius = override?.finger_hole_corner_radius_mm ?? base.finger_hole_corner_radius_mm;
    const diameter = shape === "rounded_rect" ? Math.hypot(length, width) : (override?.finger_hole_diameter_mm ?? base.finger_holes[0]?.[2] ?? 4);
    return {
      ...base,
      tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot,
      finger_hole_shape: shape, finger_hole_shape_override: override?.finger_hole_shape ?? null,
      finger_hole_length_mm: length, finger_hole_length_mm_override: override?.finger_hole_length_mm ?? null,
      finger_hole_width_mm: width, finger_hole_width_mm_override: override?.finger_hole_width_mm ?? null,
      finger_hole_corner_radius_mm: cornerRadius, finger_hole_corner_radius_mm_override: override?.finger_hole_corner_radius_mm ?? null,
      finger_holes: base.finger_holes.map(([x, y]) => [x, y, diameter] as [number, number, number]),
    };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function fingerCircle(): SVGCircleElement {
  return document.querySelector('circle[stroke-dasharray="2 1"]')!;
}
function fingerPolygon(): SVGPolygonElement | null {
  return document.querySelector('polygon[stroke-dasharray="2 1"]');
}
function shapeButton(label: "Circular" | "Rounded rect"): HTMLButtonElement {
  return screen.getByText(label).closest("button") as HTMLButtonElement;
}
function listRow(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const row = matches.find((el) => el.className.includes("font-bold"));
  if (!row) throw new Error(`no tool-list row found for "${label}"`);
  return row;
}

describe("CombineEditor finger-hole shape", () => {
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
    if (typeof (globalThis as unknown as { PointerEvent?: unknown }).PointerEvent === "undefined") {
      class PointerEventPolyfill extends MouseEvent {
        pointerId: number;
        constructor(type: string, params: PointerEventInit = {}) {
          super(type, params);
          this.pointerId = params.pointerId ?? 0;
        }
      }
      (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
    }
  });

  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (ids, options) => Promise.resolve(buildResponse(ids, options?.placements, options?.overrides)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin));
  });

  afterEach(() => cleanup());

  it("shows a Diameter input for the default circular shape, and renders as a circle", async () => {
    render(<CombineEditor ids={["tool-a"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });

    expect(screen.getByLabelText(/diameter/i)).toBeTruthy();
    expect(screen.queryByLabelText(/length/i)).toBeNull();
    expect(fingerPolygon()).toBeNull();
    expect(shapeButton("Circular").getAttribute("aria-pressed")).toBe("true");
  });

  it("switching to Rounded rect swaps Diameter for Length/Width/Corner radius and renders as a polygon", async () => {
    render(<CombineEditor ids={["tool-a"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });

    fireEvent.click(shapeButton("Rounded rect"));

    expect(shapeButton("Rounded rect").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByLabelText(/diameter/i)).toBeNull();
    expect(screen.getByLabelText(/length/i)).toBeTruthy();
    expect(screen.getByLabelText(/^finger hole width/i)).toBeTruthy();
    expect(screen.getByLabelText(/corner radius/i)).toBeTruthy();
    expect(fingerPolygon()).not.toBeNull();
  });

  it("switching back to Circular restores the circle render and the original diameter", async () => {
    render(<CombineEditor ids={["tool-a"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    const before = { r: Number(fingerCircle().getAttribute("r")) };

    fireEvent.click(shapeButton("Rounded rect"));
    expect(fingerPolygon()).not.toBeNull();
    fireEvent.click(shapeButton("Circular"));

    expect(fingerPolygon()).toBeNull();
    expect(Number(fingerCircle().getAttribute("r"))).toBeCloseTo(before.r);
  });

  it("typing a new length or width changes the rendered polygon", async () => {
    render(<CombineEditor ids={["tool-a"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.click(shapeButton("Rounded rect"));
    const before = fingerPolygon()!.getAttribute("points");

    fireEvent.change(screen.getByLabelText(/length/i), { target: { value: "40" } });

    const after = fingerPolygon()!.getAttribute("points");
    expect(after).not.toBe(before);
  });

  it("Copy style copies the shape and its dimensions onto the target tool", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.click(shapeButton("Rounded rect"));
    fireEvent.change(screen.getByLabelText(/length/i), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText(/^finger hole width/i), { target: { value: "12" } });

    fireEvent.click(listRow("Wrench"));
    fireEvent.click(listRow("Pliers"), { shiftKey: true });
    fireEvent.click(screen.getByText("⎘ Copy style"));

    // Both tools' finger holes should now render as polygons — the base's
    // shape (and its length/width) made it onto the target, not just its
    // on/off + diameter (which is all Copy style used to thread).
    await waitFor(() => {
      const polygons = document.querySelectorAll('polygon[stroke-dasharray="2 1"]');
      expect(polygons.length).toBe(2);
    });
  });
});
