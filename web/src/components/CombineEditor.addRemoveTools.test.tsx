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
  duplicateTool: vi.fn(),
  listLibrary: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import {
  combinePreview, combinePreviewGlb, duplicateTool, listBinProfiles, listLibrary,
  overwriteBin, saveBin,
} from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_pct: null, depth_pct_override: null, depth_kind: "auto" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: false, finger_hole: false, finger_hole_inherited: false, finger_hole_override: null,
    finger_hole_arc_mm: 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null, finger_hole_radial_offset_mm: 0, finger_hole_radial_offset_mm_inherited: 0, finger_hole_radial_offset_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-a": baseTool("tool-a", "Wrench", -15),
  "tool-b": baseTool("tool-b", "Pliers", 15),
  "tool-picked": baseTool("tool-picked", "Chisel", 20),
};

function buildResponse(ids: string[], placements: Placement[] | null | undefined) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id] ?? baseTool(id, id, 0);
    const placement = placements?.find((p) => p.id === id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4,
    unit_h_mm: 7, height_u: 3, min_height_u: 1,
    pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function readiness(status: "pass" | "block" = "pass"): ReadinessReport {
  return { status, checks: [], metrics: {} };
}

function libraryTool(id: string, label: string, status: "pass" | "block" = "pass"): LibraryTool {
  return {
    id, label, grid_x: 1, grid_y: 1, thickness_mm: 5, silhouette_height_mm: 5, full_height_mm: null,
    clearance_mm: 1, fill_height_pct: 100, live_grid: false, pocket_depth_mm: null,
    derived_pocket_depth_mm: 11.5, derived_height_u: 2, derived_overall_height_mm: 18.4, derived_key: `${id}-key`,
    derived_reserved_cells: [], derived_available_cells: [],
    lip: true, round_tool: false, finger_hole: false, magnet_holes: false,
    magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2,
    has_photo: true, source_project: "", source_tool: "",
    created_ts: 0, thumb: `/thumb/${id}`, photo_thumb: null,
    readiness: readiness(status), provenance: null, outline_revision: 0,
  };
}

const PICKED_TOOL: LibraryTool = libraryTool("lib-chisel", "Chisel");

function svg(): SVGSVGElement {
  return document.querySelector("svg")!;
}

describe("CombineEditor add/remove tools", () => {
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
    vi.mocked(listLibrary).mockReset();
    vi.mocked(duplicateTool).mockReset();
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
  });

  function addToolButton() {
    return screen.getByTitle("Add an existing tool from the Tool Library — placed by clicking the grid");
  }

  it("opens a picker listing the tool library on click", async () => {
    vi.mocked(listLibrary).mockResolvedValue([libraryTool("lib-a", "Chisel"), libraryTool("lib-b", "Awl")]);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(addToolButton());

    await screen.findByText("Add tool from library");
    expect(await screen.findByText("Chisel")).toBeTruthy();
    expect(screen.getByText("Awl")).toBeTruthy();
  });

  it("a blocked tool is disabled in the picker", async () => {
    vi.mocked(listLibrary).mockResolvedValue([libraryTool("lib-blocked", "Broken", "block")]);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(addToolButton());

    const tile = await screen.findByTitle("This tool isn't ready to place — see the Tool Library for details");
    expect((tile as HTMLButtonElement).disabled).toBe(true);
  });

  it("picking a tool arms placement mode and closes the picker", async () => {
    vi.mocked(listLibrary).mockResolvedValue([PICKED_TOOL]);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(addToolButton());
    fireEvent.click(await screen.findByTitle(`Add ${PICKED_TOOL.label}`));

    await waitFor(() => expect(screen.queryByText("Add tool from library")).toBeNull());
    expect(await screen.findByText(`Click the grid to place "${PICKED_TOOL.label}" · Esc to cancel`)).toBeTruthy();
  });

  it("clicking the grid while armed duplicates the tool and places it there", async () => {
    vi.mocked(listLibrary).mockResolvedValue([PICKED_TOOL]);
    vi.mocked(duplicateTool).mockResolvedValue({ ...PICKED_TOOL, id: "bintool-chisel" });
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(addToolButton());
    fireEvent.click(await screen.findByTitle(`Add ${PICKED_TOOL.label}`));
    await screen.findByText(`Click the grid to place "${PICKED_TOOL.label}" · Esc to cancel`);

    fireEvent.pointerDown(svg(), { clientX: 20, clientY: -10 });

    await waitFor(() => expect(duplicateTool).toHaveBeenCalledWith("lib-chisel"));
    const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
    expect(last[0]).toEqual(["tool-a", "tool-b", "bintool-chisel"]);
    const placement = last[1]?.placements?.find((p) => p.id === "bintool-chisel");
    expect(placement).toEqual({ id: "bintool-chisel", tx: 20, ty: 10, rot: 0, mirror_x: false, mirror_y: false });
    expect(screen.queryByText(/Click the grid to place/)).toBeNull();
  });

  it("Escape cancels an armed placement without duplicating anything", async () => {
    vi.mocked(listLibrary).mockResolvedValue([PICKED_TOOL]);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(addToolButton());
    fireEvent.click(await screen.findByTitle(`Add ${PICKED_TOOL.label}`));
    await screen.findByText(`Click the grid to place "${PICKED_TOOL.label}" · Esc to cancel`);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByText(/Click the grid to place/)).toBeNull());
    expect(duplicateTool).not.toHaveBeenCalled();
  });

  it("starting a toolshape placement cancels an in-progress add-tool placement", async () => {
    vi.mocked(listLibrary).mockResolvedValue([PICKED_TOOL]);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(addToolButton());
    fireEvent.click(await screen.findByTitle(`Add ${PICKED_TOOL.label}`));
    await screen.findByText(`Click the grid to place "${PICKED_TOOL.label}" · Esc to cancel`);

    fireEvent.click(screen.getByText("▢ Rounded Rectangle"));

    await waitFor(() => expect(screen.queryByText(/Click the grid to place "Chisel"/)).toBeNull());
    expect(screen.getByText("Click the grid to place · Esc to cancel")).toBeTruthy();
  });

  it("removes the selected tool from the arrangement", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b", "tool-picked"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));

    fireEvent.click(await screen.findByText("🗑 Remove"));

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[0]).toEqual(["tool-b", "tool-picked"]);
    });
  });

  it("disables Remove when it would drop the bin below 2 tools", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));

    const removeBtn = await screen.findByText("🗑 Remove");
    expect((removeBtn.closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
