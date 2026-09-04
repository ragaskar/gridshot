// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Upload } from "./Upload";
import type { BinProfile } from "../api";

vi.mock("../api", () => ({
  getHealth: vi.fn(),
  startSession: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { getHealth, listBinProfiles } from "../api";

const CORRAL_PROFILE: BinProfile = {
  id: "p1", name: "My Corral", created_ts: 0,
  fill_height_pct: 0, live_grid: false, lip: false, allow_custom_shape: false,
  magnet_holes_default: false, magnet_hole_diameter_mm_default: 6.5, magnet_hole_depth_mm_default: 2.0, magnet_corners_only_default: false, magnet_easy_release_default: "off",
  lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
  min_wall_mm: null, min_floor_mm: null, floor_thickness_mm: null, tool_wall_mm: null,
  tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null, edge_margin_mm: null,
  magnet_hole_inset_from_edge_mm: null,
  has_preview_image: false,
};

describe("Upload page bin profile picker", () => {
  beforeEach(() => {
    vi.mocked(getHealth).mockResolvedValue({ segserver: true, mats: ["m1"] } as never);
    vi.mocked(listBinProfiles).mockResolvedValue([CORRAL_PROFILE]);
  });

  afterEach(() => {
    cleanup();
  });

  it("applies a profile's fill height and lip to the form, editable afterward", async () => {
    render(<Upload />);
    const select = (await screen.findByLabelText("Bin profile")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));

    // Lip toggle starts on (Upload's own default)
    const lipToggle = screen.getByText("Stacking lip").closest("label")!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(lipToggle.checked).toBe(true);

    fireEvent.change(select, { target: { value: "p1" } });

    // Corral profile's lip=false is applied...
    await waitFor(() => expect(lipToggle.checked).toBe(false));
    // ...but stays independently editable afterward, not locked to the profile.
    fireEvent.click(lipToggle);
    expect(lipToggle.checked).toBe(true);
  });
});
