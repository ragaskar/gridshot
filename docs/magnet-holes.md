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
  --magnet-hole-depth 2.0`.

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

## Placement, for anyone reading the geometry code

Each hole sits at `±13.0mm` from its foot's center on both axes — derived the
same way gridfinity-rebuilt-openscad derives it: the foot's bottom face is
35.6mm square (`BIN_SIZE − 2×(top chamfer + bottom chamfer)`), and each hole
centers 4.8mm in from that edge, per the gridfinity.xyz spec
(`HOLE_DISTANCE_FROM_BOTTOM_EDGE`). See `MAGNET_HOLE_OFFSET_MM` and
`bin_solid()` in
[`gridshot/core/gridfinity.py`](../gridshot/core/gridfinity.py).
