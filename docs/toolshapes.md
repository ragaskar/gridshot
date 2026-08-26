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
Click anywhere on the grid to place it at that exact point. Esc cancels
placement mode without creating anything.

Once placed, the toolshape is auto-selected and behaves like any other
tool: it gets its own id (`bintool-*`, private to this bin — see
[library-clone-tool.md](library-clone-tool.md) for the sibling "⧉
Duplicate"/"⧉ Clone" mechanism this reuses under the hood), and the
inspector shows both its own width/length/radius/fillet fields *and* every
control that already applies to any tool — height, rotation, clearance,
finger hole, pocket-depth override, and so on. Editing width/length/radius
regenerates its outline immediately; editing everything else works exactly
as it does for a photo-traced tool.

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
