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

Only available for **pocket**-style bins — switching to Corral or Live grid hides the
checkbox and stops applying the shape, since the corral wall/deck and live-grid sockets
aren't shape-aware yet. The checkbox state and removed cells aren't cleared, though:
switch back to Pocket and they reappear exactly as you left them, instead of having to
redraw the shape.

## Dragging over a removed cell

A removed cell is treated the same as the space outside a locked bin: drag a tool's
pocket or finger-access cutout over one and it turns red, the same overflow warning as
crossing the locked footprint's edge. **Preview 3D** stays disabled until every tool is
moved clear; **Export bin**, **Export slice**, and the autosave to the bin's
own Bin Library entry stay available regardless (a tool's location may come
out wrong in the export until the overlap is fixed).

## Constraints

- Requires "Force bin size" (a custom shape only makes sense against an exact,
  known footprint).
- The remaining shape must be a single connected piece — 4-connected, i.e. sharing a
  full edge, not just a corner. A hole in the middle (a ring) is still one piece and is
  fine; splitting the bin into two separate islands (e.g. removing an entire middle row)
  is rejected with an error, both in the editor and if you export anyway.
- Saved to the Bin Library and re-exported/reopened exactly like any other combine
  recipe (see [docs/bin-library.md](bin-library.md)).

## Stacking lip on a notched shape

A stacking lip follows a custom shape's outline exactly, including any notch
a removed cell cuts into it — the lip's 45° chamfer transitions are built
from the true offset outline at every step specifically so a concave notch
stays a notch, rather than getting bridged over by a straight shortcut (a
convex-hull-based chamfer, correct for a plain rectangle, can't represent a
concavity at all: it used to bridge straight across a notch, over-carving
the lip's inner socket right at that corner and leaving an unsupported
overhang there — reported by slicers as a "floating cantilever" warning,
specific to lip=True on a notched shape).
