// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { combinePreview, combinePreviewGlb, listBinProfiles } from "../api";

// 20x10 rect, perimeter 60: edge0 (-10,-5)->(10,-5) arc[0,20] (bottom edge,
// midpoint arc 10), edge1 (10,-5)->(10,5) arc[20,30] (right edge), edge2
// (10,5)->(-10,5) arc[30,50] (top edge, midpoint arc 40), edge3
// (-10,5)->(-10,-5) arc[50,60] (left edge, midpoint arc 55).
const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number, ty: number, fingerHole: boolean) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_mode: "automatic" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: fingerHole, finger_hole: fingerHole, finger_hole_inherited: fingerHole, finger_hole_override: null,
    // Starts at the bottom edge's midpoint (arc 10, world (0,-5)).
    finger_hole_arc_mm: fingerHole ? 10 : 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null,
    finger_holes: (fingerHole ? [[0, -5, 4]] : []) as [number, number, number][],
    derivation_key: `${id}-key`,
    stamp: STAMP,
    tx, ty, rot: 0, mirror_x: false, mirror_y: false,
  };
}

const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-a": baseTool("tool-a", "Wrench", 0, 0, true),
  "tool-b": baseTool("tool-b", "Pliers", 40, 0, false),
  // A span hole (bottom-most, world y=-5) for the align test: P1 at world
  // (0,-5) (arc 10), P2 at world (5,-5) (arc 15) — both on the bottom edge,
  // so the group travels horizontally.
  "tool-span": {
    ...baseTool("tool-span", "Vise", 0, 0, true),
    finger_hole_span: true, finger_hole_arc2_mm: 15,
    finger_holes: [[0, -5, 4], [5, -5, 4]] as [number, number, number][],
  },
  // Single-point hole, off-axis in x and well above tool-span's world y, so
  // it's never the align reference.
  "tool-single": baseTool("tool-single", "Chisel", 8, 20, true),
};

function buildResponse(ids: string[], placements: Placement[] | null | undefined) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id] ?? baseTool(id, id, 0, 0, false);
    const placement = placements?.find((p) => p.id === id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function fingerCircle(): SVGCircleElement {
  return document.querySelector("circle")!;
}
function binRect(): SVGRectElement {
  return document.querySelector("svg rect")!;
}
function arrangeDiv(): HTMLElement {
  return document.querySelector('div[tabindex="0"]')!;
}

describe("CombineEditor finger-hole selection and position editing", () => {
  beforeAll(() => {
    // jsdom has no real SVG geometry math — stub an identity transform so
    // toData(e) resolves to [clientX, -clientY] (matches undoRedo.test.tsx).
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
    // jsdom has no PointerEvent constructor, so @testing-library/dom's
    // fireEvent.pointer* falls back to a bare Event with no clientX/clientY
    // — a MouseEvent-backed polyfill is the standard workaround.
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
      (ids, options) => Promise.resolve(buildResponse(ids, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("clicking the finger hole selects it and deselects a selected tool", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    expect(screen.getByText("⧉ Duplicate")).toBeTruthy();

    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });

    expect(screen.getByText(/— finger hole/)).toBeTruthy();
    expect(screen.queryByText("⧉ Duplicate")).toBeNull();
  });

  it("clicking a tool polygon deselects the finger hole", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    expect(screen.getByText(/— finger hole/)).toBeTruthy();

    fireEvent.click(screen.getByText("Wrench"));

    expect(screen.queryByText(/— finger hole/)).toBeNull();
    expect(screen.getByText("⧉ Duplicate")).toBeTruthy();
  });

  it("shows an X/Y readout consistent with the hole's position relative to the bin's own corner", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });

    const rect = binRect();
    const rectX = Number(rect.getAttribute("x"));
    const rectY = Number(rect.getAttribute("y"));
    const circle = fingerCircle();
    const expectedX = (Number(circle.getAttribute("cx")) - rectX).toFixed(2);
    const expectedY = (Number(circle.getAttribute("cy")) - rectY).toFixed(2);

    expect(screen.getByText(`${expectedX} mm`)).toBeTruthy();
    expect(screen.getByText(`${expectedY} mm`)).toBeTruthy();
  });

  it("dragging the hole projects it onto the tool's outline at the drop point", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    // World (-10, 0) — the left edge's midpoint — clientY=0 maps to world y=0.
    fireEvent.pointerMove(document.querySelector("svg")!, { clientX: -10, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(document.querySelector("svg")!, { pointerId: 1 });

    const circle = fingerCircle();
    expect(Number(circle.getAttribute("cx"))).toBeCloseTo(-10);
    expect(Number(circle.getAttribute("cy"))).toBeCloseTo(0);
  });

  it("ArrowRight/ArrowLeft nudge the hole along the boundary by the nudge step", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    const before = { cx: Number(fingerCircle().getAttribute("cx")), cy: Number(fingerCircle().getAttribute("cy")) };

    fireEvent.keyDown(arrangeDiv(), { key: "ArrowRight" });

    // arc 10 -> 10.1, still on the bottom edge (y=-5): x increases, y unchanged.
    const after = fingerCircle();
    expect(Number(after.getAttribute("cx"))).toBeGreaterThan(before.cx);
    expect(Number(after.getAttribute("cy"))).toBeCloseTo(before.cy);
  });

  it("ArrowUp jumps the hole to the opposite (top) edge; a second ArrowUp is a no-op", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });

    fireEvent.keyDown(arrangeDiv(), { key: "ArrowUp" });

    // Starting at the bottom edge's midpoint (0,-5), "straight across" lands
    // on the top edge's midpoint (0,5) — same world x, opposite side.
    const jumped = fingerCircle();
    expect(Number(jumped.getAttribute("cx"))).toBeCloseTo(0, 0);
    expect(Number(jumped.getAttribute("cy"))).toBeCloseTo(5, 0);

    const afterFirstJump = { cx: Number(jumped.getAttribute("cx")), cy: Number(jumped.getAttribute("cy")) };
    fireEvent.keyDown(arrangeDiv(), { key: "ArrowUp" });

    const stillJumped = fingerCircle();
    expect(Number(stillJumped.getAttribute("cx"))).toBeCloseTo(afterFirstJump.cx);
    expect(Number(stillJumped.getAttribute("cy"))).toBeCloseTo(afterFirstJump.cy);
  });

  it("shows a diameter input seeded from the hole's current diameter, with a 1mm arrow step", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });

    const input = screen.getByLabelText(/diameter/i) as HTMLInputElement;
    expect(input.value).toBe("4");
    expect(input.step).toBe("1");
  });

  it("typing a diameter grows the circle's radius without moving its center", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    const before = { cx: Number(fingerCircle().getAttribute("cx")), cy: Number(fingerCircle().getAttribute("cy")) };

    const input = screen.getByLabelText(/diameter/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "13.7" } });

    const circle = fingerCircle();
    expect(Number(circle.getAttribute("r"))).toBeCloseTo(6.85);
    expect(Number(circle.getAttribute("cx"))).toBeCloseTo(before.cx);
    expect(Number(circle.getAttribute("cy"))).toBeCloseTo(before.cy);
  });

  function visibleFingerCircles(): SVGCircleElement[] {
    return Array.from(document.querySelectorAll('circle[stroke-dasharray="2 1"]'));
  }
  function spanToggleButton(): HTMLElement {
    return screen.getByText("Span both sides").nextElementSibling as HTMLElement;
  }

  it("turning span on adds a second lobe opposite the first; turning it off removes it", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    expect(visibleFingerCircles()).toHaveLength(1);

    fireEvent.click(spanToggleButton());

    const lobes = visibleFingerCircles();
    expect(lobes).toHaveLength(2);
    // Started at the bottom edge's midpoint (0,-5) — opposite lands on the
    // top edge's midpoint (0,5).
    expect(Number(lobes[1].getAttribute("cx"))).toBeCloseTo(0, 0);
    expect(Number(lobes[1].getAttribute("cy"))).toBeCloseTo(5, 0);
    // P1 is unmoved.
    expect(Number(lobes[0].getAttribute("cx"))).toBeCloseTo(0, 0);
    expect(Number(lobes[0].getAttribute("cy"))).toBeCloseTo(-5, 0);

    fireEvent.click(spanToggleButton());
    expect(visibleFingerCircles()).toHaveLength(1);
    const restored = visibleFingerCircles()[0];
    expect(Number(restored.getAttribute("cx"))).toBeCloseTo(0, 0);
    expect(Number(restored.getAttribute("cy"))).toBeCloseTo(-5, 0);
  });

  it("Up/Down becomes a no-op once span is on", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.click(spanToggleButton());
    const before = visibleFingerCircles().map((c) => ({
      cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")),
    }));

    fireEvent.keyDown(arrangeDiv(), { key: "ArrowUp" });

    const after = visibleFingerCircles().map((c) => ({
      cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")),
    }));
    expect(after).toEqual(before);
  });

  it("clicking the second lobe selects it, and Left/Right then only moves that lobe", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.click(spanToggleButton());
    const [lobe1Before, lobe2Before] = visibleFingerCircles().map((c) => ({
      cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")),
    }));
    const lobe2 = visibleFingerCircles()[1];

    fireEvent.pointerDown(lobe2, { clientX: lobe2Before.cx, clientY: -lobe2Before.cy, pointerId: 2 });
    fireEvent.keyDown(arrangeDiv(), { key: "ArrowRight" });

    const [lobe1After, lobe2After] = visibleFingerCircles().map((c) => ({
      cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")),
    }));
    expect(lobe1After).toEqual(lobe1Before);
    expect(lobe2After).not.toEqual(lobe2Before);
  });

  it("Align finger holes: a span reference moves a single-point target's P1 onto its own P1, leaving the reference untouched", async () => {
    render(<CombineEditor ids={["tool-span", "tool-single"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Vise");
    fireEvent.click(screen.getByText("Vise"));
    fireEvent.click(screen.getByText("Chisel"), { shiftKey: true });
    const refLobesBefore = visibleFingerCircles().slice(0, 2).map((c) => ({
      cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")),
    }));

    fireEvent.click(screen.getByText("⟷ Align finger holes"));

    const lobes = visibleFingerCircles();
    // tool-span (the reference — bottom-most) is untouched.
    expect(lobes.slice(0, 2).map((c) => ({
      cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")),
    }))).toEqual(refLobesBefore);
    // tool-single's one point now shares the reference's P1 world x.
    const target = lobes[2];
    expect(Number(target.getAttribute("cx"))).toBeCloseTo(refLobesBefore[0].cx, 0);
  });

  it("Shift+ArrowUp is an explicit no-op, even when a plain ArrowUp would move the hole", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    const before = { cx: Number(fingerCircle().getAttribute("cx")), cy: Number(fingerCircle().getAttribute("cy")) };

    fireEvent.keyDown(arrangeDiv(), { key: "ArrowUp", shiftKey: true });

    const after = fingerCircle();
    expect(Number(after.getAttribute("cx"))).toBeCloseTo(before.cx);
    expect(Number(after.getAttribute("cy"))).toBeCloseTo(before.cy);
  });
});
