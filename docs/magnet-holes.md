# Magnet holes

Every bin GridShot generates can optionally get magnet holes: one hole at each
corner of every foot, matching the placement used by the wider Gridfinity
ecosystem (gridfinity-rebuilt-openscad and gridfinity.xyz's own spec), so bins
seat on the same magnetic baseplates as everything else in that ecosystem.

## Enabling it

There's no separate "magnet bin" style — it's a checkbox plus two numbers
(diameter and depth) available wherever a bin gets generated:

- **Single-tool Result page** — the "Adjust bin" panel, alongside pocket depth
  and finished-height overrides. Regenerate to apply.
- **Library card** — each saved tool has its own "Magnet holes: on/off"
  toggle next to "Finger access"; diameter/depth fields appear once enabled.
- **Multi-tool combine bin** (Library → *Arrange multi-tool bin*) — one
  checkbox for the whole combined bin, since magnet holes are a per-foot
  property of the finished object, not a per-tool one.
- **CLI** — `gridshot trace ... --magnet-holes --magnet-hole-diameter 6.5
  --magnet-hole-depth 2.0 --magnet-corners-only`.

Defaults are **6.5mm diameter, 2mm depth** — the same nominal size
gridfinity-rebuilt-openscad's Customizer describes as "holes for 6mm Diameter
x 2mm high magnets" (the 0.5mm over the magnet's own 6mm keeps the fit easy
rather than pressed).

## Constraints

Magnet holes are cut straight down from the bottom of each foot. Depth must
stay under the foot's own height (**4.75mm**) — deep enough to eat into that
would puncture through the top of the foot into the bin's floor. GridShot
rejects that combination with a clear error rather than generating a bin with
a hole through its floor.

For a multi-tool combine bin where different tools have different pocket
depths, the magnet-hole setting is still just one checkbox for the whole
bin — it only affects the feet, which are shared, unlike each tool's own
recess depth.

## Corners only

A hole at every corner of every foot is a lot of print time on a large bin,
and most of those holes aren't doing anything a neighboring bin or plain
friction wasn't already providing — only the feet at the bin's own outer
corners are load-bearing for keeping it seated on a baseplate. Checking
**"Corners only"** (alongside the magnet-holes checkbox, wherever it appears)
cuts holes only at the foot corners that are convex corners of the bin's own
footprint — for a plain rectangular bin, exactly 4 holes total, regardless of
how many feet it has.

This also works for a "custom bin shape" (an irregular polyomino footprint,
built by removing grid cells): a corner counts if the two cells orthogonally
adjacent to it — the one sharing an edge in x, and the one sharing an edge in
y — are both absent (including "off the edge of the grid" as absent). A
notch cut into a rectangle's corner exposes new convex corners this way, so
it still gets pinned; a cell in the middle of a straight or concave edge
doesn't. See `_magnet_corner_signs()` in `gridshot/core/gridfinity.py`.

## Placement, for anyone reading the geometry code

Each hole sits at `±13.0mm` from its foot's center on both axes — derived the
same way gridfinity-rebuilt-openscad derives it: the foot's bottom face is
35.6mm square (`BIN_SIZE − 2×(top chamfer + bottom chamfer)`), and each hole
centers 4.8mm in from that edge, per the gridfinity.xyz spec
(`HOLE_DISTANCE_FROM_BOTTOM_EDGE`). See `MAGNET_HOLE_OFFSET_MM` and
`bin_solid()` in
[`gridshot/core/gridfinity.py`](../gridshot/core/gridfinity.py).
