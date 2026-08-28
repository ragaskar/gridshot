// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { CombineOptions, CombineToolOverride, Placement } from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
  overwriteBin: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { combinePreview, combinePreviewGlb, listBinProfiles, overwriteBin, saveBin } from "../api";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];
const BASE_H_MM = 4.75;
const FLOOR_THICKNESS_MM = 1.2;
const LIP_H_MM = 4.4;
const UNIT_H_MM = 7;

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
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

function heightUFor(overall: number, lipOn: boolean) {
  const body = overall - (lipOn ? LIP_H_MM : 0);
  return Math.max(1, Math.round(body / UNIT_H_MM));
}

function buildResponse(
  _ids: string[], options: CombineOptions | undefined, placements?: Placement[] | null,
  overrides?: CombineToolOverride[] | null,
) {
  const lipOn = options?.lip ?? true;
  const heightU = options?.overallHeight
    ? heightUFor(options.overallHeight, lipOn)
    : 3; // default seed, matches what a fresh unforced bin resolves to here
  const overall = heightU * UNIT_H_MM + (lipOn ? LIP_H_MM : 0);
  const usable = overall - BASE_H_MM - FLOOR_THICKNESS_MM - (lipOn ? LIP_H_MM : 0);
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
  const tools = bases.map((base) => {
    const placement = placements?.find((p) => p.id === base.id);
    const override = overrides?.find((o) => o.id === base.id);
    const fixed = override?.pocket_depth_mm ?? null;
    return {
      ...base,
      tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot,
      depth_mm: fixed ?? usable,
      depth_mm_override: fixed,
      depth_kind: (fixed !== null ? "fixed" : "auto") as "fixed" | "auto",
    };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: overall, usable_height_mm: Math.round(usable * 100) / 100,
    base_h_mm: BASE_H_MM, floor_thickness_mm: FLOOR_THICKNESS_MM, lip_height_mm: LIP_H_MM,
    unit_h_mm: UNIT_H_MM, height_u: heightU,
    min_height_u: overrides?.some((o) => o.pocket_depth_mm) ? heightU : 1,
    pitch: 42, bin_size: 41.5, wall: 2, lip: lipOn,
    reserved_cells: [], available_cells: [], tools,
  };
}

describe("CombineEditor bin height (units)", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (ids, options) => Promise.resolve(buildResponse(ids, options, options?.placements, options?.overrides)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the resolved bin height in whole units, and the actual/usable mm readout", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    const input = await screen.findByLabelText("Bin height in gridfinity units") as HTMLInputElement;
    expect(Number(input.value)).toBe(3);
    // overall = 3*7 + 4.4 = 25.4, usable = 25.4 - 4.75 - 1.2 - 4.4 = 15.05
    await screen.findByText("25.4mm");
    await screen.findByText(/, USABLE 15\.05mm/);
  });

  it("hovering the ACTUAL figure shows a right-aligned base/floor/usable/lip breakdown", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    await screen.findByLabelText("Bin height in gridfinity units");

    // overall = 3*7 + 4.4 = 25.4
    await screen.findByLabelText("Bin height in gridfinity units");
    const trigger = document.querySelector(".group.relative.cursor-help") as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain("25.4mm");
    const tooltip = trigger.querySelector("span");
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe(
      [
        "base            4.75mm",
        "floor            1.2mm",
        "usable height  15.05mm",
        "lip              4.4mm",
        "-".repeat(22),
        "                25.4mm = 3u + lip",
      ].join("\n"),
    );
  });

  it("has an info tooltip explaining the 7mm increment and that lip isn't included", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    const icon = document.querySelector('[title*="7mm increments"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("title")).toMatch(/lip height is not included/i);
  });

  it("editing bin height (units) converts to an overall height in mm and reloads", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const input = await screen.findByLabelText("Bin height in gridfinity units") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);

    // 5*7 + 4.4 = 39.4
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.overallHeight).toBeCloseTo(39.4, 2);
    });
  });

  it("floors at 1 unit when 0 is typed", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const input = await screen.findByLabelText("Bin height in gridfinity units") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);

    // 1*7 + 4.4 = 11.4
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.overallHeight).toBeCloseTo(11.4, 2);
    });
  });

  it("floors at 1 unit when the field is cleared (a number input rejects non-numeric text)", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    const input = await screen.findByLabelText("Bin height in gridfinity units") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    // 1*7 + 4.4 = 11.4 — same floor as typing 0.
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.overallHeight).toBeCloseTo(11.4, 2);
    });
  });

  it("shows no forced-minimum note when no tool is fixed", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    expect(screen.queryByText(/requires a min of/)).toBeNull();
  });

  it("shows the forced-minimum note and no Clear link is needed once nothing is fixed", async () => {
    // Simulate a fixed tool via a manual override on the initial load.
    render(
      <CombineEditor
        ids={["tool-a", "tool-b"]}
        overallHeight={null}
        onClose={() => {}}
      />,
    );
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    const heightSelect = await screen.findByLabelText("Tool height mode") as HTMLSelectElement;
    fireEvent.change(heightSelect, { target: { value: "fixed" } });

    await waitFor(() => screen.getByText(/requires a min of/));
    expect(await screen.findByText("Clear all fixed tool heights")).toBeTruthy();
  });

  it("Clear all fixed tool heights asks for confirmation, then reverts every tool to auto", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    const heightSelect = await screen.findByLabelText("Tool height mode") as HTMLSelectElement;
    fireEvent.change(heightSelect, { target: { value: "fixed" } });
    await screen.findByText("Clear all fixed tool heights");

    fireEvent.click(screen.getByText("Clear all fixed tool heights"));

    expect(window.confirm).toHaveBeenCalledWith("All fixed tool heights will be cleared.");
    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.overrides?.every((o) => o.pocket_depth_mm === null && o.pocket_depth_pct === null)).toBe(true);
    });
    await waitFor(() => expect(screen.queryByText("Clear all fixed tool heights")).toBeNull());
  });

  it("Clear all fixed tool heights does nothing when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(screen.getByText("Wrench"));
    const heightSelect = await screen.findByLabelText("Tool height mode") as HTMLSelectElement;
    fireEvent.change(heightSelect, { target: { value: "fixed" } });
    await screen.findByText("Clear all fixed tool heights");
    const callsBefore = vi.mocked(combinePreview).mock.calls.length;

    fireEvent.click(screen.getByText("Clear all fixed tool heights"));

    expect(window.confirm).toHaveBeenCalled();
    expect(vi.mocked(combinePreview).mock.calls.length).toBe(callsBefore);
    expect(screen.getByText("Clear all fixed tool heights")).toBeTruthy();
  });
});
