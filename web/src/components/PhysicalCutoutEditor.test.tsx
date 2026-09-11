// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { PhysicalCutoutEditor } from "./PhysicalCutoutEditor";
import type { Poly } from "../api";

const CUTOUT: Poly = { exterior: [[-10, -5], [10, -5], [10, 5], [-10, 5]], holes: [] };
const PHOTO_BASELINE: Poly = { exterior: [[-12, -6], [12, -6], [12, 6], [-12, 6]], holes: [] };

afterEach(() => cleanup());

describe("PhysicalCutoutEditor photo-selection baseline", () => {
  it("without a photoBaseline, shows no shadow outline and no revert button", () => {
    render(
      <PhysicalCutoutEditor initial={CUTOUT} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.queryByText("Revert to photo selection")).toBeNull();
    expect(screen.queryByText("photo selection")).toBeNull();
  });

  it("a cutout that already diverges from its photo baseline shows the shadow and an enabled revert button, with no session edits yet", () => {
    render(
      <PhysicalCutoutEditor
        initial={CUTOUT}
        photoBaseline={PHOTO_BASELINE}
        busy={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("photo selection")).toBeTruthy();
    expect(screen.getByText("physical cutout")).toBeTruthy();
    const revert = screen.getByText("Revert to photo selection").closest("button") as HTMLButtonElement;
    expect(revert.disabled).toBe(false);
    // Save is disabled: nothing has changed *this session* yet, even though
    // the tool arrived already diverged.
    expect(screen.getByText("Save cutout and regenerate").closest("button")).toHaveProperty("disabled", true);
  });

  it("matching its photo baseline exactly, revert stays disabled", () => {
    render(
      <PhysicalCutoutEditor
        initial={PHOTO_BASELINE}
        photoBaseline={PHOTO_BASELINE}
        busy={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const revert = screen.getByText("Revert to photo selection").closest("button") as HTMLButtonElement;
    expect(revert.disabled).toBe(true);
  });

  it("clicking revert restores the photo baseline and enables Save", () => {
    render(
      <PhysicalCutoutEditor
        initial={CUTOUT}
        photoBaseline={PHOTO_BASELINE}
        busy={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Revert to photo selection"));

    // Reverting to exactly the baseline it's now showing disables Revert
    // again (nothing left to revert) while Save becomes enabled (this
    // session did just change the shape, away from `initial`).
    const revert = screen.getByText("Revert to photo selection").closest("button") as HTMLButtonElement;
    expect(revert.disabled).toBe(true);
    expect(screen.getByText("Save cutout and regenerate").closest("button")).toHaveProperty("disabled", false);
    expect(screen.getByText("24.00 × 12.00 mm")).toBeTruthy();
  });
});
