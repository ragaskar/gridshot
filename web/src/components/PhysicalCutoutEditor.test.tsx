// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
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

describe("PhysicalCutoutEditor curve editing", () => {
  beforeAll(() => {
    // toData() maps client coordinates straight through as data-space
    // coordinates — same identity-CTM polyfill CombineEditor's tests use —
    // so a drag test can reason about handle length directly from clientX/Y.
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
    // jsdom's built-in PointerEvent doesn't carry clientX/clientY through
    // fireEvent — without this, a drag test's clientX/clientY reach the
    // handler as undefined (silently NaN-ing every downstream computation).
    if (typeof (globalThis as unknown as { PointerEvent?: unknown }).PointerEvent === "undefined") {
      class PointerEventPolyfill extends MouseEvent {
        pointerId: number;
        constructor(type: string, params: PointerEventInit = {}) {
          super(type, params);
          this.pointerId = params.pointerId ?? 0;
        }
      }
      (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
    }
  });

  it("clicking a vertex in curve mode eases it (green, with two drag handles); clicking again returns it to a sharp corner", () => {
    render(
      <PhysicalCutoutEditor initial={CUTOUT} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Edit curves"));
    expect(document.querySelectorAll("rect")).toHaveLength(0);

    fireEvent.pointerDown(document.querySelectorAll("circle")[0]);

    expect(document.querySelectorAll("rect")).toHaveLength(2); // the "in" and "out" handles
    expect(document.querySelectorAll("circle")[0].getAttribute("fill")).toBe("var(--c-olive)");

    fireEvent.pointerDown(document.querySelectorAll("circle")[0]);

    expect(document.querySelectorAll("rect")).toHaveLength(0);
    expect(document.querySelectorAll("circle")[0].getAttribute("fill")).toBe("var(--c-teal)");
  });

  it("handles (and toggling) are inert outside curve mode — Move mode drags the vertex instead", () => {
    render(
      <PhysicalCutoutEditor initial={CUTOUT} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Edit curves"));
    fireEvent.pointerDown(document.querySelectorAll("circle")[0]); // ease the first corner
    fireEvent.click(screen.getByText("Move"));

    // The eased state persists (it's stored on the corner, not mode-local),
    // but no handle rects render while a different mode is active.
    expect(document.querySelectorAll("rect")).toHaveLength(0);
    expect(document.querySelectorAll("circle")[0].getAttribute("fill")).toBe("var(--c-olive)");
  });

  it("saving a cutout with one eased corner bakes it into sampled curve points, leaving the other corners exactly as they were", async () => {
    const onSave = vi.fn();
    render(
      <PhysicalCutoutEditor initial={CUTOUT} busy={false} onSave={onSave} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Edit curves"));
    fireEvent.pointerDown(document.querySelectorAll("circle")[0]); // eases (-10, -5)

    fireEvent.click(screen.getByText("Save cutout and regenerate"));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: Poly = onSave.mock.calls[0][0];
    // 3 untouched corners + 11 sampled points (CURVE_SEGMENTS=10 -> 11
    // points) replacing the eased one.
    expect(saved.exterior).toHaveLength(14);
    // Default handle length for this corner is 3mm (30% of the shorter
    // 10mm edge) — the curve starts 3mm up the vertical edge and ends 3mm
    // along the horizontal edge, tangent to both, never touching (-10,-5).
    expect(saved.exterior[0][0]).toBeCloseTo(-10, 5);
    expect(saved.exterior[0][1]).toBeCloseTo(-2, 5);
    expect(saved.exterior[10][0]).toBeCloseTo(-7, 5);
    expect(saved.exterior[10][1]).toBeCloseTo(-5, 5);
    expect(saved.exterior).not.toContainEqual([-10, -5]);
    // The three untouched corners survive unchanged, in order.
    expect(saved.exterior[11]).toEqual([10, -5]);
    expect(saved.exterior[12]).toEqual([10, 5]);
    expect(saved.exterior[13]).toEqual([-10, 5]);
  });

  it("dragging a handle further out lengthens the curve on that side only", () => {
    const onSave = vi.fn();
    render(
      <PhysicalCutoutEditor initial={CUTOUT} busy={false} onSave={onSave} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Edit curves"));
    fireEvent.pointerDown(document.querySelectorAll("circle")[0]); // eases (-10, -5); default 3mm both sides

    // The "out" handle sits at (-7, -5) by default, along the bottom edge
    // toward (10, -5) — drag it out to (-4, -5), an 6mm reach.
    const outHandle = document.querySelectorAll("rect")[1];
    fireEvent.pointerDown(outHandle, { clientX: -7, clientY: -5 });
    fireEvent.pointerMove(document.querySelector("svg")!, { clientX: -4, clientY: -5 });
    fireEvent.pointerUp(document.querySelector("svg")!);

    fireEvent.click(screen.getByText("Save cutout and regenerate"));
    const saved: Poly = onSave.mock.calls[0][0];
    // The "in" side is untouched (still 3mm up the vertical edge)...
    expect(saved.exterior[0]).toEqual([-10, -2]);
    // ...but the "out" side now reaches 6mm along the bottom edge.
    expect(saved.exterior[10][0]).toBeCloseTo(-4, 5);
    expect(saved.exterior[10][1]).toBeCloseTo(-5, 5);
  });
});
