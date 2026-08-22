// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Result } from "./Result";
import { useApp } from "../state";
import type { BinProfile, TraceResult } from "../api";

vi.mock("../api", () => ({
  addToLibrary: vi.fn(),
  getSession: vi.fn(),
  sessionGenerate: vi.fn(),
  sessionSetPhysicalOutline: vi.fn(),
  listBinProfiles: vi.fn(),
}));

import { listBinProfiles } from "../api";

const CORRAL_PROFILE: BinProfile = {
  id: "p1", name: "My Corral", created_ts: 0,
  base_style: "corral", lip: false, allow_custom_shape: false,
  magnet_holes_default: true, magnet_hole_diameter_mm_default: 5.0, magnet_hole_depth_mm_default: 1.5,
  lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
  min_wall_mm: null, min_floor_mm: null, corral_floor_mm: null, corral_wall_mm: null,
  corral_base_flare_mm: null, corral_base_reinforcement_h_mm: null, corral_edge_margin_mm: null,
  magnet_hole_inset_from_edge_mm: null,
  has_preview_image: false,
};

function fakeResult(): TraceResult {
  return {
    project: "proj-1",
    bin: {
      grid: [2, 1], height_u: 3, overall_height_mm: 25.4, bin_style: "pocket",
      pocket_depth_mm: 10, pocket_depth_override_mm: null, overall_height_override_mm: null,
      thickness_mm: 4, silhouette_height_mm: 4, full_height_mm: null, clearance_mm: 1,
      lip: true, magnet_holes: false, magnet_hole_diameter_mm: 6.5, magnet_hole_depth_mm: 2,
      derivation_key: "key-1", reserved_cells: [], available_cells: [],
    },
    calibration: {
      corners: 24, rms_px: 0.5, tilt_deg: null, camera_height_mm: null, nadir_xy_mm: null,
      mat_id: "m1", device_profile_id: null, device_profile_revision: null,
      intrinsics_source: null, capture_signature: null,
    },
    calibration_model: null,
    tool_poly: null, pocket_poly: null, raw_poly: null, corrected_poly: null,
    reconstruction: null, warnings: [],
    readiness: { status: "pass", checks: [], metrics: {} },
    provenance: {} as never,
    files: {},
  };
}

describe("Result page bin profile picker", () => {
  beforeEach(() => {
    vi.mocked(listBinProfiles).mockResolvedValue([CORRAL_PROFILE]);
    useApp.setState({
      result: fakeResult(),
      session: { session: "s1" } as never,
      params: { clearance: 1, bin_style: "pocket", finger_hole: true, lip: true } as never,
    });
  });

  afterEach(() => {
    cleanup();
    useApp.getState().reset();
  });

  it("applies a profile's base style, lip, and magnet-hole defaults to the regenerate form", async () => {
    render(<Result />);
    const select = (await screen.findByLabelText("Bin profile")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));

    const lipCheckbox = screen.getByText("Stacking lip").closest("label")!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    const magnetCheckbox = screen.getByText("Magnet holes").closest("label")!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(lipCheckbox.checked).toBe(true);
    expect(magnetCheckbox.checked).toBe(false);

    fireEvent.change(select, { target: { value: "p1" } });

    await waitFor(() => expect(lipCheckbox.checked).toBe(false));
    expect(magnetCheckbox.checked).toBe(true);
    expect((screen.getByLabelText("Magnet hole diameter") as HTMLInputElement).value).toBe("5");
  });
});
