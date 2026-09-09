// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { CombineToolOverride, Placement } from "../api";
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
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null, finger_hole_radial_offset_mm: 0, finger_hole_radial_offset_mm_inherited: 0, finger_hole_radial_offset_mm_override: null, finger_hole_shape: "circular" as const, finger_hole_shape_inherited: "circular" as const, finger_hole_shape_override: null, finger_hole_length_mm: 16, finger_hole_length_mm_inherited: 16, finger_hole_length_mm_override: null, finger_hole_width_mm: 10, finger_hole_width_mm_inherited: 10, finger_hole_width_mm_override: null, finger_hole_corner_radius_mm: 2, finger_hole_corner_radius_mm_inherited: 2, finger_hole_corner_radius_mm_override: null,
    finger_holes: [] as [number, number, number][],
    derivation_key: `${id}-key`,
    toolshape_type: null, toolshape_width_mm: null, toolshape_length_mm: null,
    toolshape_radius_mm: null, toolshape_fillet_bottom: false,
    stamp: STAMP,
    tx, ty: 0, rot: 0, mirror_x: false, mirror_y: false,
  };
}

function buildResponse(overrides: CombineToolOverride[] | null | undefined, placements: Placement[] | null | undefined) {
  const bases = [baseTool("tool-a", "Wrench", -15), baseTool("tool-b", "Pliers", 15)];
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
    overall_height_mm: 25.4, usable_height_mm: 18.45, base_h_mm: 4.75, floor_thickness_mm: 1.2, lip_height_mm: 4.4, unit_h_mm: 7, height_u: 3, min_height_u: 1, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

describe("CombineEditor notes", () => {
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
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts empty, showing a click-to-add prompt", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    expect(screen.getByText("Click to add notes…")).toBeTruthy();
  });

  it("clicking the notes area switches to an editable, autofocused textarea", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByLabelText("Bin notes — click to edit"));

    const textarea = await screen.findByLabelText("Bin notes") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
  });

  it("renders GitHub-flavored markdown once out of edit mode", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByLabelText("Bin notes — click to edit"));
    const textarea = await screen.findByLabelText("Bin notes") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Heading\n\n- [x] done\n- [ ] todo" } });
    fireEvent.blur(textarea);

    await waitFor(() => expect(screen.queryByLabelText("Bin notes")).toBeNull());
    expect(screen.getByRole("heading", { level: 1, name: "Heading" })).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.some((c) => c.checked)).toBe(true);
    expect(checkboxes.some((c) => !c.checked)).toBe(true);
  });

  it("saves immediately on blur", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText("Bin notes — click to edit"));
    const textarea = await screen.findByLabelText("Bin notes") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "fits the long screwdrivers" } });
    fireEvent.blur(textarea);

    await waitFor(() => expect(overwriteBin).toHaveBeenCalled());
    const lastCall = vi.mocked(overwriteBin).mock.calls.at(-1)!;
    expect(lastCall[4]).toBe("fits the long screwdrivers");
  });

  it("autosaves 5 seconds after typing stops, without needing blur", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");
    await waitFor(() => expect(saveBin).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText("Bin notes — click to edit"));
    const textarea = await screen.findByLabelText("Bin notes") as HTMLTextAreaElement;

    vi.useFakeTimers();
    fireEvent.change(textarea, { target: { value: "auto-saved text" } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(overwriteBin).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3100);
    expect(overwriteBin).toHaveBeenCalledTimes(1);
    const lastCall = vi.mocked(overwriteBin).mock.calls.at(-1)!;
    expect(lastCall[4]).toBe("auto-saved text");
    // Still in edit mode — only blur (or clicking away) re-renders it.
    expect(screen.getByLabelText("Bin notes")).toBeTruthy();
  });

  it("undo restores the previous notes text", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByLabelText("Bin notes — click to edit"));
    const textarea = await screen.findByLabelText("Bin notes") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "first draft" } });
    fireEvent.blur(textarea);
    await waitFor(() => expect(screen.queryByLabelText("Bin notes")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByText("Click to add notes…")).toBeTruthy();
  });

  it("clicking a link inside rendered notes does not enter edit mode", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByLabelText("Bin notes — click to edit"));
    const textarea = await screen.findByLabelText("Bin notes") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "[a link](https://example.com)" } });
    fireEvent.blur(textarea);
    await waitFor(() => expect(screen.queryByLabelText("Bin notes")).toBeNull());

    const link = screen.getByRole("link", { name: "a link" });
    fireEvent.click(link);

    expect(screen.queryByLabelText("Bin notes")).toBeNull();
  });

  it("pressing Enter on a link inside rendered notes does not enter edit mode either", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(screen.getByLabelText("Bin notes — click to edit"));
    const textarea = await screen.findByLabelText("Bin notes") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "[a link](https://example.com)" } });
    fireEvent.blur(textarea);
    await waitFor(() => expect(screen.queryByLabelText("Bin notes")).toBeNull());

    const link = screen.getByRole("link", { name: "a link" });
    fireEvent.keyDown(link, { key: "Enter" });

    expect(screen.queryByLabelText("Bin notes")).toBeNull();
  });

  it("does not autosave with empty placements while a reopened bin's initial load is still pending", async () => {
    // Regression test: reopening sets `savedBinId` synchronously (from
    // `initial.id`), before the manual-placement `load()` below resolves.
    // The geometry-autosave effect used to arm its debounce timer at that
    // same mount, capturing `tools` while it was still `[]` — if the load
    // took longer than the debounce, the stale timer fired with empty
    // placements, and the server auto-packed fresh, ignoring this bin's
    // removed cell and reporting a bogus overlap on a perfectly valid,
    // already-rendered arrangement.
    let resolveFirstPreview: (value: unknown) => void = () => {};
    const firstPreview = new Promise((resolve) => { resolveFirstPreview = resolve; });
    let calls = 0;
    vi.mocked(combinePreview).mockImplementation((_ids, options) => {
      calls += 1;
      if (calls === 1) return firstPreview as ReturnType<typeof combinePreview>;
      return Promise.resolve(buildResponse(options?.overrides, options?.placements));
    });

    render(
      <CombineEditor
        ids={["tool-a", "tool-b"]}
        overallHeight={null}
        onClose={() => {}}
        initial={{
          id: "bin-1", label: "Reopened bin", notes: "", appliedProfileId: null,
          placements: [
            { id: "tool-a", tx: -15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
            { id: "tool-b", tx: 15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
          ],
          overrides: [], fillHeightPct: 100, liveGrid: false, lip: true,
          magnetHoles: false, magnetHoleDiameterMm: 6.5, magnetHoleDepthMm: 2, magnetCornersOnly: false,
          magnetEasyRelease: "off", bevelPockets: true, pocketRoundRadiusMm: 0.6,
          forceGx: null, forceGy: null, removedCells: [[0, 0]],
          lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
          minWallMm: null, minFloorMm: null, floorThicknessMm: null, toolWallMm: null,
          toolWallFlareMm: null, toolWallReinforcementHMm: null, edgeMarginMm: null,
          magnetHoleInsetFromEdgeMm: null,
        }}
      />,
    );

    // Long enough to clear the 1.5s geometry-autosave debounce (and short of
    // the 5s notes one) while the initial load is still hung.
    await new Promise((r) => setTimeout(r, 1700));
    expect(overwriteBin).not.toHaveBeenCalled();

    resolveFirstPreview(buildResponse([], [
      { id: "tool-a", tx: -15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
      { id: "tool-b", tx: 15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
    ]));
    await screen.findByText("Wrench");

    // The real load landed with the exact same recipe that was already
    // persisted (`initial`) — nothing changed, so becoming able to autosave
    // must not itself trigger one. Wait out both debounce windows.
    await new Promise((r) => setTimeout(r, 5500));
    expect(overwriteBin).not.toHaveBeenCalled();

    // A genuine edit now, on the other hand, must still save correctly —
    // with the real placements `tools` settled on, not the empty ones a
    // stale pre-load closure used to send.
    fireEvent.click(screen.getByText("Magnet holes").previousElementSibling as HTMLInputElement);
    await waitFor(() => expect(overwriteBin).toHaveBeenCalled(), { timeout: 3000 });
    const [, , , options] = vi.mocked(overwriteBin).mock.calls[0];
    expect(options?.placements).toEqual([
      { id: "tool-a", tx: -15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
      { id: "tool-b", tx: 15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
    ]);
  }, 15000);

  it("reopening a bin with no edits never autosaves at all", async () => {
    // Becoming *able* to autosave (the mount load settling) used to be
    // itself treated as a reason to autosave — both the geometry and notes
    // effects would arm their very first debounce timer the moment
    // `initialLoadDone` flipped, re-persisting a recipe that was already
    // exactly correct. Two silent, pointless PUTs on every reopen.
    render(
      <CombineEditor
        ids={["tool-a", "tool-b"]}
        overallHeight={null}
        onClose={() => {}}
        initial={{
          id: "bin-1", label: "Reopened bin", notes: "kept notes", appliedProfileId: null,
          placements: [
            { id: "tool-a", tx: -15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
            { id: "tool-b", tx: 15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
          ],
          overrides: [], fillHeightPct: 100, liveGrid: false, lip: true,
          magnetHoles: false, magnetHoleDiameterMm: 6.5, magnetHoleDepthMm: 2, magnetCornersOnly: false,
          magnetEasyRelease: "off", bevelPockets: true, pocketRoundRadiusMm: 0.6,
          forceGx: null, forceGy: null, removedCells: null,
          lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
          minWallMm: null, minFloorMm: null, floorThicknessMm: null, toolWallMm: null,
          toolWallFlareMm: null, toolWallReinforcementHMm: null, edgeMarginMm: null,
          magnetHoleInsetFromEdgeMm: null,
        }}
      />,
    );
    await screen.findByText("Wrench");

    // Past both the 1.5s geometry debounce and the 5s notes debounce.
    await new Promise((r) => setTimeout(r, 5500));

    expect(overwriteBin).not.toHaveBeenCalled();
  }, 10000);

  it("renaming a reopened bin while its initial load is still pending still autosaves the new name", async () => {
    // The bin-name field is disabled only by `!savedBinId`, which a reopen
    // sets synchronously — so, unlike the rest of Bin config, it's editable
    // during the pending load. A rename typed in that window must not get
    // eaten by the geometry-autosave effect's "becoming ready" skip.
    let resolveFirstPreview: (value: unknown) => void = () => {};
    const firstPreview = new Promise((resolve) => { resolveFirstPreview = resolve; });
    let calls = 0;
    vi.mocked(combinePreview).mockImplementation((_ids, options) => {
      calls += 1;
      if (calls === 1) return firstPreview as ReturnType<typeof combinePreview>;
      return Promise.resolve(buildResponse(options?.overrides, options?.placements));
    });

    render(
      <CombineEditor
        ids={["tool-a", "tool-b"]}
        overallHeight={null}
        onClose={() => {}}
        initial={{
          id: "bin-1", label: "Reopened bin", notes: "", appliedProfileId: null,
          placements: [
            { id: "tool-a", tx: -15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
            { id: "tool-b", tx: 15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
          ],
          overrides: [], fillHeightPct: 100, liveGrid: false, lip: true,
          magnetHoles: false, magnetHoleDiameterMm: 6.5, magnetHoleDepthMm: 2, magnetCornersOnly: false,
          magnetEasyRelease: "off", bevelPockets: true, pocketRoundRadiusMm: 0.6,
          forceGx: null, forceGy: null, removedCells: [[0, 0]],
          lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
          minWallMm: null, minFloorMm: null, floorThicknessMm: null, toolWallMm: null,
          toolWallFlareMm: null, toolWallReinforcementHMm: null, edgeMarginMm: null,
          magnetHoleInsetFromEdgeMm: null,
        }}
      />,
    );

    const nameInput = await screen.findByLabelText("Bin name") as HTMLInputElement;
    expect(nameInput.disabled).toBe(false);
    fireEvent.change(nameInput, { target: { value: "Renamed mid-load" } });
    fireEvent.blur(nameInput);

    resolveFirstPreview(buildResponse([], [
      { id: "tool-a", tx: -15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
      { id: "tool-b", tx: 15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
    ]));
    await screen.findByText("Wrench");

    await waitFor(() => expect(overwriteBin).toHaveBeenCalled(), { timeout: 3000 });
    const [, labelArg] = vi.mocked(overwriteBin).mock.calls[0];
    expect(labelArg).toBe("Renamed mid-load");
  }, 15000);

  it("blurring the notes editor while a reopened bin's initial load is still pending does not autosave empty placements", async () => {
    // Same failure mode as the debounce race above, reached a different way:
    // the notes panel renders and is editable immediately, well before the
    // reopen's manual-placement load has to land, so a blur-triggered save
    // can call autoSave() directly while `tools` is still `[]`.
    let resolveFirstPreview: (value: unknown) => void = () => {};
    const firstPreview = new Promise((resolve) => { resolveFirstPreview = resolve; });
    let calls = 0;
    vi.mocked(combinePreview).mockImplementation((_ids, options) => {
      calls += 1;
      if (calls === 1) return firstPreview as ReturnType<typeof combinePreview>;
      return Promise.resolve(buildResponse(options?.overrides, options?.placements));
    });

    render(
      <CombineEditor
        ids={["tool-a", "tool-b"]}
        overallHeight={null}
        onClose={() => {}}
        initial={{
          id: "bin-1", label: "Reopened bin", notes: "", appliedProfileId: null,
          placements: [
            { id: "tool-a", tx: -15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
            { id: "tool-b", tx: 15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
          ],
          overrides: [], fillHeightPct: 100, liveGrid: false, lip: true,
          magnetHoles: false, magnetHoleDiameterMm: 6.5, magnetHoleDepthMm: 2, magnetCornersOnly: false,
          magnetEasyRelease: "off", bevelPockets: true, pocketRoundRadiusMm: 0.6,
          forceGx: null, forceGy: null, removedCells: [[0, 0]],
          lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
          minWallMm: null, minFloorMm: null, floorThicknessMm: null, toolWallMm: null,
          toolWallFlareMm: null, toolWallReinforcementHMm: null, edgeMarginMm: null,
          magnetHoleInsetFromEdgeMm: null,
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Bin notes — click to edit"));
    const textarea = await screen.findByLabelText("Bin notes") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "typed before the load landed" } });
    fireEvent.blur(textarea);

    // The blur's own flush must not persist an emptied-out bin.
    await new Promise((r) => setTimeout(r, 50));
    expect(overwriteBin).not.toHaveBeenCalled();

    resolveFirstPreview(buildResponse([], [
      { id: "tool-a", tx: -15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
      { id: "tool-b", tx: 15, ty: 0, rot: 0, mirror_x: false, mirror_y: false },
    ]));
    await screen.findByText("Wrench");

    // The typed note isn't lost — the notes-autosave effect sees it differs
    // from what's persisted (`initial.notes`) and arms once the real load
    // lands, regardless of geometry being unchanged (see the "does not
    // autosave" test above for that case on its own).
    await waitFor(() => expect(overwriteBin).toHaveBeenCalled(), { timeout: 8000 });
    const [, , , , notesArg] = vi.mocked(overwriteBin).mock.calls[0];
    expect(notesArg).toBe("typed before the load landed");
  }, 15000);

  it("reopening a saved bin shows its existing notes instead of starting blank", async () => {
    render(
      <CombineEditor
        ids={["tool-a", "tool-b"]}
        overallHeight={null}
        onClose={() => {}}
        initial={{
          id: "bin-1", label: "Reopened bin", notes: "kept from before", appliedProfileId: null,
          placements: [], overrides: [], fillHeightPct: 100, liveGrid: false, lip: true,
          magnetHoles: false, magnetHoleDiameterMm: 6.5, magnetHoleDepthMm: 2, magnetCornersOnly: false,
          magnetEasyRelease: "off", bevelPockets: true, pocketRoundRadiusMm: 0.6,
          forceGx: null, forceGy: null, removedCells: null,
          lipHeightMm: null, lipChamferTopMm: null, lipStraightMm: null, lipChamferBottomMm: null,
          minWallMm: null, minFloorMm: null, floorThicknessMm: null, toolWallMm: null,
          toolWallFlareMm: null, toolWallReinforcementHMm: null, edgeMarginMm: null,
          magnetHoleInsetFromEdgeMm: null,
        }}
      />,
    );
    await screen.findByText("Wrench");

    expect(screen.getByText("kept from before")).toBeTruthy();
    expect(screen.queryByText("Click to add notes…")).toBeNull();
  });
});
