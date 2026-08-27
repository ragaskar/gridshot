# Toolshapes

A toolshape is a tool outline with no source tool at all — no photo, no
calibration, no Tool Library entry. Its shape is generated in code from a
handful of parameters instead of traced from a photo, and it lives entirely
inside one bin: place it, size it, and it becomes a normal pocket in that
bin's mesh, editable the same way any other tool is.

The first toolshape is the **rounded rectangle**.

## Placing one

In the multi-tool combine editor's Arrange 2D view, click **"▢ Rounded
Rectangle"** under "Toolshapes". A panel appears with its parameters —
width, length, corner radius (all in mm), and a "Fillet bottom" checkbox —
defaulting to 30×30mm, 1mm radius, fillet off. Adjust them before placing if
you like; the canvas shows a live outline preview following the pointer.
Click anywhere on the grid to place it at that exact point — including on
top of an existing tool or its finger hole, which places the new toolshape
there rather than selecting whatever was underneath. Esc cancels placement
mode without creating anything.

Once placed, the toolshape is auto-selected and behaves like any other
tool: it gets its own id (`bintool-*`, private to this bin — see
[library-clone-tool.md](library-clone-tool.md) for the sibling "⧉
Duplicate"/"⧉ Clone" mechanism this reuses under the hood), and the
inspector shows both its own width/length/radius/fillet fields *and* every
control that already applies to any tool — height, rotation, clearance,
finger hole, pocket-depth override, and so on. Editing width/length/radius
regenerates its outline immediately; editing everything else works exactly
as it does for a photo-traced tool.

**Width** is the shape's X extent, **length** is its Y extent — resizing
either only ever changes that one axis. In an auto-fit bin (the default,
"Force bin size" unchecked), the layout still normally re-centres every
tool inside its own auto-grown footprint on every request — that's how
dragging a tool near an edge keeps the bin snug around the whole group.
A toolshape resize is exempted from that: since only the edited tool's own
geometry changed and every tool's placement is otherwise untouched,
resizing holds all tools exactly where they were, growing the bin's
footprint around them instead of recentring the group. If a resize grows
the shape enough to outgrow the current footprint, the bin grows to fit
but the arrangement can end up sitting off-centre within it — drag a tool
afterwards (or toggle "Force bin size") to re-centre if wanted.

## Edge-drag resize

Once a rounded rectangle is placed and selected, its own outline becomes
draggable: hover the left or right edge for a width cursor, or the top or
bottom edge for a length cursor, and drag to resize along that one axis only
— the two dimensions are always independent, never adjusted together. The
shape grows/shrinks live as you drag (a client-side approximation, same as
the placement-mode ghost preview); the actual PATCH + relayout round-trip
fires once on release, as a single undo step, the same as typing a new value
into the Width/Length fields directly.

The hoverable/draggable zone straddling each edge is a constant 4 on-screen
pixels wide (not 4mm of world space) — hitting the exact boundary curve
isn't required or realistic, and a fixed mm-wide strip would shrink to a
sliver of actual screen pixels on a larger bin, well below what a mouse can
reliably land on.

The handles only appear while the toolshape itself is selected — selecting
one of its finger holes instead (they can visually sit right on an edge)
always deselects the tool first, so a finger-hole click on an overlapping
spot takes priority over starting a resize. The finger hole itself is
hidden for the duration of a resize gesture (from the first drag movement
through the server round-trip settling) rather than shown mid-resize at a
stale position, then reappears already at its new correct point on the
outline once the resize concludes. A finger hole's position is stored as
an arc-length distance along the outline, not a relative position on the
shape, so that distance is what's preserved exactly across a resize — the
hole can land on a different edge or corner than where it started, but
it's always a valid point on the (new) outline, never floating off it.

## Fillet bottom

Checking "Fillet bottom" rounds the pocket's bottom interior corner — the
edge where the vertical pocket wall meets the horizontal floor — instead of
leaving it a hard 90° edge. The radius is a fixed 1.5mm
(`gridshot/core/gridfinity.py`'s `TOOLSHAPE_FILLET_RADIUS_MM`), not
user-configurable: it's sized to be visible without being a dramatic
bevel. It only has a visible
effect at `fill_height_pct=100` (the default "pocket" bin style) — the
corral/grid styles don't cut a plain pocket cavity to begin with, so there's
no bottom corner to round there.

## Constraints

Toolshapes never appear in the Tool Library, aren't reachable from any
picker outside the bin they were placed in, and can't be reopened for
photo-based editing (there's no photo). Saving the bin, or using "⧉
Duplicate" on one, carries its shape and parameters forward like any other
tool's settings.
