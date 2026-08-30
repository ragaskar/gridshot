// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
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

function blankResponse() {
  return {
    fill_height_pct: 100, live_grid: false, gx: 1, gy: 5, outer_w: 41.5, outer_d: 213.5,
    overall_height_mm: 11.4, usable_height_mm: 1.05, base_h_mm: 4.75, floor_thickness_mm: 1.2,
    lip_height_mm: 4.4, unit_h_mm: 7, height_u: 1, min_height_u: 1,
    pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools: [],
  };
}

/** "New bin" (see CombineBin.tsx's /combine/new route): a fresh session
 *  with zero starting tools and a `defaultForceSize`, since a tool-less
 *  auto-pack has nothing of its own to size a bin against. */
describe("CombineEditor new (blank) bin", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(() => Promise.resolve(blankResponse()));
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
    mockPassthroughSaves(vi.mocked(saveBin), vi.mocked(overwriteBin));
  });

  afterEach(() => {
    cleanup();
  });

  it("requests the default forced size on the very first load, with zero tools", async () => {
    render(
      <CombineEditor
        ids={[]}
        overallHeight={null}
        defaultForceSize={[1, 5]}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(combinePreview).toHaveBeenCalled());
    const [ids, options] = vi.mocked(combinePreview).mock.calls[0];
    expect(ids).toEqual([]);
    expect(options?.forceGx).toBe(1);
    expect(options?.forceGy).toBe(5);
  });

  it("auto-mints a Bin Library entry for the blank bin, same as any fresh session", async () => {
    render(
      <CombineEditor
        ids={[]}
        overallHeight={null}
        defaultForceSize={[1, 5]}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(saveBin).toHaveBeenCalled());
    const [, ids] = vi.mocked(saveBin).mock.calls[0];
    expect(ids).toEqual([]);
  });

  it("renders with no tool selected and no crash", async () => {
    render(
      <CombineEditor
        ids={[]}
        overallHeight={null}
        defaultForceSize={[1, 5]}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(combinePreview).toHaveBeenCalled());
    expect(await screen.findByText("No tool selected")).toBeTruthy();
  });
});
