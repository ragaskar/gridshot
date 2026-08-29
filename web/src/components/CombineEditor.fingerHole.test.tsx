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
import { mockPassthroughSaves } from "./combineTestSupport";

// 20x10 rect, perimeter 60: edge0 (-10,-5)->(10,-5) arc[0,20] (bottom edge,
// midpoint arc 10), edge1 (10,-5)->(10,5) arc[20,30] (right edge), edge2
// (10,5)->(-10,5) arc[30,50] (top edge, midpoint arc 40), edge3
// (-10,5)->(-10,-5) arc[50,60] (left edge, midpoint arc 55).
const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number, ty: number, fingerHole: boolean) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_pct: null, depth_pct_override: null, depth_kind: "auto" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: fingerHole, finger_hole: fingerHole, finger_hole_inherited: fingerHole, finger_hole_override: null,
    // Starts at the bottom edge's midpoint (arc 10, world (0,-5)).
    finger_hole_arc_mm: fingerHole ? 10 : 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null, finger_hole_radial_offset_mm: 0, finger_hole_radial_offset_mm_inherited: 0, finger_hole_radial_offset_mm_override: null,
    finger_holes: (fingerHole ? [[0, -5, 4]] : []) as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
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
  // Same rectangle, rotated 180° — world (0, 5) instead of tool-a's (0, -5)
  // for the same arc-10 local point. Used to check that keyboard nudging
  // stays screen-relative instead of following the tool's own rotation.
  "tool-rot180": { ...baseTool("tool-rot180", "Upside-down", 0, 0, true), rot: 180 },
  // Post-fork identities Save mints for tool-a/tool-b (see saveThenEdit.test.tsx)
  // — needed so a test that saves and lets adoptSavedBinIds reload doesn't
  // silently degrade to a blank, no-finger-hole tool for the new ids.
  "bintool-a": baseTool("bintool-a", "Wrench", 0, 0, true),
  "bintool-b": baseTool("bintool-b", "Pliers", 40, 0, false),
};

function buildResponse(ids: string[], placements: Placement[] | null | undefined) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id] ?? baseTool(id, id, 0, 0, false);
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
function magnetHolesCheckbox(): HTMLInputElement {
  return screen.getByText("Magnet holes").previousElementSibling as HTMLInputElement;
}
function binRect(): SVGRectElement {
  return document.querySelector("svg rect")!;
}
function arrangeDiv(): HTMLElement {
  return document.querySelector('div[tabindex="0"]')!;
}
function allFingerCircles(): SVGCircleElement[] {
  return Array.from(document.querySelectorAll("circle"));
}
function undoButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
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
    mockPassthroughSaves(vi.mocked(saveBin));
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
    // Selecting tools no longer enables Align — select the finger holes
    // directly instead: tool-span's P1 (plain click), then tool-single's
    // one hole (shift-click, adds it to the multi-selection).
    const before = visibleFingerCircles();
    const refP1 = { cx: Number(before[0].getAttribute("cx")), cy: Number(before[0].getAttribute("cy")) };
    fireEvent.pointerDown(before[0], { clientX: refP1.cx, clientY: -refP1.cy, pointerId: 1 });
    const targetPos = { cx: Number(before[2].getAttribute("cx")), cy: Number(before[2].getAttribute("cy")) };
    fireEvent.pointerDown(before[2], { clientX: targetPos.cx, clientY: -targetPos.cy, pointerId: 2, shiftKey: true });
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

  it("nudging one tool's finger hole, then another's within the coalescing window, undoes only the second one", async () => {
    render(<CombineEditor ids={["tool-a", "tool-single"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    // tool-a's hole: world (0, -5).
    fireEvent.pointerDown(allFingerCircles()[0], { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.keyDown(arrangeDiv(), { key: "ArrowRight" });
    const aAfterFirstNudge = {
      cx: Number(allFingerCircles()[0].getAttribute("cx")),
      cy: Number(allFingerCircles()[0].getAttribute("cy")),
    };

    // Immediately (same coalescing window), select and nudge tool-single's
    // hole instead — world (8, 15) (tx=8, ty=20; local point (0, -5)).
    fireEvent.pointerDown(allFingerCircles()[1], { clientX: 8, clientY: 15, pointerId: 2 });
    const bBefore = {
      cx: Number(allFingerCircles()[1].getAttribute("cx")),
      cy: Number(allFingerCircles()[1].getAttribute("cy")),
    };
    fireEvent.keyDown(arrangeDiv(), { key: "ArrowRight" });
    const bAfter = {
      cx: Number(allFingerCircles()[1].getAttribute("cx")),
      cy: Number(allFingerCircles()[1].getAttribute("cy")),
    };
    expect(bAfter.cx).not.toBeCloseTo(bBefore.cx);

    fireEvent.click(undoButton());

    // A single undo should only revert tool-single's nudge (the most recent
    // discrete action) — tool-a's earlier, already-committed nudge must survive.
    expect(Number(allFingerCircles()[1].getAttribute("cx"))).toBeCloseTo(bBefore.cx);
    expect(Number(allFingerCircles()[0].getAttribute("cx"))).toBeCloseTo(aAfterFirstNudge.cx);
  });

  it("a finger-hole drag survives a load() that was already in flight", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    // Defer the *next* combinePreview call (the magnet-holes toggle's load())
    // so it's still in flight when the drag below commits.
    let resolveDeferred: () => void;
    const deferred = new Promise<void>((resolve) => { resolveDeferred = resolve; });
    vi.mocked(combinePreview).mockImplementationOnce(
      (ids, options) => deferred.then(() => buildResponse(ids, options?.placements)),
    );

    fireEvent.click(magnetHolesCheckbox()); // starts a load() that won't resolve yet
    expect(magnetHolesCheckbox().disabled).toBe(true); // busy

    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.pointerMove(document.querySelector("svg")!, { clientX: -10, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(document.querySelector("svg")!, { pointerId: 1 });

    const draggedCx = Number(fingerCircle().getAttribute("cx"));
    const draggedCy = Number(fingerCircle().getAttribute("cy"));
    expect(draggedCx).toBeCloseTo(-10); // the drag applied locally, mid-flight

    resolveDeferred!();
    await waitFor(() => expect(magnetHolesCheckbox().disabled).toBe(false)); // load() settled

    // The drag must survive the in-flight load() resolving after it, not get
    // silently overwritten by the stale response it was built from.
    expect(Number(fingerCircle().getAttribute("cx"))).toBeCloseTo(draggedCx);
    expect(Number(fingerCircle().getAttribute("cy"))).toBeCloseTo(draggedCy);
  });

  it("a finger-hole nudge is picked up by the next 3D preview request", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    vi.mocked(combinePreviewGlb).mockClear();

    fireEvent.pointerDown(allFingerCircles()[0], { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.keyDown(arrangeDiv(), { key: "ArrowRight" });

    await waitFor(() => expect(combinePreviewGlb).toHaveBeenCalled(), { timeout: 2000 });

    const [, options] = vi.mocked(combinePreviewGlb).mock.calls.at(-1)!;
    const overrideA = options?.overrides?.find((o) => o.id === "tool-a");
    expect(overrideA?.finger_hole_arc_mm).toBeCloseTo(10.1);
  });

  it("a finger-hole mouse drag is picked up by the next 3D preview request", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    vi.mocked(combinePreviewGlb).mockClear();

    fireEvent.pointerDown(allFingerCircles()[0], { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.pointerMove(document.querySelector("svg")!, { clientX: -10, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(document.querySelector("svg")!, { pointerId: 1 });

    await waitFor(() => expect(combinePreviewGlb).toHaveBeenCalled(), { timeout: 2000 });

    const [, options] = vi.mocked(combinePreviewGlb).mock.calls.at(-1)!;
    const overrideA = options?.overrides?.find((o) => o.id === "tool-a");
    // Dragged to the left edge's midpoint (world (-10, 0)) — edge3 runs
    // (-10,5)->(-10,-5), arc [50,60], so its midpoint is arc 55.
    expect(overrideA?.finger_hole_arc_mm).toBeCloseTo(55);
  });

  it("a finger-hole nudge is included in what gets sent to Save", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalled()); // mount-time auto-mint

    fireEvent.pointerDown(allFingerCircles()[0], { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.keyDown(arrangeDiv(), { key: "ArrowRight" });

    fireEvent.click(screen.getByText("Save As…"));
    fireEvent.click(screen.getByText("Save As"));
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(2));

    const [, , options] = vi.mocked(saveBin).mock.calls.at(-1)!;
    const overrideA = options?.overrides?.find((o) => o.id === "tool-a");
    expect(overrideA?.finger_hole_arc_mm).toBeCloseTo(10.1);
  });

  it("a finger-hole mouse drag is included in what gets sent to Save", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalled()); // mount-time auto-mint

    fireEvent.pointerDown(allFingerCircles()[0], { clientX: 0, clientY: -5, pointerId: 1 });
    fireEvent.pointerMove(document.querySelector("svg")!, { clientX: -10, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(document.querySelector("svg")!, { pointerId: 1 });

    fireEvent.click(screen.getByText("Save As…"));
    fireEvent.click(screen.getByText("Save As"));
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(2));

    const [, , options] = vi.mocked(saveBin).mock.calls.at(-1)!;
    const overrideA = options?.overrides?.find((o) => o.id === "tool-a");
    // Dragged to the left edge's midpoint (world (-10, 0)) — arc 55, same
    // target as the "picked up by the next 3D preview request" drag test.
    expect(overrideA?.finger_hole_arc_mm).toBeCloseTo(55);
  });

  it("Align finger holes is included in what gets sent to Save", async () => {
    render(<CombineEditor ids={["tool-span", "tool-single"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Vise");
    await waitFor(() => expect(saveBin).toHaveBeenCalled()); // mount-time auto-mint

    const before = visibleFingerCircles();
    const refP1 = { cx: Number(before[0].getAttribute("cx")), cy: Number(before[0].getAttribute("cy")) };
    fireEvent.pointerDown(before[0], { clientX: refP1.cx, clientY: -refP1.cy, pointerId: 1 });
    const targetPos = { cx: Number(before[2].getAttribute("cx")), cy: Number(before[2].getAttribute("cy")) };
    fireEvent.pointerDown(before[2], { clientX: targetPos.cx, clientY: -targetPos.cy, pointerId: 2, shiftKey: true });
    fireEvent.click(screen.getByText("⟷ Align finger holes"));

    const alignedTarget = visibleFingerCircles()[2];
    const alignedCx = Number(alignedTarget.getAttribute("cx"));

    fireEvent.click(screen.getByText("Save As…"));
    fireEvent.click(screen.getByText("Save As"));
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(2));

    const [, , options] = vi.mocked(saveBin).mock.calls.at(-1)!;
    const overrideSingle = options?.overrides?.find((o) => o.id === "tool-single");
    // tool-single's saved override must reflect the post-Align arc-length,
    // not its pre-align one (arc 15, world (8,15) area) or null (unset).
    expect(overrideSingle?.finger_hole_arc_mm).not.toBeNull();
    const { pointAtArcLength } = await import("../geometry/perimeter");
    const [lx] = pointAtArcLength([[-10, -5], [10, -5], [10, 5], [-10, 5]], overrideSingle!.finger_hole_arc_mm!);
    const worldX = 8 + lx; // tool-single's tx offset, rot=0/no mirror
    expect(worldX).toBeCloseTo(alignedCx, 0);
  });

  it("ArrowRight moves the hole toward screen-right even on a tool rotated 180°", async () => {
    render(<CombineEditor ids={["tool-rot180"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Upside-down");
    // World (0, 5) — the bottom-edge midpoint (arc 10), flipped by the 180°
    // rotation to what is now the top edge.
    fireEvent.pointerDown(fingerCircle(), { clientX: 0, clientY: 5, pointerId: 1 });
    const before = { cx: Number(fingerCircle().getAttribute("cx")), cy: Number(fingerCircle().getAttribute("cy")) };

    fireEvent.keyDown(arrangeDiv(), { key: "ArrowRight" });

    // Same screen-right sense as the unrotated case (world x increases),
    // regardless of which way this increases/decreases the tool's own
    // local arc-length parametrization.
    const after = fingerCircle();
    expect(Number(after.getAttribute("cx"))).toBeGreaterThan(before.cx);
    expect(Number(after.getAttribute("cy"))).toBeCloseTo(before.cy);
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
