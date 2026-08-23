// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number, ty: number) {
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

const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-a": baseTool("tool-a", "Wrench", -15, 0),
  "tool-b": baseTool("tool-b", "Pliers", 15, 20),
};

function buildResponse(ids: string[], placements: Placement[] | null | undefined) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id] ?? baseTool(id, id, 0, 0);
    const placement = placements?.find((p) => p.id === id);
    return { ...base, tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

/** The raw (unmirrored — see the <g transform="scale(1,-1)"> the arrange SVG
 *  draws into) world y-values of a rendered tool polygon's points, so a test
 *  can check the true world-coordinate direction a nudge/align moved it,
 *  independent of how the display happens to mirror things for the screen. */
function polygonYs(index: number): number[] {
  const points = document.querySelectorAll("polygon")[index].getAttribute("points")!;
  return points.split(" ").map((p) => Number(p.split(",")[1]));
}

describe("CombineEditor orientation", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (ids, options) => Promise.resolve(buildResponse(ids, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin));
  });

  afterEach(() => cleanup());

  it("ArrowUp increases ty (moves toward the top of the now-correct top-down view)", async () => {
    const { container } = render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    const before = polygonYs(0);
    const arrangeDiv = container.querySelector('div[tabindex="0"]')!;

    fireEvent.keyDown(arrangeDiv, { key: "ArrowUp" });

    const after = polygonYs(0);
    after.forEach((y, i) => expect(y).toBeGreaterThan(before[i]));
  });

  it("ArrowDown decreases ty (moves toward the bottom)", async () => {
    const { container } = render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    const before = polygonYs(0);
    const arrangeDiv = container.querySelector('div[tabindex="0"]')!;

    fireEvent.keyDown(arrangeDiv, { key: "ArrowDown" });

    const after = polygonYs(0);
    after.forEach((y, i) => expect(y).toBeLessThan(before[i]));
  });

  it("Align Top moves the selection to the max y (tool-a, starting at ty=0, moves up to tool-b's ty=20)", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    fireEvent.click(screen.getByText("Pliers"), { shiftKey: true });

    fireEvent.click(screen.getByText("⇡ Top"));

    // tool-a's stamp centre-y is 0 (STAMP spans y -5..5), so after aligning
    // to tool-b's ty=20 the polygon's own min/max y should be centred on 20.
    const [a, b] = [polygonYs(0), polygonYs(1)];
    expect((Math.min(...a) + Math.max(...a)) / 2).toBeCloseTo((Math.min(...b) + Math.max(...b)) / 2);
  });

  it("Align Bottom moves the selection to the min y (tool-b, starting at ty=20, moves down to tool-a's ty=0)", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    fireEvent.click(screen.getByText("Pliers"), { shiftKey: true });

    fireEvent.click(screen.getByText("Bottom ⇣"));

    const [a, b] = [polygonYs(0), polygonYs(1)];
    expect((Math.min(...a) + Math.max(...a)) / 2).toBeCloseTo(0);
    expect((Math.min(...b) + Math.max(...b)) / 2).toBeCloseTo((Math.min(...a) + Math.max(...a)) / 2);
  });
});
