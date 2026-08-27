# Usable height in the multi-tool combine editor

The multi-tool combine editor's arrange page has a **Usable height (mm)**
field, next to the Bin Profile picker. It sets the bin's overall (finished)
height indirectly, in terms of the dimension that actually matters when
sizing a bin: how much depth is available below the "100% fill" line —
`fill_height_pct=100`'s own reference for where the general floor area
tops out.

## What it means

A finished bin's height splits into, from the bottom up:

- the base (a fixed `BASE_H`),
- the floor (`floor_thickness_mm`, a Bin Profile structural override — its
  own module default otherwise),
- the **usable** depth this field sets — the span "100% fill" measures
  against,
- the stacking lip, if "Stacking lip" is on (`lip_height_mm`, likewise a
  possible Bin Profile override).

Typing a usable height converts it into the equivalent overall height
(`usable + base + floor + lip`) using the *current* effective
floor/lip values — including whatever a Bin Profile has overridden them
to — and applies that as the same `overall_height` this editor already
supported before this field existed. Clearing the field reverts to
`overall_height = null` (auto: each tool's own natural required depth).

## Quantization is honest, not silent

Bin heights snap to whole 7mm gridfinity units (and are never shrunk below
whatever depth the deepest tool actually needs). The field always displays
the *actual* resulting usable height after that round-trip, not the raw
number typed — a small edit can leave it unchanged if it doesn't cross a
unit boundary, and a very small one can even be raised by a tool that
needs more room. That's the same honesty the (also pre-existing) overall
height already has; this field is just a more directly useful way to reach
it.

Toggling "Stacking lip" while a usable height is in effect can shift the
resulting overall height's own unit-quantization (a lipless bin's height
target isn't reduced by the lip before rounding) — this is the existing
overall-height/lip interaction, unrelated to this field specifically.
