# Bin height and per-tool height mode in the multi-tool combine editor

Two related controls on the arrange page govern how deep a bin (and each
tool's pocket in it) ends up: the bin-level **Bin height (units)** field,
and each tool's own **Height** mode (Auto / Fixed / Percentage).

## Bin height (units)

Next to the Bin Profile picker, **Bin height (units)** sets the bin's
overall height directly in whole gridfinity units — always a whole
number, 1 minimum. Hovering the ⓘ next to the label explains the two
things people get wrong first: *"Gridfinity bin heights use 7mm
increments. Lip height is NOT included in this value."*

That is, the number typed here is `height_u`; the finished bin is
`height_u × 7mm` plus the stacking lip's own height on top if lip is on
(`gridshot/core/gridfinity.py`'s `finished_height_mm()`). Below the field:

- **ACTUAL \<n\>mm, USABLE \<n\>mm** — the actual finished height (base +
  floor + usable + lip), and the usable depth below the "100% fill" line
  (base + floor subtracted, lip too if on) that "Auto"/"Percentage" tool
  heights (below) are computed against. Hovering the ACTUAL figure shows a
  right-aligned breakdown of exactly how it's built:

  ```
  base            4.75mm
  floor            1.2mm
  usable height  22.05mm
  lip              4.4mm
  ----------------------
  4u + lip        32.4mm
  ```

  (the `lip` row, and the ` + lip` on the total line, are omitted when
  Stacking Lip is off).
- **"Tool height requires a min of \<n\>"** — shown whenever any tool in
  the bin is in **Fixed** height mode: a fixed mm depth needs a minimum
  number of units to physically fit (base + structural floor + that
  depth), and the bin height field is clamped up to it if typed lower.
  Only Fixed tools impose this floor — Auto/Percentage tools adapt to
  whatever height results instead of demanding one.
- **"Clear all fixed tool heights"** — appears only when at least one
  tool is Fixed. Clicking it asks for confirmation ("All fixed tool
  heights will be cleared."), then reverts every tool in the bin to Auto.

## Per-tool height mode

Each tool's inspector has a **Height** dropdown, right below its "Pocket
depth"/"Tool recess" readout:

- **Auto** (default) — the pocket fills 100% of the bin's usable height.
  Every Auto tool in a bin gets the *same* depth, regardless of how tall
  the tool physically is — this is a deliberate change from the old
  "automatic" depth, which sized each tool to its own measured full
  height + a small margin, independent of the bin at all. That
  tool-intrinsic depth still exists internally as a seed value (see
  below) but is no longer what "Auto" resolves to.
- **Fixed** — an exact depth in mm, typeable to 0.1mm resolution. This is
  the same override mechanism the old "Override pocket depth" checkbox
  used. Switching a tool *into* Fixed seeds the input with that tool's
  own legacy natural depth (full height + margin) rather than whatever
  its current effective depth happens to be — a sane, tool-specific
  starting point instead of an arbitrary one.
- **Percentage** — a percentage (above 0, up to 100, typeable to 0.1) of the bin's
  usable height, resolved fresh on every request against whatever the
  bin's *current* usable height is (same as Auto, which is exactly
  Percentage pinned at 100). Both Auto and Percentage show the resulting
  mm figure (rounded to 0.1) next to the input.

The three modes are mutually exclusive — switching to one clears the
other's stored value, so a later switch back never silently resurrects a
stale number. On a multi-tool selection, picking Fixed or Percentage
seeds a shared draft (when every selected tool currently agrees) or an
empty one, and doesn't commit anything until a value is actually typed —
the same non-committing-draft behaviour the old override checkbox had.

## Why a 100%-fill tool never violates the structural floor

A Bin Profile can set the general floor thickness (`floor_thickness_mm`)
and the minimum structural floor under a pocket (`min_floor_mm`)
independently. An Auto/Percentage tool's depth is resolved against
`max(floor_thickness_mm, min_floor_mm)`, not `floor_thickness_mm` alone —
otherwise a profile with a *thinner* general floor than its own minimum
pocket floor could produce a 100%-fill tool whose pocket cuts is deep
enough to trip `bin_solid`'s own too-deep guard, on a bin the user never
asked to push to its limit.

## Migration note

A bin saved before this feature existed has every tool in "automatic"
depth mode server-side (no persisted `pocket_depth_mm`/`pocket_depth_pct`)
— the very first time such a bin is reopened, every one of those tools
now resolves to Auto (100% of the bin's usable height) instead of its old
tool-intrinsic depth. For a bin with tools of noticeably different
physical heights, this is a visible, one-time change in resulting
geometry — switch any tool that should stay shallow to Fixed or
Percentage.
