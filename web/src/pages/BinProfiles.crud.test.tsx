// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BinProfiles } from "./BinProfiles";
import type { BinProfile } from "../api";

vi.mock("../api", () => ({
  listBinProfiles: vi.fn(),
  createBinProfile: vi.fn(),
  updateBinProfile: vi.fn(),
  deleteBinProfile: vi.fn(),
  uploadBinProfilePreview: vi.fn(),
  previewBinProfileGlb: vi.fn(),
  binProfilePreviewUrl: (id: string) => `/api/bin-profiles/${id}/preview`,
}));

// jsdom has no real WebGL context, so BinViewer's three.js setup can't run
// here — the page's own logic (fields, save/delete calls) is what's under
// test, not the 3D render itself.
vi.mock("../components/BinViewer", () => ({
  BinViewer: () => null,
}));

import {
  createBinProfile, deleteBinProfile, listBinProfiles, previewBinProfileGlb, updateBinProfile,
} from "../api";

function profile(overrides: Partial<BinProfile> = {}): BinProfile {
  return {
    id: "p1", name: "Pocket", created_ts: 0,
    fill_height_pct: 100, live_grid: false, lip: true, allow_custom_shape: true,
    magnet_holes_default: false, magnet_hole_diameter_mm_default: 6.5, magnet_hole_depth_mm_default: 2.0, magnet_corners_only_default: false,
    lip_height_mm: null, lip_chamfer_top_mm: null, lip_straight_mm: null, lip_chamfer_bottom_mm: null,
    min_wall_mm: null, min_floor_mm: null, floor_thickness_mm: null, tool_wall_mm: null,
    tool_wall_flare_mm: null, tool_wall_reinforcement_h_mm: null, edge_margin_mm: null,
    magnet_hole_inset_from_edge_mm: null,
    has_preview_image: false,
    ...overrides,
  };
}

const PROFILES = [
  profile({ id: "p1", name: "Pocket" }),
  profile({ id: "p2", name: "Corral", fill_height_pct: 0, allow_custom_shape: false }),
];

function setPath(path: string) {
  window.history.pushState({}, "", path);
}

describe("BinProfiles page", () => {
  beforeEach(() => {
    vi.mocked(listBinProfiles).mockResolvedValue(PROFILES);
    vi.mocked(previewBinProfileGlb).mockResolvedValue(new Blob());
    vi.mocked(createBinProfile).mockReset();
    vi.mocked(updateBinProfile).mockReset();
    vi.mocked(deleteBinProfile).mockReset();
  });

  afterEach(() => {
    cleanup();
    setPath("/");
  });

  it("lists every profile with its base style and a New tile", async () => {
    render(<BinProfiles />);

    await screen.findByText("Pocket");
    expect(screen.getByText("Corral")).toBeTruthy();
    expect(screen.getByText("New bin profile")).toBeTruthy();
  });

  it("opens the editor pre-filled with today's date for a new profile", async () => {
    render(<BinProfiles />);
    await screen.findByText("Pocket");

    fireEvent.click(screen.getByText("New bin profile"));

    const nameInput = (await screen.findByLabelText("Bin profile name")) as HTMLInputElement;
    // Local date fields, matching how the component itself formats "today"
    // (see BinProfiles.tsx) — not `toISOString()`, which is UTC and drifts
    // a calendar day off local in roughly half the world's timezones.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(nameInput.value).toBe(`Bin Profile ${today}`);
    expect((screen.getByLabelText("Fill height percent") as HTMLInputElement).value).toBe("100");
  });

  it("opens the editor pre-filled with an existing profile's fields", async () => {
    render(<BinProfiles />);
    await screen.findByText("Pocket");

    fireEvent.click(screen.getByText("Corral"));

    const nameInput = (await screen.findByLabelText("Bin profile name")) as HTMLInputElement;
    expect(nameInput.value).toBe("Corral");
    expect((screen.getByLabelText("Fill height percent") as HTMLInputElement).value).toBe("0");
  });

  it("shows a warning when allow-custom-shape is checked but fill height isn't 100", async () => {
    render(<BinProfiles />);
    await screen.findByText("Pocket");
    fireEvent.click(screen.getByText("Pocket")); // opens the Pocket profile (allow_custom_shape: true)
    await screen.findByLabelText("Bin profile name");

    fireEvent.change(screen.getByLabelText("Fill height percent"), { target: { value: "0" } });

    expect(screen.getByText(/only works at 100% fill height/)).toBeTruthy();
  });

  it("saves a new profile and returns to the list", async () => {
    vi.mocked(createBinProfile).mockResolvedValue(profile({ id: "new-id", name: "My Style" }));
    render(<BinProfiles />);
    await screen.findByText("Pocket");

    fireEvent.click(screen.getByText("New bin profile"));
    const nameInput = (await screen.findByLabelText("Bin profile name")) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "My Style" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createBinProfile).toHaveBeenCalled());
    const sent = vi.mocked(createBinProfile).mock.calls[0][0];
    expect(sent.name).toBe("My Style");
    expect(sent.fill_height_pct).toBe(100);
    expect(sent.live_grid).toBe(false);
    await waitFor(() => expect(screen.queryByLabelText("Bin profile name")).toBeNull());
  });

  it("saves an edited profile via update, not create", async () => {
    vi.mocked(updateBinProfile).mockResolvedValue(profile({ id: "p1", name: "Renamed" }));
    render(<BinProfiles />);
    await screen.findByText("Pocket");

    fireEvent.click(screen.getByText("Pocket"));
    const nameInput = (await screen.findByLabelText("Bin profile name")) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateBinProfile).toHaveBeenCalledWith("p1", expect.objectContaining({ name: "Renamed" })));
    expect(createBinProfile).not.toHaveBeenCalled();
  });

  it("leaves a blank structural field as null but sends a typed one as a number", async () => {
    vi.mocked(createBinProfile).mockResolvedValue(profile({ id: "new-id" }));
    render(<BinProfiles />);
    await screen.findByText("Pocket");
    fireEvent.click(screen.getByText("New bin profile"));
    await screen.findByLabelText("Bin profile name");

    fireEvent.change(screen.getByLabelText("Pocket wall thickness"), { target: { value: "3.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createBinProfile).toHaveBeenCalled());
    const sent = vi.mocked(createBinProfile).mock.calls[0][0];
    expect(sent.min_wall_mm).toBe(3.5);
    expect(sent.lip_height_mm).toBeNull();
  });

  it("shows every structural field without a hidden Advanced section", async () => {
    render(<BinProfiles />);
    await screen.findByText("Pocket");
    fireEvent.click(screen.getByText("New bin profile"));
    await screen.findByLabelText("Bin profile name");

    expect(screen.queryByText("Advanced (structural)")).toBeNull();
    expect(screen.getByLabelText("Lip height")).toBeTruthy();
    expect(screen.getByLabelText("Pocket wall thickness")).toBeTruthy();
    expect(screen.getByLabelText("Edge margin")).toBeTruthy();
  });

  it("disables the stacking-lip fields unless the Stacking Lip box is checked", async () => {
    render(<BinProfiles />);
    await screen.findByText("Pocket");
    fireEvent.click(screen.getByText("New bin profile"));
    await screen.findByLabelText("Bin profile name");

    // Pocket seeds with lip on, so its fields start enabled.
    expect((screen.getByLabelText("Lip height") as HTMLInputElement).disabled).toBe(false);

    const lipCheckbox = screen.getByText("Stacking Lip").previousElementSibling as HTMLInputElement;
    fireEvent.click(lipCheckbox);

    expect((screen.getByLabelText("Lip height") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Lip top chamfer") as HTMLInputElement).disabled).toBe(true);
  });

  it("puts the magnet hole inset field inside the Magnet Holes section", async () => {
    render(<BinProfiles />);
    await screen.findByText("Pocket");
    fireEvent.click(screen.getByText("New bin profile"));
    await screen.findByLabelText("Bin profile name");

    expect(screen.queryByLabelText("Magnet hole inset from edge")).toBeNull();

    const magnetCheckbox = screen.getByText("Magnet Holes (default)").previousElementSibling as HTMLInputElement;
    fireEvent.click(magnetCheckbox);

    expect(screen.getByLabelText("Magnet hole inset from edge")).toBeTruthy();
  });

  it("deletes a profile after confirmation and removes it from the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(deleteBinProfile).mockResolvedValue(undefined);
    render(<BinProfiles />);
    await screen.findByText("Pocket");

    fireEvent.click(screen.getAllByText("× Delete")[0]);

    await waitFor(() => expect(deleteBinProfile).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(screen.queryByText("Pocket")).toBeNull());
    expect(screen.getByText("Corral")).toBeTruthy();
  });

  it("does not delete when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BinProfiles />);
    await screen.findByText("Pocket");

    fireEvent.click(screen.getAllByText("× Delete")[0]);

    expect(deleteBinProfile).not.toHaveBeenCalled();
  });
});
