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

import { combinePreview, combinePreviewGlb, listBinProfiles, saveBin } from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

// Same 20x10 rect convention as CombineEditor.fingerHole.test.tsx: bottom
// edge midpoint is arc 10, world (tx, ty-5).
const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_mode: "automatic" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: true, finger_hole: true, finger_hole_inherited: true, finger_hole_override: null,
    finger_hole_arc_mm: 10, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null,
    finger_holes: [[0, -5, 4]] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-x": baseTool("tool-x", "Wrench", 0),
  "tool-y": baseTool("tool-y", "Pliers", 40),
  "tool-span": {
    ...baseTool("tool-span", "Vise", 80),
    finger_hole_span: true, finger_hole_arc2_mm: 15,
    finger_holes: [[0, -5, 4], [5, -5, 4]] as [number, number, number][],
  },
};

function buildResponse(ids: string[], placements: Placement[] | null | undefined) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id];
    const placement = placements?.find((p) => p.id === id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 4, gy: 2, outer_w: 165, outer_d: 83,
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function listRow(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const row = matches.find((el) => el.className.includes("font-bold"));
  if (!row) throw new Error(`no tool-list row found for "${label}"`);
  return row;
}
function visibleFingerCircles(): SVGCircleElement[] {
  return Array.from(document.querySelectorAll('circle[stroke-dasharray="2 1"]'));
}
function alignButton(): HTMLButtonElement {
  return screen.getByText("⟷ Align finger holes") as HTMLButtonElement;
}
function arrangeDiv(): HTMLElement {
  return document.querySelector('div[tabindex="0"]')!;
}
function circlePos(c: SVGCircleElement) {
  return { cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")) };
}

describe("CombineEditor finger-hole multi-select", () => {
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
    // jsdom has no PointerEvent constructor, so @testing-library/dom's
    // fireEvent.pointer* falls back to a bare Event with no clientX/clientY/
    // shiftKey — a MouseEvent-backed polyfill is the standard workaround
    // (see CombineEditor.fingerHole.test.tsx).
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
    mockPassthroughSaves(vi.mocked(saveBin));
  });

  afterEach(() => cleanup());

  it("shift-click toggles a second finger hole into the selection; a plain click collapses back to one", async () => {
    render(<CombineEditor ids={["tool-x", "tool-y"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const [xHole, yHole] = visibleFingerCircles();
    const xPos = circlePos(xHole), yPos = circlePos(yHole);

    fireEvent.pointerDown(xHole, { clientX: xPos.cx, clientY: -xPos.cy, pointerId: 1 });
    expect(alignButton().disabled).toBe(true); // only one hole selected so far

    fireEvent.pointerDown(yHole, { clientX: yPos.cx, clientY: -yPos.cy, pointerId: 2, shiftKey: true });
    expect(alignButton().disabled).toBe(false); // now 2 holes selected

    // A plain click (no shift) narrows back down to just the clicked hole.
    fireEvent.pointerDown(xHole, { clientX: xPos.cx, clientY: -xPos.cy, pointerId: 3 });
    expect(alignButton().disabled).toBe(true);
  });

  it("tool multi-select alone does not enable Align (the regression this feature fixes)", async () => {
    render(<CombineEditor ids={["tool-x", "tool-y"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(listRow("Wrench"));
    fireEvent.click(listRow("Pliers"), { shiftKey: true });

    expect(screen.queryByText("⟷ Align finger holes")).toBeNull();
    expect(screen.getByText("⎘ Copy style")).toBeTruthy(); // Copy style stays tool-gated
  });

  it("Left/Right nudges every selected hole at once; Up/Down is a no-op in multi-select", async () => {
    render(<CombineEditor ids={["tool-x", "tool-y"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const [xHole, yHole] = visibleFingerCircles();
    const xBefore = circlePos(xHole), yBefore = circlePos(yHole);

    fireEvent.pointerDown(xHole, { clientX: xBefore.cx, clientY: -xBefore.cy, pointerId: 1 });
    fireEvent.pointerDown(yHole, { clientX: yBefore.cx, clientY: -yBefore.cy, pointerId: 2, shiftKey: true });

    fireEvent.keyDown(arrangeDiv(), { key: "ArrowRight" });
    const [xAfter, yAfter] = visibleFingerCircles().map(circlePos);
    expect(xAfter.cx).toBeGreaterThan(xBefore.cx);
    expect(yAfter.cx).toBeGreaterThan(yBefore.cx);

    fireEvent.keyDown(arrangeDiv(), { key: "ArrowUp" });
    const [xAfterUp, yAfterUp] = visibleFingerCircles().map(circlePos);
    expect(xAfterUp).toEqual(xAfter);
    expect(yAfterUp).toEqual(yAfter);
  });

  it("a multi-select bulk nudge moves both lobes of a span hole", async () => {
    render(<CombineEditor ids={["tool-x", "tool-span"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const [xHole, spanP1, spanP2] = visibleFingerCircles();
    const xBefore = circlePos(xHole), p1Before = circlePos(spanP1), p2Before = circlePos(spanP2);

    fireEvent.pointerDown(xHole, { clientX: xBefore.cx, clientY: -xBefore.cy, pointerId: 1 });
    fireEvent.pointerDown(spanP1, { clientX: p1Before.cx, clientY: -p1Before.cy, pointerId: 2, shiftKey: true });

    fireEvent.keyDown(arrangeDiv(), { key: "ArrowRight" });

    const [xAfter, p1After, p2After] = visibleFingerCircles().map(circlePos);
    expect(xAfter.cx).toBeGreaterThan(xBefore.cx);
    expect(p1After.cx).toBeGreaterThan(p1Before.cx);
    expect(p2After.cx).toBeGreaterThan(p2Before.cx);
  });
});
