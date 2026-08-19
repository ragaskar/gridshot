# Checking trace tolerance before you print the whole bin

Every generated bin now comes with an optional companion: a **1mm horizontal slice**
through the tool's pocket or recess, exported as its own small STL/3MF alongside the
full bin. Print just that coupon first, drop the real tool into it, and confirm the
cutout actually fits — before spending the filament and time on the whole bin.

## Why a 1mm slice is enough

Pocket and recess cutouts in GridShot are single constant-section extrusions — there
is no taper or draft angle on the walls. That means the cross-section of the cutout
is identical at every height within its depth, so a thin slice taken anywhere in that
range shows exactly the same trace the full bin would. You're not printing a
simplified approximation of the fit; you're printing a literal cross-section of the
real geometry.

This matters most when you're dialing in **printer compensation** — if the tool is
snug or loose in the slice, that's the signal to run
[`gridshot bench coupon`](../README.md#printer-compensation) and fit cavity scale/offset
for your specific printer, material, and nozzle, rather than guessing at clearance
values or reprinting the full bin repeatedly.

## Where to find it

The slice is downloadable from everywhere the full bin's STL/3MF is:

- **Single-tool Result page** — the download row now includes `slice (3mf)` and
  `slice (stl)` next to the full bin's `3mf`/`stl`. Hover either for a one-line
  reminder of what it's for.
- **Multi-tool combine bin** (Library → select 2+ tools → *Arrange multi-tool bin*)
  — an **"Export slice (3MF)"** button sits next to *Export bin (3MF)*. Because
  different tools in one bin can have different recess depths, this produces a
  single coupon that intersects **every** tool's cutout at once (see
  [How multi-pocket bins pick one slice](#how-multi-pocket-bins-pick-one-slice)
  below).
- **Drawer export** (Library → select tools → *Export*) — the downloaded zip gets a
  `slices/` folder alongside `bins/`, one `<label>-slice.3mf` per bin that could
  support one, plus a `slice_file` entry per bin in `manifest.json` (`null` when
  that bin's pocket was too shallow — see below).

## Choosing a thickness in the combine editor

The default 1mm thickness is a starting point, not a fixed rule. Clicking
**"Export slice (3MF)"** in the multi-tool combine editor opens a small
dialog first — pick anywhere from **0.5mm to 5mm** before the file
downloads (the field starts at 1mm). A thinner slice prints faster and uses
less filament for a quick fit check; a thicker one is sturdier to handle and
gives more of the wall to inspect at once. The "shallowest pocket too thin"
rejection above still applies at whatever thickness you choose.

## When there's no slice

A pocket or recess shallower than 0.4mm can't reliably print as a separate coupon, so
GridShot skips it rather than exporting a sliver:

- **Single-tool Result page** — a warning appears in the readiness/warnings list
  explaining the pocket was too shallow; the full bin still generates normally.
- **Multi-tool combine** — the `/api/library/combine/slice` request fails with a
  `422` naming the shallowest pocket's depth, since a shared slice can't be produced
  at all if it can't fit inside every tool's cutout.
- **Drawer export** — that bin's `slices/` entry is simply omitted, and its
  `manifest.json` record has `"slice_file": null`. The rest of the drawer's bins and
  slices are unaffected.

This is rare in practice — GridShot's minimum default pocket/recess depth is 2mm — and
mostly comes up if you've manually set a very shallow recess depth for something
unusually thin.

## How multi-pocket bins pick one slice

Every pocket or recess opens straight through to the top of the bin, regardless of
its own depth — a 4mm-deep pocket and a 9mm-deep pocket in the same bin are both open
all the way up to the stacking plane. That means a single height near the top of the
bin sits inside *every* pocket's depth range simultaneously, so one slice can show
every tool's cutout in a multi-tool bin at once, rather than needing a separate
coupon per tool.

The window is centered within the shallowest pocket's depth (clear of both the top
face and that pocket's floor) — see `slice_window()` in
[`gridshot/core/gridfinity.py`](../gridshot/core/gridfinity.py) if you're reading the
code. Widening a *deeper* pocket never moves the slice; only the shallowest one is
the binding constraint.
