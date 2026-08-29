# Custom bin shape

Cut individual gridfinity units out of a forced-size bin — an L-shape, a notched
rectangle, even a ring — instead of always getting a plain rectangle.

## Enabling it

Check **"Force size"** in the multi-tool combine editor's right-hand panel, under
**Grid config** (closed by default; see
[docs/combine-force-bin-size.md](combine-force-bin-size.md)). With a width and depth
set, click **"Edit grid"** to enter edit mode: every tool in **Arrange 2D** fades out of
the way (so it's obvious the grid, not a tool, is what you're about to click) and the
button highlights to show you're in edit mode. Hover a grid square to preview it, and
click to toggle that gridfinity unit on or off — the bin's outline (and its outer/inner
corner rounding) updates immediately as you go.

Click **"Edit grid"** again, or press **Enter**, to leave edit mode and lock in whatever
you toggled. **Esc** instead cancels the whole session, reverting to exactly how the
grid looked when you entered edit mode (not to a fully-on grid — just to "before this
session"). Individual toggles inside a session aren't separately undoable; only
finishing (or cancelling) the session is, so **Undo** reverts a whole editing pass in
one step. A right-aligned **"Clear grid edits"** link next to "Force size" turns every
square back on in one action (disabled when nothing's been removed) and is itself its
own undo step, usable in or out of edit mode.

Only available for **pocket**-style bins — switching to Corral or Live grid (or a Bin
Profile whose "Allow custom grid shape" is off) disables "Edit grid" and stops applying
the shape, since the corral wall/deck and live-grid sockets aren't shape-aware yet
(leaving edit mode open when that happens cancels the session automatically). The
removed cells aren't cleared, though: switch back to Pocket and they reappear exactly as
you left them, instead of having to redraw the shape. "Force size" itself stays checked
and disabled for as long as any square is off — clear the grid edits first if you need
to turn it off.

## Which squares can be toggled off

A square can't be removed if doing so would either split the bin into disconnected
pieces, or leave two removed squares touching only at a corner with neither of the two
squares bridging that corner also removed (e.g., in a 3×3 grid with (0,0) removed,
(1,1) can't be removed too unless (0,1) or (1,0) is also removed) — that diagonal
"pinch" would make the remaining shape touch itself at a single point, which the bin
outline can't represent correctly. Hovering an un-removable square shows a "not allowed"
cursor and doesn't highlight; toggling a square back *on* is always allowed.

## Dragging over a removed cell

A removed cell is treated the same as the space outside a locked bin: drag a tool's
pocket or finger-access cutout over one and it turns red, the same overflow warning as
crossing the locked footprint's edge. **Preview 3D** stays disabled until every tool is
moved clear; **Export bin**, **Export slice**, and the autosave to the bin's
own Bin Library entry stay available regardless (a tool's location may come
out wrong in the export until the overlap is fixed).

## Constraints

- Requires "Force size" (a custom shape only makes sense against an exact,
  known footprint).
- The remaining shape must be a single connected piece — 4-connected, i.e. sharing a
  full edge, not just a corner. A hole in the middle (a ring) is still one piece and is
  fine; splitting the bin into two separate islands (e.g. removing an entire middle row)
  is refused in the editor (see "Which squares can be toggled off" above) and, for a
  shape that predates that check, rejected with an error on export.
- Shrinking "Force size" below a removed cell's position prunes that removal —
  growing back afterward doesn't re-materialize it.
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
