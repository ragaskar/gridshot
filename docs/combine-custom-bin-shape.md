# Custom bin shape

Cut individual gridfinity units out of a forced-size bin — an L-shape, a notched
rectangle, even a ring — instead of always getting a plain rectangle.

## Enabling it

Check **"Force bin size"** in the multi-tool combine editor's right-hand panel (see
[docs/combine-force-bin-size.md](combine-force-bin-size.md)). With a width and depth set,
a **"Custom bin shape"** checkbox appears below them. Checking it shows a grid of small
toggle squares the same size as your forced grid — check a square to remove that
gridfinity unit from the bin. The Arrange 2D picture updates immediately, including the
bin's outer corners rounding wherever a removal creates a new one (an internal notch
corner rounds inward, just like the bin's four outer corners already do).

Only available for **pocket**-style bins — switching to Corral or Live grid clears any
custom shape, since the corral wall/deck and live-grid sockets aren't shape-aware yet.

## Dragging over a removed cell

A removed cell is treated the same as the space outside a locked bin: drag a tool's
pocket or finger-access cutout over one and it turns red, the same overflow warning as
crossing the locked footprint's edge. **Export bin**, **Export slice**, and **Preview 3D**
stay disabled until every tool is moved clear.

## Constraints

- Requires "Force bin size" (a custom shape only makes sense against an exact,
  known footprint).
- The remaining shape must be a single connected piece — 4-connected, i.e. sharing a
  full edge, not just a corner. A hole in the middle (a ring) is still one piece and is
  fine; splitting the bin into two separate islands (e.g. removing an entire middle row)
  is rejected with an error, both in the editor and if you export anyway.
- Saved to the Bin Library and re-exported/reopened exactly like any other combine
  recipe (see [docs/bin-library.md](bin-library.md)).
