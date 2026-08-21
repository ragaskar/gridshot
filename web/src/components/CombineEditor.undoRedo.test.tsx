// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CombineEditor } from "./CombineEditor";
import type { CombineToolOverride, Placement } from "../api";

vi.mock("../api", () => ({
  combinePreview: vi.fn(),
  combinePreviewGlb: vi.fn(),
  combineLibrary: vi.fn(),
  combineLibrarySlice: vi.fn(),
  saveBin: vi.fn(),
}));

import { combinePreview, combinePreviewGlb } from "../api";

const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(id: string, label: string, tx: number) {
  return {
    id, label, bin_style: "pocket" as const,
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
    bin_style: "pocket" as const, gx: 3, gy: 2, outer_w: 125, outer_d: 83,
    overall_height_mm: 25.4, pitch: 42, bin_size: 41.5, wall: 2, lip: true,
    reserved_cells: [], available_cells: [], tools,
  };
}

function listRow(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const row = matches.find((el) => el.className.includes("font-bold"));
  if (!row) throw new Error(`no tool-list row found for "${label}"`);
  return row;
}

function magnetHolesCheckbox(): HTMLInputElement {
  return screen.getByText("Magnet holes").previousElementSibling as HTMLInputElement;
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
}
function redoButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement;
}

describe("CombineEditor undo/redo", () => {
  beforeAll(() => {
    // jsdom has no real SVG geometry math — stub an identity transform so
    // the component's toData(e) resolves to plain [clientX, clientY], and a
    // no-op pointer-capture so a real drag gesture can be simulated at all.
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
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("undoes and redoes a discrete action (magnet holes toggle) as one step", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} lip={true} onClose={() => {}} />);
    await screen.findByText("Wrench");

    expect(undoButton().disabled).toBe(true);
    expect(magnetHolesCheckbox().checked).toBe(false);

    fireEvent.click(magnetHolesCheckbox());
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));
    expect(undoButton().disabled).toBe(false);

    fireEvent.click(undoButton());
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(false));
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    fireEvent.click(redoButton());
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));
    expect(redoButton().disabled).toBe(true);
  });

  it("collapses a rapid burst of nudges into a single undo step", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} lip={true} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    const arrangeArea = document.querySelector("svg")!.parentElement!;
    const originalPoints = document.querySelectorAll("polygon")[0].getAttribute("points");

    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(arrangeArea, { key: "ArrowRight" });
    }
    const afterBurstPoints = document.querySelectorAll("polygon")[0].getAttribute("points");
    expect(afterBurstPoints).not.toBe(originalPoints);
    expect(undoButton().disabled).toBe(false);

    fireEvent.click(undoButton());
    expect(document.querySelectorAll("polygon")[0].getAttribute("points")).toBe(originalPoints);
    // The whole 5-nudge burst was one undo step: nothing left to undo further.
    expect(undoButton().disabled).toBe(true);
  });

  it("starts a new undo step once the nudge burst's coalescing window closes", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} lip={true} onClose={() => {}} />);
    await screen.findByText("Wrench");
    fireEvent.click(listRow("Wrench"));

    vi.useFakeTimers();
    const arrangeArea = document.querySelector("svg")!.parentElement!;
    const p0 = document.querySelectorAll("polygon")[0].getAttribute("points");

    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" }); // burst 1
    const p1 = document.querySelectorAll("polygon")[0].getAttribute("points");

    vi.advanceTimersByTime(1001); // close burst 1's coalescing window

    fireEvent.keyDown(arrangeArea, { key: "ArrowRight" }); // burst 2 — its own undo step
    const p2 = document.querySelectorAll("polygon")[0].getAttribute("points");
    expect(p2).not.toBe(p1);

    fireEvent.click(undoButton()); // undoes burst 2 only
    expect(document.querySelectorAll("polygon")[0].getAttribute("points")).toBe(p1);
    expect(undoButton().disabled).toBe(false);

    fireEvent.click(undoButton()); // undoes burst 1
    expect(document.querySelectorAll("polygon")[0].getAttribute("points")).toBe(p0);
    expect(undoButton().disabled).toBe(true);
  });

  it("collapses a full pointer-drag gesture into a single undo step", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} lip={true} onClose={() => {}} />);
    await screen.findByText("Wrench");

    const svg = document.querySelector("svg")!;
    const polygon = document.querySelectorAll("polygon")[0];
    const originalPoints = polygon.getAttribute("points");

    fireEvent.pointerDown(polygon, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 5, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 12, clientY: 3, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 20, clientY: 3, pointerId: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1 });

    const draggedPoints = document.querySelectorAll("polygon")[0].getAttribute("points");
    expect(draggedPoints).not.toBe(originalPoints);
    expect(undoButton().disabled).toBe(false);

    fireEvent.click(undoButton());
    expect(document.querySelectorAll("polygon")[0].getAttribute("points")).toBe(originalPoints);
    // The whole drag (3 pointermoves) was one undo step.
    expect(undoButton().disabled).toBe(true);
  });

  it("undoes and redoes via Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} lip={true} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(magnetHolesCheckbox());
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(false));

    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));
  });

  it("does not intercept Cmd+Z while a text field is focused", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} lip={true} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(magnetHolesCheckbox());
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));

    const nudgeInput = screen.getByLabelText("Keyboard nudge step in millimetres");
    nudgeInput.focus();
    fireEvent.keyDown(nudgeInput, { key: "z", metaKey: true });

    // give any (incorrect) undo a tick to land, then assert nothing changed
    await new Promise((r) => setTimeout(r, 0));
    expect(magnetHolesCheckbox().checked).toBe(true);
    expect(undoButton().disabled).toBe(false); // the undo entry is still there, unconsumed
  });

  it("clears the redo stack once a new action follows an undo", async () => {
    render(<CombineEditor ids={["tool-a", "tool-b"]} overallHeight={null} lip={true} onClose={() => {}} />);
    await screen.findByText("Wrench");

    fireEvent.click(magnetHolesCheckbox()); // action A: false -> true
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));
    fireEvent.click(magnetHolesCheckbox()); // action B: true -> false
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(false));

    fireEvent.click(undoButton()); // undo B -> true; redo stack now has one entry
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(true));
    expect(redoButton().disabled).toBe(false);

    fireEvent.click(magnetHolesCheckbox()); // action C: a fresh action after the undo
    await waitFor(() => expect(magnetHolesCheckbox().checked).toBe(false));
    expect(redoButton().disabled).toBe(true);
  });
});
