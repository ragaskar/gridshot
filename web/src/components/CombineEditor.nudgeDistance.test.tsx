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

// A 20x10mm rectangle centered on each tool's own origin — tool-a at
// tx=-15 places it at x in [-25,-5]; tool-b at tx=15 places it at x in
// [5,25] — a clean 10mm gap between them along the x axis, nothing above
// or below either one.
const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number, ty = 0) {
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
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function listRow(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const row = matches.find((el) => el.className.includes("font-bold"));
  if (!row) throw new Error(`no tool-list row found for "${label}"`);
  return row;
}

describe("CombineEditor nudge-distance annotation", () => {
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

  it("shows the gap distance after nudging a single selected tool toward its neighbor", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const arrangeArea = document.querySelector("svg")!.parentElement!;
    expect(screen.queryByText(/mm$/, { selector: "text" })).toBeNull();

    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" }); // default nudge step 0.1mm: 10mm gap -> 9.9mm
    expect(screen.getByText("9.90 mm")).toBeTruthy();
  });

  it("also shows the opposite-direction distance, to whatever lies (or the grid edge) the other way", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const arrangeArea = document.querySelector("svg")!.parentElement!;
    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" });
    // Toward tool-b (right): 9.90mm. Away from it (left, nothing there): the
    // grid's own left edge.
    expect(screen.getByText("9.90 mm")).toBeTruthy();
    expect(screen.getByText("16.80 mm")).toBeTruthy();
  });

  it("bolds both lines when the two distances come out equal", async () => {
    const bases = [
      baseTool("tool-a", "Wrench", -39.9),
      baseTool("tool-b", "Pliers", 0),
      baseTool("tool-c", "Hammer", 40.1),
    ];
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) => Promise.resolve(buildResponse(options?.overrides, options?.placements, bases)),
    );
    render(<CombineEditor ids={["tool-a", "tool-b", "tool-c"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Pliers");
    fireEvent.click(listRow("Pliers"));

    const arrangeArea = document.querySelector("svg")!.parentElement!;
    // Starts 0.1mm off-center between its two neighbors; one nudge right
    // (default step 0.1mm) lands it exactly centered — both gaps equal.
    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" });
    expect(screen.getAllByText("20.00 mm")).toHaveLength(2);
    const boldLines = [...document.querySelectorAll("line")].filter(
      (l) => l.getAttribute("stroke-width") === "0.8",
    );
    expect(boldLines).toHaveLength(2);
  });

  it("updates the distance on a second consecutive nudge instead of clearing it", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const arrangeArea = document.querySelector("svg")!.parentElement!;
    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" });
    expect(screen.getByText("9.90 mm")).toBeTruthy();
    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" });
    expect(screen.queryByText("9.90 mm")).toBeNull();
    expect(screen.getByText("9.80 mm")).toBeTruthy();
  });

  it("clears the annotation on a non-nudge action (rotate)", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const arrangeArea = document.querySelector("svg")!.parentElement!;
    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" });
    expect(screen.getByText("9.90 mm")).toBeTruthy();

    fireEvent.click(screen.getByText("+1°"));
    expect(screen.queryByText("9.90 mm")).toBeNull();
  });

  it("clears the annotation on deselect", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const arrangeArea = document.querySelector("svg")!.parentElement!;
    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" });
    expect(screen.getByText("9.90 mm")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("9.90 mm")).toBeNull();
  });

  it("shows no annotation while multiple tools are nudged together", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    fireEvent.click(listRow("Pliers"), { shiftKey: true });

    const arrangeArea = document.querySelector("svg")!.parentElement!;
    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" });
    expect(screen.queryByText(/mm$/, { selector: "text" })).toBeNull();
  });

  it("falls back to the grid edge in both directions when no tool lies along the nudged axis", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const arrangeArea = document.querySelector("svg")!.parentElement!;
    fireEvent.keyDown(arrangeArea, { key: "ArrowUp" }); // nothing above or below tool-a — just the grid edges
    expect(screen.getByText("15.70 mm")).toBeTruthy();
    expect(screen.getByText("15.80 mm")).toBeTruthy();
  });
});
