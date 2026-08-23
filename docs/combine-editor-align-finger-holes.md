# Align finger holes

Click a tool's finger hole in the "Arrange multi-tool bin" modal to select it, then
shift-click another to add it to the selection — same shift-click-to-add gesture as
[multi-selecting tools](combine-editor-multi-select.md), but for finger holes
specifically. With 2+ finger holes selected this way, an **Align finger holes** button
appears in the Inspector. Selecting *tools* (rather than their holes) never shows or
enables this button, even with several selected — click the holes themselves.

While 2+ finger holes are selected, **Left/Right** (and Shift for ×10) nudges every one
of them at once, along each hole's own outline — the same step as a single hole's nudge.
Up/Down, drag, span toggle, and diameter stay single-hole actions and aren't available
once more than one hole is selected. A [span](combine-finger-hole-span.md) hole moves
*both* of its focal points together under a multi-select nudge (unlike a single-selected
span hole, where Left/Right only moves whichever point you clicked).

## When Align is enabled

At least two selected finger holes need to exist, and every one of them has
to be travelling on the same axis in world space as its arc-length position changes:

- **Horizontal**: every eligible hole's outline runs level (in world space) at its current
  position.
- **Vertical**: every eligible hole's outline runs plumb (in world space) at its current
  position.

A mixed group — some holes travelling horizontally, others vertically, or one sitting on
a diagonal/curved stretch of outline — leaves the button disabled. For a
[span](combine-finger-hole-span.md) hole, **both** focal points have to qualify — a span
hole whose second point sits on a curved or off-axis stretch disables the button even
though its first point is fine.

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

## Mixing single-point and span holes

The reference is always picked by its **first** focal point (P1) — a
[span](combine-finger-hole-span.md) reference's P1, same as a single-point hole's only
point. Every other tool's P1 always aligns to the reference's P1 line. Beyond that:

- **Reference is single-point**: no target's second point is ever touched, even if the
  target itself is a span hole — only its P1 moves.
- **Reference is a span hole**: every other span hole's second point *also* aligns, to
  the reference's second point's own line (a separate line from P1's — a span hole's two
  points aren't usually at the same world X/Y). A single-point target still only has a P1
  to move.

Size is never touched by align, on either point — it only ever moves focal points onto a
line. To match every selected tool's hole *type and size* to one tool's, without moving
anything, see [Copy style](combine-editor-copy-finger-hole-style.md) instead.
