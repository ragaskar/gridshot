# Copy finger-hole style

With [multiple tools selected](combine-editor-multi-select.md) in the "Arrange multi-tool
bin" modal, a **Copy style** button appears in the tool Inspector's "Finger access"
section. It's enabled whenever at least two tools are selected — unlike
[Align finger holes](combine-editor-align-finger-holes.md), it doesn't need every hole
travelling on the same axis, and it works even when some (or all) selected tools have no
finger hole yet — which is exactly why it stays gated on selecting *tools*, not their
holes directly: a tool with no hole yet has no hole to click.

## What it copies, and from where

The **base** tool is the bottom-most selected tool — by its own placed outline, not its
hole's position, so the pick stays well-defined even when the base (or every other
selected tool) has no hole at all.

Clicking Copy style pushes the base's finger-hole *style* onto every other selected
tool:

- If the base has no finger hole, every other selected tool's finger hole is turned
  **off**.
- Otherwise, every other selected tool gets the base's [diameter](combine-finger-hole-position.md#size),
  [radial offset](combine-finger-hole-radial-offset.md), and [span](combine-finger-hole-span.md)
  state (on or off). A tool with no hole yet gets one.

## What it never touches

Copy style is about type and size, not position — that's what
[Align](combine-editor-align-finger-holes.md) is for, as a follow-up if you want the
result on one line too.

- A tool that **already has** a hole keeps its existing point(s) exactly where they
  are. Only its diameter and span state change.
- A tool **gaining** a hole for the first time gets its own auto-placed point — the same
  point it would get from switching its own "Finger access" toggle on — never the base's
  position.
- Turning span on for a target that was single-point seeds a fresh second point the same
  way turning span on by hand does (opposite the first, by arc-length) — from that
  target's *own* first point, not copied from the base.
- The base tool itself never moves or changes.
