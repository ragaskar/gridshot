# Distribute tools in the combine editor

With [3 or more tools selected](combine-editor-multi-select.md) in the
"Arrange multi-tool bin" modal's 2D view, a "Distribute" section appears
below "Align" in the Inspector panel: **Horizontally** and **Vertically**
buttons, greyed out below 3 selected tools.

## What it does

Each tool's bounding box here is the same placed `stamp` outline align uses.
Distributing an axis:

1. Finds every selected tool's bounding-box center on that axis.
2. Sorts them by that center — this order is preserved; distribute never
   reorders tools.
3. Leaves the two extreme tools (lowest and highest center) exactly where
   they are.
4. Moves every tool in between so the gap between consecutive centers is
   equal, evenly spanning the distance between the two extremes.

Horizontal distribute only ever changes tx; vertical only ever changes ty —
the cross-axis position is untouched, same as align.

## Constraints

- Requires at least 3 selected tools.
- Like align, this is a local rearrangement — it doesn't round-trip to the
  server by itself; the existing debounced 3D preview picks up the new
  positions shortly after.
