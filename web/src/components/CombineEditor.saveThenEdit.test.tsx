// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { Placement, ReadinessReport } from "../api";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
  overwriteBin: vi.fn(),
  duplicateTool: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { combinePreview, listBinProfiles, saveBin } from "../api";

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

// "tool-a"/"tool-b" are the raw ids the client sends; saving forks them into
// "bintool-a"/"bintool-b" (mirroring what a real save does), so `combinePreview`
// must be able to answer either id space depending on what's asked for.
const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-a": baseTool("tool-a", "Wrench", -20, 7),
  "tool-b": baseTool("tool-b", "Pliers", 20, -7),
  "bintool-a": baseTool("bintool-a", "Wrench", -20, 7),
  "bintool-b": baseTool("bintool-b", "Pliers", 20, -7),
};

function buildResponse(ids: string[], placements: Placement[] | null | undefined, fillHeightPct: number) {
  const tools = ids.map((id) => {
    const base = TOOL_POOL[id] ?? baseTool(id, id, 0, 0);
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
void readiness;

describe("CombineEditor Save then edit", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (ids, options) => Promise.resolve(buildResponse(ids, options?.placements, options?.fillHeightPct ?? 100)),
    );
    vi.mocked(saveBin).mockReset();
    vi.mocked(listBinProfiles).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the arrangement and forked ids in sync after the mount-time mint, so a later edit doesn't collapse placements", async () => {
    vi.mocked(saveBin).mockResolvedValue({
      id: "bin-1", label: "My Bin", created_ts: 0,
      tool_ids: ["bintool-a", "bintool-b"],
      tool_labels: ["Wrench", "Pliers"],
      placements: [
        { id: "bintool-a", tx: -20, ty: 7, rot: 0, mirror_x: false, mirror_y: false },
        { id: "bintool-b", tx: 20, ty: -7, rot: 0, mirror_x: false, mirror_y: false },
      ],
      overrides: [],
      overall_height: null, lip: true, fill_height_pct: 100, live_grid: false,
      magnet_holes: false, magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2,
      force_gx: null, force_gy: null, removed_cells: null,
      lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
      min_wall_mm: null, min_floor_mm: null, floor_thickness_mm: null, tool_wall_mm: null,
      tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null, edge_margin_mm: null,
      magnet_hole_inset_from_edge_mm: null, applied_profile_id: null,
    });
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    // The mount-time auto-mint already forked tool-a/tool-b into
    // bintool-a/bintool-b (see CombineEditor's mintInitialSave) — wait for
    // that round-trip to land before editing.
    await waitFor(() => expect(saveBin).toHaveBeenCalled());
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[0]).toEqual(["bintool-a", "bintool-b"]);
    });

    const lipCheckbox = screen.getByText("Stacking lip").previousElementSibling as HTMLInputElement;
    fireEvent.click(lipCheckbox);

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[0]).toEqual(["bintool-a", "bintool-b"]);
      const placementIds = (last[1]?.placements ?? []).map((p) => p.id);
      expect(placementIds.sort()).toEqual(["bintool-a", "bintool-b"]);
      const a = last[1]!.placements!.find((p) => p.id === "bintool-a")!;
      expect(a.tx).toBe(-20);
      expect(a.ty).toBe(7);
    });
  });
});
