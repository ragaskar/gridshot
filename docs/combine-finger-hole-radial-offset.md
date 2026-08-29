# Finger-hole radial offset

By default a finger hole's center sits exactly on the pocket's outline —
half the circle over solid wall, half over the cavity. **Radial offset**
shifts that center perpendicular to the outline at its own point: negative
pulls it toward the tool's own centreline ("in"), positive pushes it away,
into the surrounding wall ("out"). At 0 (the default) it's exactly where it
always was.

Radial offset is per tool, per bin — the same bin-time-only override model
as [position](combine-finger-hole-position.md#selecting-and-moving-a-hole),
[size](combine-finger-hole-position.md#size), and
[span](combine-finger-hole-span.md), set in the multi-tool combine editor's
Inspector once a hole is selected.

## Setting it

With a hole selected, type into the **Radial offset** field in the
Inspector, right below Diameter. It defaults to 0mm.

- Type a value for 0.1mm precision — the field's spinner arrows step by
  0.1mm.
- A large enough offset (relative to the hole's own diameter) clears the
  outline entirely: negative enough and the whole circle sits inside the
  pocket cavity; positive enough and it sits entirely in the wall, outside
  the pocket. A 1mm-diameter hole with a -1mm offset ends up fully inside;
  the same hole with a +1mm offset ends up fully outside — *away from a
  corner*. A hole near a corner can clip the *adjacent* edge before it
  clears the one it started on, since the two edges are close together
  there; how large an offset actually clears the outline depends on where
  on the tool the hole sits, not just its diameter.
- Offset is independent of arc-length position — moving the hole along the
  outline (drag, Left/Right, Up/Down) keeps whatever offset it has; changing
  the offset never slides the hole along the outline.
- **Span** holes apply the same offset magnitude to both focal points, each
  measured along its *own* local outward normal — the two lobes usually sit
  on different parts of the outline, so "out" can point in different
  directions for each.

## What it doesn't affect

Diameter, arc-length position, and every other tool's own finger hole in
the same bin are all independent of this. A large offset can grow the bin's
own footprint, the same way a bigger diameter already can, to keep the
(possibly now detached) circle fully enclosed — but doesn't otherwise
reshape anything else in the bin.
