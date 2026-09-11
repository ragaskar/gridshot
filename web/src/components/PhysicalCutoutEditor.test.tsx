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

  it("a cutout that already diverges from its photo baseline shows the shadow and an enabled revert button, with Reset (session-only) still disabled", () => {
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
    // Reset (session-only) has nothing to undo yet — the divergence predates
    // this editing session, so only Revert (photo-baseline-scoped) offers to
    // touch it.
    expect(screen.getByText("Reset").closest("button")).toHaveProperty("disabled", true);
    // Save is disabled too: nothing has changed *this session* yet, even
    // though the tool arrived already diverged.
    expect(screen.getByText("Save cutout and regenerate").closest("button")).toHaveProperty("disabled", true);
  });

  it("Reset undoes only this session's edits, leaving a pre-existing divergence in place — Revert is the one that reaches further back", () => {
    render(
      <PhysicalCutoutEditor
        initial={CUTOUT}
        photoBaseline={PHOTO_BASELINE}
        busy={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Delete"));
    const [firstVertex] = document.querySelectorAll("circle");
    fireEvent.pointerDown(firstVertex); // deletes one of CUTOUT's 4 vertices — a session edit

    expect(screen.getByText("Reset").closest("button")).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByText("Reset"));

    // Back to CUTOUT (20x10mm), not PHOTO_BASELINE (24x12mm) — Reset only
    // unwound this session's own edit.
    expect(screen.getByText("20.00 × 10.00 mm")).toBeTruthy();
    expect(screen.getByText("Reset").closest("button")).toHaveProperty("disabled", true);
    // CUTOUT itself is still diverged from PHOTO_BASELINE, so Revert remains
    // available to go the rest of the way.
    expect(screen.getByText("Revert to photo selection").closest("button")).toHaveProperty("disabled", false);
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
