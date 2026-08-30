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

import { combinePreview, combinePreviewGlb, duplicateTool, listBinProfiles, overwriteBin, saveBin } from "../api";
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
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
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
  magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2, magnet_corners_only: false,
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
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
  });

  it("enables Duplicate only when exactly one tool is selected", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    // Tool config's Shape subsection stays mounted (disabled) rather than
    // disappearing when nothing is selected — Duplicate is always present.
    expect((screen.getByText("⧉ Duplicate") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("Wrench"));

    await waitFor(() => expect((screen.getByText("⧉ Duplicate") as HTMLButtonElement).disabled).toBe(false));
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
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    // The mount-time auto-mint already called saveBin once, with just
    // tool-a/tool-b — clear it so the assertion below is unambiguously
    // about the *post-duplicate* save.
    await waitFor(() => expect(saveBin).toHaveBeenCalled());
    vi.mocked(saveBin).mockClear();

    fireEvent.click(screen.getByText("Wrench"));
    fireEvent.click(await screen.findByText("⧉ Duplicate"));
    await screen.findAllByText("Wrench (copy)");

    fireEvent.click(screen.getByText("Save As…"));
    fireEvent.click(screen.getByText("Save As"));

    await waitFor(() => expect(saveBin).toHaveBeenCalled());
    const [, ids] = vi.mocked(saveBin).mock.calls[0];
    expect(ids).toEqual(["tool-a", "tool-b", "bintool-1-aaaaaa"]);
  });
});
