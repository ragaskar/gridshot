# Finger-hole position

By default, GridShot picks a finger-access scallop for each tool
automatically — a spot on the pocket's boundary that lets you lift the tool
out without growing the bin's footprint. The multi-tool combine editor
(Library → *Arrange multi-tool bin*) lets you move that hole anywhere on the
pocket's outline, per tool, per bin, without touching the tool's library
settings.

## Selecting and moving a hole

Click inside a tool's finger-access circle (the dashed scallop) to select
it — this deselects any selected tool, since a hole and a tool are separate
selections. The Inspector panel switches to show the hole's position in mm
(X/Y, relative to the overall bin footprint's own bottom-left corner — see
[below](#coordinates)) instead of the usual tool fields.

- **Drag** the hole with the mouse. It always stays snapped exactly onto the
  tool's own outline — dragging projects your pointer onto the nearest point
  of the boundary, so you can't lift it off the tool or drop it in open air.
- **Left/Right arrow** slides it along the outline, forward or back, by the
  same [nudge step](combine-editor-nudge.md) (and Shift for 10×) as moving a
  tool.
- **Up/Down arrow** jumps it straight across to the opposite side of the
  tool — same world X, the other side of the tool's own vertical midline —
  or does nothing if it's already there. Shift+Up/Shift+Down are explicit
  no-ops, not a bigger jump.
- **Esc**, or clicking empty space or another tool, deselects the hole.

Every existing tool/bin's finger hole keeps the exact position it always
had the first time you open it — GridShot only starts tracking the new
free-form position once you actually move it.

**One-time fix note:** a server-side bug meant a moved hole's saved position
could resolve to the wrong spot once reopened or rendered in 3D — the exact
point shown live while dragging in Arrange 2D, but a *different* point once
that same arc-length number was re-interpreted server-side. This is fixed
going forward; a hole moved and saved *before* the fix may show up somewhere
else the next time you open that bin. Re-drag or re-Align it once and it's
fine from then on — this only affects the first reopen after the fix, not
the position model itself.

## Coordinates

The X/Y readout in the Inspector is in millimetres, from the *overall*
gx×gy grid footprint's bottom-left corner — the same footprint the bin
renders at, before any [custom bin shape](combine-custom-bin-shape.md)
removes cells from it. It updates live while you drag or nudge, to 0.01mm
resolution.

## Size

Selecting a hole also shows its diameter in the Inspector, in mm. It defaults to
20mm — the size GridShot has always cut — until you change it for that tool, in
that bin.

- Type a value for 0.1mm precision. The field's spinner arrows step by a
  whole 1mm at a time; type directly into the field for anything finer.
- The hole grows or shrinks **around its current position on the outline** —
  changing the diameter never slides the hole along the boundary or off it,
  only how big a bite it takes out of the pocket wall there.
- Like position, this is a bin-time-only override: it doesn't touch the
  tool's library settings, and it's independent of every other tool's finger
  hole in the same bin.

## Span

A hole can also be turned into a two-lobe pill spanning both sides of the
tool instead of a single circle — see [finger-hole
span](combine-finger-hole-span.md).

## Multi-select

There's no bulk position editing across a multi-tool selection — a finger
hole is always selected and moved one at a time. [Align finger
holes](combine-editor-align-finger-holes.md) is still available across a
multi-tool selection, for snapping several holes onto one line.
