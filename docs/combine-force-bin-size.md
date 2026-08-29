# Forcing an exact bin size

By default, the multi-tool combine editor (Library → *Arrange multi-tool
bin*) sizes the bin to the smallest gridfinity footprint that fits whatever
auto-pack (or your own dragging) produces. Sometimes you need the bin to be
an *exact* size instead — to match an existing baseplate, a drawer's fixed
layout, or a footprint you've already committed to elsewhere.

## Enabling it

Check **"Force size"** in the right-hand panel's **Grid config** section
(closed by default). It seeds the width/depth fields with the bin's current
auto-computed size (in **gridfinity units**, the same `gx × gy` shown in the
header — not millimetres, since bins snap to the 42mm pitch anyway). Change
either field and auto-pack re-solves within that exact footprint.

The checkbox itself disables once any grid square has been removed (see
[docs/combine-custom-bin-shape.md](combine-custom-bin-shape.md)) — clear the
grid edits first if you need to turn "Force size" back off.

Auto-pack does its best to fit everything within the forced size. If it
can't — some tool doesn't fit at any rotation/position within the bound —
the request fails with a clear error naming the tool that didn't fit, and
both export buttons disable until you either grow the forced size or turn
it off.

## The 2D view is locked, not re-fit

With "Force size" checked, the bin footprint shown in **Arrange 2D** is
fixed to the width/depth you set — it does not grow or shrink as tools move,
whether they got there via auto-pack or your own dragging. This applies
equally to manual placement: drag a tool around and the bin rectangle stays
put.

If a tool's pocket or finger-access cutout crosses the locked bin's edge, it
switches to a warning color (red) so it's obvious at a glance. **Preview 3D**
is disabled while any tool is outside the locked footprint (it needs valid
geometry to build a solid) — drag the tool back inside, click **Auto-pack**
to re-solve within the bound, or grow the forced size to fit it.

**Export bin**, **Export slice**, and the autosave to the bin's own Bin
Library entry stay available even with a tool outside the footprint — you
can still capture the
arrangement (a tool's location may come out wrong in the export until you
fix the overlap), which matters if you need to save your progress and
resolve the boundary problem after reloading.

Unchecking "Force size" hands the footprint back to auto-fit: the bin
immediately re-renders to the smallest size that contains the current
arrangement, same as before the box was checked.

## Constraints

- Width and height must both be set together — there's no such thing as
  forcing only one axis.
- A forced size is honoured exactly, even if the packed arrangement would
  fit into something smaller — GridShot doesn't shrink it back down for you.
- Rotation lock (see
  [docs/combine-editor-rotation-lock.md](combine-editor-rotation-lock.md))
  composes with a forced size: a locked tool's single allowed rotation is
  what auto-pack tries to fit within the forced bound, same as any other
  tool.
