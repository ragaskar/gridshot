// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { LibraryTool, Placement } from "../api";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
  overwriteBin: vi.fn(),
  createToolshape: vi.fn(),
  updateToolshape: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import {
  combinePreview, combinePreviewGlb, listBinProfiles, overwriteBin, saveBin, updateToolshape,
} from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];
// 30x30, centred at origin like the server's own toolshape outline.
const TOOLSHAPE_STAMP: [number, number][] = [[-15, -15], [15, -15], [15, 15], [-15, 15]];

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
    toolshape_type: null as "rounded_rect" | null,
    toolshape_width_mm: null as number | null,
    toolshape_length_mm: null as number | null,
    toolshape_radius_mm: null as number | null,
    toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

// Placed at (20, 10) — right edge at world (35, 10), top edge at world (20, 25).
function toolshapeTool(id: string, withFingerHole = false) {
  return {
    ...baseTool(id, "Rounded Rectangle", 20),
    ty: 10,
    toolshape_type: "rounded_rect" as const,
    toolshape_width_mm: 30, toolshape_length_mm: 30, toolshape_radius_mm: 1,
    toolshape_fillet_bottom: false,
    stamp: TOOLSHAPE_STAMP,
    finger_hole: withFingerHole,
    finger_hole_inherited: withFingerHole,
    // Right edge midpoint (local (15, 0), world (35, 10)) — same edge the
    // width-resize handle sits on, so the hide-during-drag test can tell.
    finger_hole_arc_mm: withFingerHole ? 45 : 0,
    finger_holes: (withFingerHole ? [[35, 10, 4]] : []) as [number, number, number][],
  };
}

const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-a": baseTool("tool-a", "Wrench", -40),
  "bintool-1-aaaaaa": toolshapeTool("bintool-1-aaaaaa"),
  "bintool-2-hole": toolshapeTool("bintool-2-hole", true),
  // Centred at the origin, rotated 90° — its local "right" (width) edge now
  // sits along world +y instead of world +x, so this catches a resize that
  // only works for an unrotated tool.
  "bintool-3-rot90": { ...toolshapeTool("bintool-3-rot90"), tx: 0, ty: 0, rot: 90 },
};

function buildResponse(ids: string[], placements: Placement[] | null | undefined) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id] ?? baseTool(id, id, 0);
    const placement = placements?.find((p) => p.id === id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function handle(testid: string): SVGLineElement {
  return document.querySelector(`[data-testid="${testid}"]`) as unknown as SVGLineElement;
}
function svg(): SVGSVGElement {
  return document.querySelector("svg")!;
}

describe("CombineEditor toolshape edge-drag-resize", () => {
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
      (ids, options) => Promise.resolve(buildResponse(ids, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    vi.mocked(updateToolshape).mockReset();
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
  });

  it("shows resize handles only while the toolshape itself is selected", async () => {
    render(<CombineEditor ids={["tool-a", "bintool-1-aaaaaa"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");
    expect(handle("toolshape-resize-right")).toBeNull();

    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);
    expect(handle("toolshape-resize-right")).not.toBeNull();

    fireEvent.click(screen.getByText("Wrench"));
    expect(handle("toolshape-resize-right")).toBeNull();
  });

  it("dragging the right edge changes only width, not length", async () => {
    vi.mocked(updateToolshape).mockResolvedValue({ ...TOOL_POOL["bintool-1-aaaaaa"], id: "bintool-1-aaaaaa" } as never);
    render(<CombineEditor ids={["tool-a", "bintool-1-aaaaaa"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");
    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);

    fireEvent.pointerDown(handle("toolshape-resize-right"), { pointerId: 1 });
    // Not yet committed mid-drag.
    fireEvent.pointerMove(svg(), { clientX: 50, clientY: -10, pointerId: 1 });
    expect(updateToolshape).not.toHaveBeenCalled();

    fireEvent.pointerUp(svg(), { pointerId: 1 });
    await waitFor(() => expect(updateToolshape).toHaveBeenCalledWith("bintool-1-aaaaaa", { width_mm: 60 }));
  });

  it("dragging the top edge changes only length, not width", async () => {
    vi.mocked(updateToolshape).mockResolvedValue({ ...TOOL_POOL["bintool-1-aaaaaa"], id: "bintool-1-aaaaaa" } as never);
    render(<CombineEditor ids={["tool-a", "bintool-1-aaaaaa"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");
    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);

    fireEvent.pointerDown(handle("toolshape-resize-top"), { pointerId: 1 });
    // World (20, 40) — local ly = 40 - 10 = 30, so new length = 60.
    fireEvent.pointerMove(svg(), { clientX: 20, clientY: -40, pointerId: 1 });
    fireEvent.pointerUp(svg(), { pointerId: 1 });

    await waitFor(() => expect(updateToolshape).toHaveBeenCalledWith("bintool-1-aaaaaa", { length_mm: 60 }));
  });

  it("a plain click on a handle with no movement does not resize", async () => {
    render(<CombineEditor ids={["tool-a", "bintool-1-aaaaaa"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");
    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);

    fireEvent.pointerDown(handle("toolshape-resize-right"), { pointerId: 1 });
    fireEvent.pointerUp(svg(), { pointerId: 1 });

    expect(updateToolshape).not.toHaveBeenCalled();
  });

  it("resizes correctly on a rotated toolshape — the right handle still drives width, not length", async () => {
    vi.mocked(updateToolshape).mockResolvedValue({ ...TOOL_POOL["bintool-3-rot90"], id: "bintool-3-rot90" } as never);
    render(<CombineEditor ids={["tool-a", "bintool-3-rot90"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");
    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);
    expect(handle("toolshape-resize-right").style.cursor).toBe("ns-resize");

    fireEvent.pointerDown(handle("toolshape-resize-right"), { pointerId: 1 });
    // At rot=90, the local "right" (width) edge now runs along world +y —
    // world (0, 25) is local (25, 0), so width should become 50.
    fireEvent.pointerMove(svg(), { clientX: 0, clientY: -25, pointerId: 1 });
    fireEvent.pointerUp(svg(), { pointerId: 1 });

    await waitFor(() => expect(updateToolshape).toHaveBeenCalledWith("bintool-3-rot90", { width_mm: 50 }));
  });

  it("floors the dragged dimension above zero instead of letting it collapse", async () => {
    vi.mocked(updateToolshape).mockResolvedValue({ ...TOOL_POOL["bintool-1-aaaaaa"], id: "bintool-1-aaaaaa" } as never);
    render(<CombineEditor ids={["tool-a", "bintool-1-aaaaaa"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");
    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);

    fireEvent.pointerDown(handle("toolshape-resize-right"), { pointerId: 1 });
    // Dragged past the tool's own centre (world (20, 10), local (0, 0)) —
    // width_mm must never reach 0 (the server rejects it).
    fireEvent.pointerMove(svg(), { clientX: 20, clientY: -10, pointerId: 1 });
    fireEvent.pointerUp(svg(), { pointerId: 1 });

    await waitFor(() => expect(updateToolshape).toHaveBeenCalledWith("bintool-1-aaaaaa", { width_mm: 1 }));
  });

  it("hides the toolshape's finger hole for the duration of the drag, then shows it again", async () => {
    let resolveUpdate: (v: LibraryTool) => void = () => {};
    vi.mocked(updateToolshape).mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
    render(<CombineEditor ids={["tool-a", "bintool-2-hole"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");
    expect(document.querySelectorAll("circle").length).toBe(1);

    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);
    fireEvent.pointerDown(handle("toolshape-resize-right"), { pointerId: 1 });
    fireEvent.pointerMove(svg(), { clientX: 50, clientY: -10, pointerId: 1 });
    expect(document.querySelectorAll("circle").length).toBe(0);

    fireEvent.pointerUp(svg(), { pointerId: 1 });
    // Still hidden — the PATCH's round-trip (load()) hasn't resolved yet.
    expect(document.querySelectorAll("circle").length).toBe(0);

    resolveUpdate({ ...TOOL_POOL["bintool-2-hole"], id: "bintool-2-hole" } as unknown as LibraryTool);
    await waitFor(() => expect(document.querySelectorAll("circle").length).toBe(1));
  });
});
