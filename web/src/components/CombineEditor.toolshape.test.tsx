// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { LibraryTool, Placement, ReadinessReport } from "../api";

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
  combinePreview, combinePreviewGlb, createToolshape, listBinProfiles,
  overwriteBin, saveBin, updateToolshape,
} from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];
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

function toolshapeTool(id: string, tx: number, ty: number) {
  return {
    ...baseTool(id, "Rounded Rectangle", tx),
    ty,
    toolshape_type: "rounded_rect" as const,
    toolshape_width_mm: 30, toolshape_length_mm: 30, toolshape_radius_mm: 1,
    toolshape_fillet_bottom: false,
    stamp: TOOLSHAPE_STAMP,
  };
}

const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-a": baseTool("tool-a", "Wrench", -15),
  "tool-b": baseTool("tool-b", "Pliers", 15),
  "bintool-1-aaaaaa": toolshapeTool("bintool-1-aaaaaa", 20, 10),
};

function buildResponse(ids: string[], placements: Placement[] | null | undefined, fillHeightPct: number) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id] ?? baseTool(id, id, 0);
    const placement = placements?.find((p) => p.id === id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: fillHeightPct, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function readiness(): ReadinessReport {
  return { status: "pass", checks: [], metrics: {} };
}

const CREATED_TOOLSHAPE: LibraryTool = {
  id: "bintool-1-aaaaaa", label: "Rounded Rectangle", grid_x: 1, grid_y: 1,
  thickness_mm: 20, silhouette_height_mm: 20, full_height_mm: null, clearance_mm: 1,
  fill_height_pct: 100, live_grid: false, pocket_depth_mm: null, derived_pocket_depth_mm: 41.5,
  derived_height_u: 7, derived_overall_height_mm: 53.4, derived_key: "bintool-1-aaaaaa-key",
  derived_reserved_cells: [], derived_available_cells: [],
  lip: true, round_tool: false, finger_hole: false, magnet_holes: false,
  magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2,
  has_photo: false, source_project: "", source_tool: "",
  created_ts: 0, thumb: "", photo_thumb: null,
  readiness: readiness(), provenance: null, outline_revision: 0,
};

describe("CombineEditor toolshapes", () => {
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
    // fireEvent.pointer* falls back to a bare Event with no clientX/clientY
    // — a MouseEvent-backed polyfill is the standard workaround (see
    // CombineEditor.fingerHole.test.tsx).
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
      (ids, options) => Promise.resolve(buildResponse(ids, options?.placements, options?.fillHeightPct ?? 100)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    vi.mocked(createToolshape).mockReset();
    vi.mocked(updateToolshape).mockReset();
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
  });

  it("clicking the palette control opens the param panel with defaults", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByText("▢ Rounded Rectangle"));

    expect((await screen.findByLabelText("New toolshape width in millimetres") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("New toolshape length in millimetres") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("New toolshape corner radius in millimetres") as HTMLInputElement).value).toBe("1");
    expect(screen.getByText("Click the grid to place · Esc to cancel")).toBeTruthy();
  });

  it("Escape cancels placement mode without creating anything", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("▢ Rounded Rectangle"));
    await screen.findByLabelText("New toolshape width in millimetres");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByLabelText("New toolshape width in millimetres")).toBeNull());
    expect(createToolshape).not.toHaveBeenCalled();
  });

  it("clicking the canvas creates the toolshape at that point and selects it", async () => {
    vi.mocked(createToolshape).mockResolvedValue(CREATED_TOOLSHAPE);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("▢ Rounded Rectangle"));
    await screen.findByLabelText("New toolshape width in millimetres");
    const svg = document.querySelector("svg")!;

    fireEvent.pointerDown(svg, { clientX: 20, clientY: -10 });

    await waitFor(() => expect(createToolshape).toHaveBeenCalledWith({
      width_mm: 30, length_mm: 30, radius_mm: 1, fillet_bottom: false,
    }));
    await screen.findAllByText("Rounded Rectangle");
    const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
    expect(last[0]).toEqual(["tool-a", "tool-b", "bintool-1-aaaaaa"]);
    const placement = last[1]?.placements?.find((p) => p.id === "bintool-1-aaaaaa");
    expect(placement).toEqual({ id: "bintool-1-aaaaaa", tx: 20, ty: 10, rot: 0, mirror_x: false, mirror_y: false });
    // placement mode exits after a successful placement (the width field
    // shown now belongs to the newly-placed tool's own inspector instead)
    expect(screen.queryByText("Click the grid to place · Esc to cancel")).toBeNull();
    expect(screen.getByText("▢ Rounded Rectangle").className).not.toContain("btn-primary");
  });

  it("placing on top of an existing tool still commits, instead of selecting that tool", async () => {
    vi.mocked(createToolshape).mockResolvedValue(CREATED_TOOLSHAPE);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("▢ Rounded Rectangle"));
    await screen.findByLabelText("New toolshape width in millimetres");

    // Click directly on an existing tool's own polygon — its onPointerDown
    // must defer to placement mode instead of selecting that tool and
    // swallowing the click.
    const existingPolygon = document.querySelector("polygon")!;
    fireEvent.pointerDown(existingPolygon, { clientX: -15, clientY: 0 });

    await waitFor(() => expect(createToolshape).toHaveBeenCalledWith({
      width_mm: 30, length_mm: 30, radius_mm: 1, fillet_bottom: false,
    }));
    // Placement mode closed and the *new* toolshape is what's selected now,
    // not the existing tool the click happened to land on.
    expect(screen.queryByText("Click the grid to place · Esc to cancel")).toBeNull();
    await screen.findByLabelText("Toolshape width in millimetres");
  });

  it("editing the panel's params before placement changes what gets created", async () => {
    vi.mocked(createToolshape).mockResolvedValue(CREATED_TOOLSHAPE);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("▢ Rounded Rectangle"));
    const widthInput = await screen.findByLabelText("New toolshape width in millimetres");
    const filletCheckbox = screen.getByText("Fillet bottom").previousElementSibling as HTMLInputElement;

    fireEvent.change(widthInput, { target: { value: "50" } });
    fireEvent.click(filletCheckbox);
    fireEvent.pointerDown(document.querySelector("svg")!, { clientX: 0, clientY: 0 });

    await waitFor(() => expect(createToolshape).toHaveBeenCalledWith({
      width_mm: 50, length_mm: 30, radius_mm: 1, fillet_bottom: true,
    }));
  });

  it("shows the rounded-rectangle inspector fields when a toolshape is selected", async () => {
    render(<CombineEditor ids={["tool-a", "bintool-1-aaaaaa"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");

    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);

    expect((await screen.findByLabelText("Toolshape width in millimetres") as HTMLInputElement).value).toBe("30");
    // the normal tool controls (rotation etc.) still show alongside it
    expect(screen.getByText("⧉ Duplicate")).toBeTruthy();
  });

  it("does not show toolshape fields for a plain tool", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByText("Wrench"));

    await screen.findByText("⧉ Duplicate");
    expect(screen.queryByLabelText("Toolshape width in millimetres")).toBeNull();
  });

  it("editing a placed toolshape's width patches it and reloads the layout", async () => {
    vi.mocked(updateToolshape).mockResolvedValue({ ...CREATED_TOOLSHAPE, id: "bintool-1-aaaaaa" });
    render(<CombineEditor ids={["tool-a", "bintool-1-aaaaaa"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");
    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);
    const widthInput = await screen.findByLabelText("Toolshape width in millimetres");

    fireEvent.change(widthInput, { target: { value: "50" } });
    fireEvent.blur(widthInput);

    await waitFor(() => expect(updateToolshape).toHaveBeenCalledWith("bintool-1-aaaaaa", { width_mm: 50 }));
  });

  it("resizing a toolshape asks the server to preserve every tool's placement", async () => {
    vi.mocked(updateToolshape).mockResolvedValue({ ...CREATED_TOOLSHAPE, id: "bintool-1-aaaaaa" });
    render(<CombineEditor ids={["tool-a", "bintool-1-aaaaaa"]} overallHeight={null} onClose={() => {}} />);
    await screen.findAllByText("Rounded Rectangle");
    fireEvent.click(screen.getAllByText("Rounded Rectangle")[0]);
    const widthInput = await screen.findByLabelText("Toolshape width in millimetres");

    fireEvent.change(widthInput, { target: { value: "50" } });
    fireEvent.blur(widthInput);

    await waitFor(() => expect(updateToolshape).toHaveBeenCalled());
    const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
    expect(last[1]?.preservePlacements).toBe(true);
  });
});
