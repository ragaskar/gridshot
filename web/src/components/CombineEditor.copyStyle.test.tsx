// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { combinePreview, combinePreviewGlb, listBinProfiles } from "../api";

// 20x10 rect, perimeter 60 — same convention as CombineEditor.fingerHole.test.tsx:
// bottom edge arc [0,20) (midpoint arc 10, world (0,-5)); arc 15 → world (5,-5).
const STAMP: [number, number][] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];

function baseTool(
  id: string, label: string, tx: number, ty: number,
  opts: { fingerHole: boolean; arcMm?: number; diameter?: number },
) {
  const { fingerHole, arcMm = 10, diameter = 20 } = opts;
  const [lx, ly] = [-10 + arcMm, -5]; // point on the bottom edge at this arc-length
  return {
    id, label, fill_height_pct: 100, live_grid: false,
    depth_mm: 5, depth_mm_inherited: 5, depth_mm_override: null, depth_mode: "automatic" as const,
    clearance_mm: 1.0, clearance_mm_inherited: 1.0, clearance_mm_override: null,
    round_tool: false,
    finger: fingerHole, finger_hole: fingerHole, finger_hole_inherited: fingerHole, finger_hole_override: null,
    finger_hole_arc_mm: fingerHole ? arcMm : 0, finger_hole_arc_mm_override: null,
    finger_hole_diameter_mm_override: null, finger_hole_diameter_mm_inherited: 20,
    finger_hole_span: false, finger_hole_span_override: null,
    finger_hole_arc2_mm: 0, finger_hole_arc2_mm_override: null,
    finger_holes: (fingerHole ? [[lx, ly, diameter]] : []) as [number, number, number][],
    derivation_key: `${id}-key`,
    stamp: STAMP,
    tx, ty, rot: 0, mirror_x: false, mirror_y: false,
  };
}

type Fixture = ReturnType<typeof baseTool>;

const FIXTURES: Record<string, Fixture> = {
  // Bottom-most (ty=0) → the Copy style base.
  "base-on": baseTool("base-on", "Base", 0, 0, { fingerHole: true, arcMm: 10, diameter: 6 }),
  "base-off": baseTool("base-off", "BaseOff", 0, 0, { fingerHole: false }),
  "base-span": {
    ...baseTool("base-span", "SpanBase", 0, 0, { fingerHole: true, arcMm: 10, diameter: 6 }),
    finger_hole_span: true, finger_hole_arc2_mm: 15,
    finger_holes: [[0, -5, 6], [5, -5, 6]] as [number, number, number][],
  },
  // Higher up (ty=20) → never the base.
  "existing-single": baseTool("existing-single", "Existing", 40, 20, { fingerHole: true, arcMm: 15, diameter: 20 }),
  "no-hole": baseTool("no-hole", "NoHole", 80, 20, { fingerHole: false }),
};

/** Mimics enough of the server's override-echo behaviour to exercise Copy
 *  style's round trip realistically: applies `finger_hole`/
 *  `finger_hole_diameter_mm` from the request onto the matching fixture. A
 *  target losing its point (`finger_hole_arc_mm` override explicitly
 *  cleared to null while gaining a hole) gets a fabricated "freshly
 *  auto-placed" point at world (0,-5) — standing in for the server's own
 *  legacy-fallback placement, which this mock doesn't reproduce. */
function buildResponse(ids: string[], overrides: CombineToolOverride[] | null | undefined, placements: Placement[] | null | undefined) {
  const tools = ids.map((id) => {
    const base = FIXTURES[id];
    const override = overrides?.find((o) => o.id === id);
    const placement = placements?.find((p) => p.id === id);
    const finger_hole = override?.finger_hole ?? base.finger_hole;
    const diameter = override?.finger_hole_diameter_mm ?? base.finger_holes[0]?.[2] ?? 20;
    const gainingFresh = finger_hole && !base.finger_hole;
    // Preserve every existing point (a span base has 2) when just resizing/
    // toggling — only a genuinely fresh hole gets a fabricated single point.
    const finger_holes: [number, number, number][] = !finger_hole
      ? []
      : gainingFresh
        ? [[0, -5, diameter]]
        : base.finger_holes.map(([x, y]) => [x, y, diameter]);
    return {
      ...base,
      tx: placement?.tx ?? base.tx, ty: placement?.ty ?? base.ty, rot: placement?.rot ?? base.rot,
      finger: finger_hole, finger_hole, finger_hole_override: override?.finger_hole ?? null,
      finger_hole_diameter_mm_override: override?.finger_hole_diameter_mm ?? null,
      finger_holes,
    };
  });
  return {
    fill_height_pct: 100, live_grid: false, gx: 4, gy: 2, outer_w: 165, outer_d: 83,
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

function copyStyleButton(): HTMLElement {
  return screen.getByText("⎘ Copy style");
}

function allFingerCircles(): SVGCircleElement[] {
  return Array.from(document.querySelectorAll('circle[stroke-dasharray="2 1"]'));
}

describe("CombineEditor copy finger-hole style", () => {
  beforeEach(() => {
    vi.mocked(combinePreview).mockImplementation(
      (ids, options) => Promise.resolve(buildResponse(ids, options?.overrides, options?.placements)),
    );
    vi.mocked(combinePreviewGlb).mockResolvedValue(new Blob());
    vi.mocked(listBinProfiles).mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("copies diameter onto an existing hole without moving its point", async () => {
    render(<CombineEditor ids={["base-on", "existing-single"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Base");
    // base-on has 1 point, so index 0 is its circle and index 1 is
    // existing-single's — both single-point tools, order matches `ids`.
    const before = { cx: Number(allFingerCircles()[1].getAttribute("cx")), cy: Number(allFingerCircles()[1].getAttribute("cy")) };
    expect(Number(allFingerCircles()[1].getAttribute("r"))).toBeCloseTo(10); // diameter 20 / 2

    fireEvent.click(listRow("Base"));
    fireEvent.click(listRow("Existing"), { shiftKey: true });
    fireEvent.click(copyStyleButton());

    await waitFor(() => expect(Number(allFingerCircles()[1].getAttribute("r"))).toBeCloseTo(3)); // base's diameter 6 / 2
    const after = allFingerCircles()[1];
    expect(Number(after.getAttribute("cx"))).toBeCloseTo(before.cx);
    expect(Number(after.getAttribute("cy"))).toBeCloseTo(before.cy);
  });

  it("a tool with no hole gets one, matching the base's diameter", async () => {
    render(<CombineEditor ids={["base-on", "no-hole"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("Base");
    expect(allFingerCircles()).toHaveLength(1); // no-hole starts with no circle

    fireEvent.click(listRow("Base"));
    fireEvent.click(listRow("NoHole"), { shiftKey: true });
    fireEvent.click(copyStyleButton());

    await waitFor(() => expect(allFingerCircles()).toHaveLength(2));
    expect(Number(allFingerCircles()[1].getAttribute("r"))).toBeCloseTo(3); // base's diameter 6 / 2
  });

  it("copies span onto a previously-single target, seeding a fresh P2 without moving P1", async () => {
    render(<CombineEditor ids={["base-span", "existing-single"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("SpanBase");
    // base-span has 2 points, existing-single starts with 1 (index 2).
    expect(allFingerCircles()).toHaveLength(3);
    const p1Before = { cx: Number(allFingerCircles()[2].getAttribute("cx")), cy: Number(allFingerCircles()[2].getAttribute("cy")) };

    fireEvent.click(listRow("SpanBase"));
    fireEvent.click(listRow("Existing"), { shiftKey: true });
    fireEvent.click(copyStyleButton());

    await waitFor(() => expect(allFingerCircles()).toHaveLength(4));
    const [p1After, p2After] = [allFingerCircles()[2], allFingerCircles()[3]];
    expect(Number(p1After.getAttribute("cx"))).toBeCloseTo(p1Before.cx);
    expect(Number(p1After.getAttribute("cy"))).toBeCloseTo(p1Before.cy);
    // P2 is a genuinely new point, not coincident with P1.
    expect([Number(p2After.getAttribute("cx")), Number(p2After.getAttribute("cy"))])
      .not.toEqual([Number(p1After.getAttribute("cx")), Number(p1After.getAttribute("cy"))]);
  });

  it("base with no hole turns finger access off for the other selected tool", async () => {
    render(<CombineEditor ids={["base-off", "existing-single"]} overallHeight={null} onClose={() => {}} />);
    await screen.findByText("BaseOff");
    expect(allFingerCircles()).toHaveLength(1); // existing-single starts with a hole

    fireEvent.click(listRow("BaseOff"));
    fireEvent.click(listRow("Existing"), { shiftKey: true });
    fireEvent.click(copyStyleButton());

    await waitFor(() => expect(allFingerCircles()).toHaveLength(0));
  });
});
