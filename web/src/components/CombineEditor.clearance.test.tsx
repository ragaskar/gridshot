// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { CombineToolOverride, Placement } from "../api";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { combinePreview, combinePreviewGlb, listBinProfiles } from "../api";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_mode: "automatic" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: false, finger_hole: false, finger_hole_inherited: false, finger_hole_override: null,
    finger_hole_side: "center" as const, finger_hole_offset_mm_max: 0,
    finger_hole_side_flip: false, finger_hole_side_flip_override: null,
    finger_hole_offset_mm: 0, finger_hole_offset_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    stamp: STAMP,
    tx, ty: 0, rot: 0,
  };
}

/** Mimics the server's override-echo behaviour closely enough to exercise
 *  the client round trip realistically: applies each override's clearance_mm
 *  (when non-null) onto the matching base tool, otherwise leaves it inherited. */
function buildResponse(overrides: CombineToolOverride[] | null | undefined, placements: Placement[] | null | undefined) {
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
  const tools = bases.map((base) => {
    const override = overrides?.find((o) => o.id === base.id);
    const placement = placements?.find((p) => p.id === base.id);
    const clearance_mm_override = override?.clearance_mm ?? null;
    return {
      ...base,
      tx: placement?.tx ?? base.tx,
      ty: placement?.ty ?? base.ty,
      rot: placement?.rot ?? base.rot,
      clearance_mm: clearance_mm_override ?? base.clearance_mm_inherited,
      clearance_mm_override,
    };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

/** The tool-list row's name span — distinct from the Inspector header, which
 *  also shows the selected tool's label once something is selected. */
function listRow(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const row = matches.find((el) => el.className.includes("font-bold"));
  if (!row) throw new Error(`no tool-list row found for "${label}"`);
  return row;
}

describe("CombineEditor clearance override", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) =>
        Promise.resolve(buildResponse(options?.overrides, options?.placements)),
    );
    // The debounced 3D-preview effect fires regardless of which view tab is
    // active; give it a resolvable Blob so it doesn't throw on an unmocked call.
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("persists a typed clearance value and keeps showing it after deselect/reselect", async () => {
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />,
    );

    // wait for the initial auto-pack load to land
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const clearanceInput = await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement;
    expect(clearanceInput.value).toBe("1");

    fireEvent.change(clearanceInput, { target: { value: "2.5" } });
    fireEvent.blur(clearanceInput);

    await waitFor(async () => {
      const input = await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement;
      expect(input.value).toBe("2.5");
    });

    // deselect (Esc clears selection), then reselect the same tool
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Clearance override in millimetres")).toBeNull());

    fireEvent.click(listRow("Wrench"));

    const reopened = await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement;
    expect(reopened.value).toBe("2.5");
  });

  it("keeps showing the override after switching to a different tool and back", async () => {
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />,
    );
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const clearanceInput = await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement;
    fireEvent.change(clearanceInput, { target: { value: "2.5" } });
    fireEvent.blur(clearanceInput);
    await waitFor(async () => {
      expect((await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement).value).toBe("2.5");
    });

    // switch selection to tool-b, then back to tool-a
    fireEvent.click(listRow("Pliers"));
    await waitFor(async () => {
      const input = await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement;
      expect(input.value).toBe("1");
    });
    fireEvent.click(listRow("Wrench"));

    const backToA = await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement;
    expect(backToA.value).toBe("2.5");
  });

  it("updates the bottom tool-list summary's displayed clearance", async () => {
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />,
    );
    await screen.findByText("Wrench");
    expect(screen.getAllByText("Clearance 1 mm")).toHaveLength(2); // both start at the inherited default

    fireEvent.click(listRow("Wrench"));
    const clearanceInput = await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement;
    fireEvent.change(clearanceInput, { target: { value: "2.5" } });
    fireEvent.blur(clearanceInput);

    await waitFor(() => {
      // Wrench's row now reads 2.5mm; Pliers' is untouched at 1mm.
      expect(screen.getAllByText("Clearance 2.5 mm")).toHaveLength(1);
      expect(screen.getAllByText("Clearance 1 mm")).toHaveLength(1);
    });
  });

  it("persists a clearance value changed via the native change event without a blur (spin buttons)", async () => {
    // A number input's spin buttons fire a native `change` event immediately
    // without blurring the field — unlike typing, which only commits on
    // blur. Firing `change` alone (no `blur`) reproduces that.
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />,
    );
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const clearanceInput = await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement;
    fireEvent.change(clearanceInput, { target: { value: "2.5" } });

    await waitFor(() => {
      expect(screen.getAllByText("Clearance 2.5 mm")).toHaveLength(1);
    });
  });

  it("applies a multi-select clearance override to both tools", async () => {
    render(
      <CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />,
    );
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    fireEvent.click(listRow("Pliers"), { shiftKey: true });

    const clearanceInput = await screen.findByLabelText("Clearance override in millimetres") as HTMLInputElement;
    expect(clearanceInput.value).toBe("1"); // both start equal (inherited)
    fireEvent.change(clearanceInput, { target: { value: "3" } });
    fireEvent.blur(clearanceInput);

    // both rows should now read 3mm, not just one
    await waitFor(() => {
      expect(screen.getAllByText("Clearance 3 mm")).toHaveLength(2);
    });
  });
});
