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

import { combinePreview, combinePreviewGlb, listBinProfiles, saveBin } from "../api";
import { mockPassthroughSaves } from "./combineTestSupport";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];
const USABLE_HEIGHT_MM = 18.45;

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: USABLE_HEIGHT_MM, depth_mm_inherited: 9.5, depth_mm_override: null,
    depth_pct: null, depth_pct_override: null, depth_kind: "auto" as const,
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

/** Mimics the server's depth resolution closely enough to exercise the
 *  client round trip: fixed mm override wins, else percentage-of-usable-
 *  height, else 100% of usable height ("auto") — same precedence as
 *  gridshot/server/app.py's _combine_layout. */
function buildResponse(overrides: CombineToolOverride[] | null | undefined, placements: Placement[] | null | undefined) {
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
  const tools = bases.map((base) => {
    const override = overrides?.find((o) => o.id === base.id);
    const placement = placements?.find((p) => p.id === base.id);
    const depth_mm_override = override?.pocket_depth_mm ?? null;
    const depth_pct_override = override?.pocket_depth_pct ?? null;
    const depth_kind: "fixed" | "percentage" | "auto" =
      depth_mm_override !== null ? "fixed" : depth_pct_override !== null ? "percentage" : "auto";
    const depth_pct = depth_kind === "percentage" ? depth_pct_override : null;
    const depth_mm =
      depth_kind === "fixed" ? depth_mm_override!
      : depth_kind === "percentage" ? (depth_pct! / 100) * USABLE_HEIGHT_MM
      : USABLE_HEIGHT_MM;
    return {
      ...base,
      tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot,
      depth_mm, depth_mm_override, depth_pct, depth_pct_override, depth_kind,
    };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, usable_height_mm: USABLE_HEIGHT_MM, base_h_mm: 4.75, floor_thickness_mm: 1.2,
    lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function listRow(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const row = matches.find((el) => el.className.includes("font-bold"));
  if (!row) throw new Error(`no tool-list row found for "${label}"`);
  return row;
}

describe("CombineEditor tool height mode (auto/fixed/percentage)", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (_ids, options) => Promise.resolve(buildResponse(options?.overrides, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin));
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to Auto with no numeric input shown", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const select = await screen.findByLabelText("Tool height mode") as HTMLSelectElement;
    expect(select.value).toBe("auto");
    expect(screen.queryByLabelText("Fixed pocket depth in millimetres")).toBeNull();
    expect(screen.queryByLabelText("Pocket depth as a percentage of usable bin height")).toBeNull();
  });

  it("switching to Fixed seeds the tool's own inherited depth and commits immediately", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    const select = await screen.findByLabelText("Tool height mode") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "fixed" } });

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      const override = last[1]?.overrides?.find((o) => o.id === "tool-a");
      expect(override?.pocket_depth_mm).toBe(9.5); // depth_mm_inherited
      expect(override?.pocket_depth_pct).toBeNull();
    });
    const mmInput = await screen.findByLabelText("Fixed pocket depth in millimetres") as HTMLInputElement;
    expect(Number(mmInput.value)).toBe(9.5);
  });

  it("typing a fixed mm value updates the override", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    fireEvent.change(await screen.findByLabelText("Tool height mode"), { target: { value: "fixed" } });
    const mmInput = await screen.findByLabelText("Fixed pocket depth in millimetres") as HTMLInputElement;

    fireEvent.change(mmInput, { target: { value: "12" } });
    fireEvent.blur(mmInput);

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      const override = last[1]?.overrides?.find((o) => o.id === "tool-a");
      expect(override?.pocket_depth_mm).toBe(12);
    });
  });

  it("switching to Percentage seeds 100% and commits immediately", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    const select = await screen.findByLabelText("Tool height mode") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "percentage" } });

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      const override = last[1]?.overrides?.find((o) => o.id === "tool-a");
      expect(override?.pocket_depth_pct).toBe(100);
      expect(override?.pocket_depth_mm).toBeNull();
    });
    const pctInput = await screen.findByLabelText("Pocket depth as a percentage of usable bin height") as HTMLInputElement;
    expect(Number(pctInput.value)).toBe(100);
  });

  it("typing a percentage shows the resulting mm figure", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    fireEvent.change(await screen.findByLabelText("Tool height mode"), { target: { value: "percentage" } });
    const pctInput = await screen.findByLabelText("Pocket depth as a percentage of usable bin height") as HTMLInputElement;

    fireEvent.change(pctInput, { target: { value: "50" } });
    fireEvent.blur(pctInput);

    // 50% of 18.45 usable mm = 9.225
    await screen.findByText("9.225 mm");
  });

  it("switching Fixed -> Percentage clears the mm override, and vice versa", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    fireEvent.change(await screen.findByLabelText("Tool height mode"), { target: { value: "fixed" } });
    await waitFor(() => screen.getByLabelText("Fixed pocket depth in millimetres"));

    fireEvent.change(await screen.findByLabelText("Tool height mode"), { target: { value: "percentage" } });

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      const override = last[1]?.overrides?.find((o) => o.id === "tool-a");
      expect(override?.pocket_depth_mm).toBeNull();
      expect(override?.pocket_depth_pct).toBe(100);
    });
  });

  it("switching back to Auto clears both overrides", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    fireEvent.change(await screen.findByLabelText("Tool height mode"), { target: { value: "fixed" } });
    await waitFor(() => screen.getByLabelText("Fixed pocket depth in millimetres"));

    fireEvent.change(await screen.findByLabelText("Tool height mode"), { target: { value: "auto" } });

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      const override = last[1]?.overrides?.find((o) => o.id === "tool-a");
      expect(override?.pocket_depth_mm).toBeNull();
      expect(override?.pocket_depth_pct).toBeNull();
    });
    expect(screen.queryByLabelText("Fixed pocket depth in millimetres")).toBeNull();
  });

  it("keeps showing the percentage after deselect/reselect", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    fireEvent.change(await screen.findByLabelText("Tool height mode"), { target: { value: "percentage" } });
    const pctInput = await screen.findByLabelText("Pocket depth as a percentage of usable bin height") as HTMLInputElement;
    fireEvent.change(pctInput, { target: { value: "50" } });
    fireEvent.blur(pctInput);
    await waitFor(async () => {
      expect((await screen.findByLabelText("Pocket depth as a percentage of usable bin height") as HTMLInputElement).value).toBe("50");
    });

    // The Shape subsection stays mounted (disabled) rather than disappearing
    // when nothing is selected — the percentage field itself does unmount,
    // since it's gated on the deselected tool's own depth_kind.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect((screen.getByLabelText("Tool height mode") as HTMLSelectElement).disabled).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText("Pocket depth as a percentage of usable bin height")).toBeNull());
    fireEvent.click(listRow("Wrench"));

    const reopened = await screen.findByLabelText("Pocket depth as a percentage of usable bin height") as HTMLInputElement;
    expect(reopened.value).toBe("50");
  });

  it("multi-select: picking Fixed starts an uncommitted draft, not an immediate save", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));
    fireEvent.click(listRow("Pliers"), { shiftKey: true });
    const callsBefore = vi.mocked(combinePreview).mock.calls.length;

    fireEvent.change(await screen.findByLabelText("Tool height mode"), { target: { value: "fixed" } });

    // both tools shared the same inherited value (9.5) — seeded, but not
    // yet committed to the server.
    expect(vi.mocked(combinePreview).mock.calls.length).toBe(callsBefore);
    const mmInput = await screen.findByLabelText("Fixed pocket depth in millimetres") as HTMLInputElement;
    expect(mmInput.value).toBe("9.5");

    fireEvent.change(mmInput, { target: { value: "15" } });
    fireEvent.blur(mmInput);

    await waitFor(() => {
      const last = vi.mocked(combinePreview).mock.calls.at(-1)!;
      expect(last[1]?.overrides?.find((o) => o.id === "tool-a")?.pocket_depth_mm).toBe(15);
      expect(last[1]?.overrides?.find((o) => o.id === "tool-b")?.pocket_depth_mm).toBe(15);
    });
  });
});
