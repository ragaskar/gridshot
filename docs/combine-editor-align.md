# Align tools in the combine editor

With [multiple tools selected](combine-editor-multi-select.md) in the "Arrange multi-tool bin"
modal's 2D view, two sections appear at the bottom of the Inspector panel: **Horizontal align**
(Left / Center / Right) and **Vertical align** (Top / Middle / Bottom). They're greyed out until
at least 2 tools are selected.

## What each button does

Every tool's bounding box here is its placed `stamp` outline (the pocket footprint after
rotation), not its finger-hole scallop — align is about lining up the parts themselves, not
their manufacturing details.

- **Left**: moves every selected tool so its own bounding box's left edge lines up with the
  leftmost edge across the whole selection.
- **Right**: same, but against the rightmost edge.
- **Center** (horizontal): finds the midpoint between the selection's overall leftmost and
  rightmost edges, then moves each tool so its own bounding-box center lands there.
- **Top / Middle / Bottom**: the same three operations on the vertical axis.

Horizontal alignment only ever changes a tool's x position; vertical alignment only ever changes
y — the other axis is always left exactly where it was.

## Constraints

- Requires at least 2 selected tools.
- Purely a local rearrangement, same as dragging — it doesn't round-trip to the server by
  itself; the existing debounced 3D preview picks up the new positions shortly after.
