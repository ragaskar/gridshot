# Align finger holes

With [multiple tools selected](combine-editor-multi-select.md) in the "Arrange multi-tool
bin" modal, an **Align finger holes** button appears in the Inspector's "Finger access"
section — below the on/off toggle, above Switch sides/Position. Unlike those two controls
it's always shown, just disabled until the selection qualifies.

## When it's enabled

At least two selected tools need finger access **on** and a slidable side (not the
[boundary-fallback "center" case](combine-finger-hole-position.md#constraints)), and every
one of those holes has to be travelling on the same axis in world space:

- **Horizontal**: every eligible hole sits on a top or bottom edge that's level in world
  space (the tool's rotation keeps that edge horizontal).
- **Vertical**: every eligible hole sits on a left or right edge that's plumb in world
  space.

A mixed group — some tools travelling horizontally, others vertically, or a tool rotated
to some in-between angle — leaves the button disabled.

Given a qualifying group, GridShot picks a reference hole: the bottom-most one (largest
world Y) for a horizontal group, or the left-most one (smallest world X) for a vertical
group. The button only enables if every *other* hole in the group can actually reach that
reference's line without exceeding its own [position range](combine-finger-hole-position.md)
— if even one tool would need to slide further than its edge allows, the whole button stays
disabled rather than partially aligning the group.

## What clicking it does

Every other selected tool's finger hole moves to line up with the reference hole — same
world X for a horizontal group, same world Y for a vertical one. The reference tool itself
doesn't move. Each tool gets its own distinct offset (unlike the shared-value Position
field above it, which sets every selected tool to the same offset) — this is about lining
holes up in space, not giving them a common numeric setting.

Like the existing [bounding-box align/distribute buttons](combine-editor-align.md), this
is a local rearrangement — it commits each tool's offset the same way the Position field
does, but doesn't involve any new geometry beyond what those already support.
