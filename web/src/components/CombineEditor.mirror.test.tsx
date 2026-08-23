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

import { combinePreview, combinePreviewGlb, listBinProfiles } from "../api";

// Asymmetric about both axes so mirroring is detectable point-by-point
// (a symmetric rectangle would just permute onto itself).
const STAMP: [number, number][] = [[-10, -2], [6, -2], [6, 3], [-10, 3]];

function baseTool(id: string, label: string, tx: number, ty: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_mode: "automatic" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: false, finger_hole: false, finger_hole_inherited: false, finger_hole_override: null,
    finger_hole_arc_mm: 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
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
    return {
      ...base,
      tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot,
      mirror_x: placement?.mirror_x ?? base.mirror_x, mirror_y: placement?.mirror_y ?? base.mirror_y,
    };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function polygonPts(index: number): [number, number][] {
  const points = document.querySelectorAll("polygon")[index].getAttribute("points")!;
  return points.split(" ").map((p) => {
    const [x, y] = p.split(",").map(Number);
    return [x, y];
  });
}

function mirrorButton(label: RegExp): HTMLButtonElement {
  return screen.getByText(label).closest("button") as HTMLButtonElement;
}

describe("CombineEditor mirror toggle", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (ids, options) => Promise.resolve(buildResponse(ids, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("hides/disables the mirror toggles until exactly one tool is selected", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    expect(mirrorButton(/Mirror horizontal/).disabled).toBe(true);
    expect(mirrorButton(/Mirror vertical/).disabled).toBe(true);

    fireEvent.click(screen.getByText("Wrench"));
    expect(mirrorButton(/Mirror horizontal/).disabled).toBe(false);

    fireEvent.click(screen.getByText("Pliers"), { shiftKey: true });
    expect(mirrorButton(/Mirror horizontal/).disabled).toBe(true);
  });

  it("Mirror horizontal flips the selected tool's local x, leaving y untouched", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    const before = polygonPts(0);

    fireEvent.click(mirrorButton(/Mirror horizontal/));

    const after = polygonPts(0);
    before.forEach(([bx, by], i) => {
      const [ax, ay] = after[i];
      // world x = -local_x + tx (tx = -15, unchanged) → offset from tx flips sign
      expect(ax - -15).toBeCloseTo(-(bx - -15));
      expect(ay).toBeCloseTo(by);
    });
    expect(mirrorButton(/Mirror horizontal/).getAttribute("aria-pressed")).toBe("true");
  });

  it("Mirror vertical flips the selected tool's local y, leaving x untouched", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    const before = polygonPts(0);

    fireEvent.click(mirrorButton(/Mirror vertical/));

    const after = polygonPts(0);
    before.forEach(([bx, by], i) => {
      const [ax, ay] = after[i];
      expect(ax).toBeCloseTo(bx);
      // ty = 0 for tool-a, so world y offset from ty flips sign directly.
      expect(ay).toBeCloseTo(-by);
    });
    expect(mirrorButton(/Mirror vertical/).getAttribute("aria-pressed")).toBe("true");
  });

  it("toggling back off restores the original polygon", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    const before = polygonPts(0);

    fireEvent.click(mirrorButton(/Mirror horizontal/));
    fireEvent.click(mirrorButton(/Mirror horizontal/));

    const after = polygonPts(0);
    before.forEach(([bx, by], i) => {
      expect(after[i][0]).toBeCloseTo(bx);
      expect(after[i][1]).toBeCloseTo(by);
    });
    expect(mirrorButton(/Mirror horizontal/).getAttribute("aria-pressed")).toBe("false");
  });
});
