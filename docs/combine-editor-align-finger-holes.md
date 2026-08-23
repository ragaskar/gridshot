# Align finger holes

With [multiple tools selected](combine-editor-multi-select.md) in the "Arrange multi-tool
bin" modal, an **Align finger holes** button appears in the Inspector's "Finger access"
section. It's always shown, just disabled until the selection qualifies.

## When it's enabled

At least two selected tools need finger access **on**, and every one of those holes has
to be travelling on the same axis in world space as its arc-length position changes:

- **Horizontal**: every eligible hole's outline runs level (in world space) at its current
  position.
- **Vertical**: every eligible hole's outline runs plumb (in world space) at its current
  position.

A mixed group — some holes travelling horizontally, others vertically, or one sitting on
a diagonal/curved stretch of outline — leaves the button disabled.

## What clicking it does

Given a qualifying group, GridShot picks a reference hole: the bottom-most one (smallest
world Y) for a horizontal group, or the left-most one (smallest world X) for a vertical
group. Every other selected tool's finger hole slides along its own outline to line up
with the reference hole's line — same world X for a horizontal group, same world Y for a
vertical one. The reference tool's hole doesn't move.

The new position is a first-order estimate along the hole's current direction of travel:
exact when the hole sits on a straight edge (the common case), an approximation if it's
on a curved or rounded-corner stretch of the outline. Each tool gets its own distinct new
[position](combine-finger-hole-position.md) — this is about lining holes up in space, not
giving them a common numeric setting.

Like the existing [bounding-box align/distribute buttons](combine-editor-align.md), this
is a local rearrangement you can always follow up by dragging or nudging a hole further
by hand.
