// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  listBinProfiles: vi.fn(),
}));

import { combinePreview, combinePreviewGlb, duplicateTool, listBinProfiles, saveBin } from "../api";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
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
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

const TOOL_POOL: Record<string, ReturnType<typeof baseTool>> = {
  "tool-a": baseTool("tool-a", "Wrench", -15),
  "tool-b": baseTool("tool-b", "Pliers", 15),
  "bintool-1-aaaaaa": baseTool("bintool-1-aaaaaa", "Wrench (copy)", 45),
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

const DUPLICATED_TOOL: LibraryTool = {
  id: "bintool-1-aaaaaa", label: "Wrench (copy)", grid_x: 2, grid_y: 1,
  thickness_mm: 4, silhouette_height_mm: 20, full_height_mm: null, clearance_mm: 1,
  fill_height_pct: 100, live_grid: false, pocket_depth_mm: null, derived_pocket_depth_mm: 10,
  derived_height_u: 3, derived_overall_height_mm: 25.4, derived_key: "bintool-1-aaaaaa-key",
  derived_reserved_cells: [], derived_available_cells: [],
  lip: true, round_tool: false, finger_hole: false, magnet_holes: false,
  magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2,
  has_photo: false, source_project: "", source_tool: "",
  created_ts: 0, thumb: "", photo_thumb: null,
  readiness: readiness(), provenance: null, outline_revision: 0,
};

describe("CombineEditor Duplicate", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (ids, options) => Promise.resolve(buildResponse(ids, options?.placements, options?.fillHeightPct ?? 100)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    vi.mocked(duplicateTool).mockReset();
    vi.mocked(saveBin).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows Duplicate only when exactly one tool is selected", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    expect(screen.queryByText("⧉ Duplicate")).toBeNull();

    fireEvent.click(screen.getByText("Wrench"));

    expect(await screen.findByText("⧉ Duplicate")).toBeTruthy();
  });

  it("forks the selected tool and adds it to the bin, independently selected", async () => {
    vi.mocked(duplicateTool).mockResolvedValue(DUPLICATED_TOOL);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));

    fireEvent.click(await screen.findByText("⧉ Duplicate"));

    await waitFor(() => expect(duplicateTool).toHaveBeenCalledWith("tool-a"));
    await screen.findAllByText("Wrench (copy)");
    const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
    expect(last[0]).toEqual(["tool-a", "tool-b", "bintool-1-aaaaaa"]);
  });

  it("undoing a Duplicate removes the forked tool from the bin again", async () => {
    vi.mocked(duplicateTool).mockResolvedValue(DUPLICATED_TOOL);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    fireEvent.click(await screen.findByText("⧉ Duplicate"));
    await screen.findAllByText("Wrench (copy)");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.queryAllByText("Wrench (copy)")).toHaveLength(0));
    const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
    expect(last[0]).toEqual(["tool-a", "tool-b"]);
  });

  it("includes the duplicated tool's id when saving to the Bin Library", async () => {
    vi.mocked(duplicateTool).mockResolvedValue(DUPLICATED_TOOL);
    vi.mocked(saveBin).mockResolvedValue({
      id: "bin-1", label: "My Bin", created_ts: 0,
      tool_ids: ["tool-a", "tool-b", "bintool-1-aaaaaa"],
      tool_labels: ["Wrench", "Pliers", "Wrench (copy)"],
      placements: [], overrides: [], overall_height: null, lip: true, fill_height_pct: 100, live_grid: false,
      magnet_holes: false, magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2,
      force_gx: null, force_gy: null, removed_cells: null,
      lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
      min_wall_mm: null, min_floor_mm: null, floor_thickness_mm: null, tool_wall_mm: null,
      tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null, edge_margin_mm: null,
      magnet_hole_inset_from_edge_mm: null, applied_profile_id: null,
    });
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    fireEvent.click(await screen.findByText("⧉ Duplicate"));
    await screen.findAllByText("Wrench (copy)");

    fireEvent.click(screen.getByText("💾 Save to Bin Library"));
    fireEvent.click(screen.getByText("Save As"));

    await waitFor(() => expect(saveBin).toHaveBeenCalled());
    const [, ids] = vi.mocked(saveBin).mock.calls[0];
    expect(ids).toEqual(["tool-a", "tool-b", "bintool-1-aaaaaa"]);
  });
});
