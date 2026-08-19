# Forcing an exact bin size

By default, the multi-tool combine editor (Library → *Arrange multi-tool
bin*) sizes the bin to the smallest gridfinity footprint that fits whatever
auto-pack (or your own dragging) produces. Sometimes you need the bin to be
an *exact* size instead — to match an existing baseplate, a drawer's fixed
layout, or a footprint you've already committed to elsewhere.

## Enabling it

Check **"Force bin size"** in the right-hand panel. It seeds the width/depth
fields with the bin's current auto-computed size (in **gridfinity units**,
the same `gx × gy` shown in the header — not millimetres, since bins snap to
the 42mm pitch anyway). Change either field and auto-pack re-solves within
that exact footprint.

Auto-pack does its best to fit everything within the forced size. If it
can't — some tool doesn't fit at any rotation/position within the bound —
the request fails with a clear error naming the tool that didn't fit, and
both export buttons disable until you either grow the forced size or turn
it off.

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
