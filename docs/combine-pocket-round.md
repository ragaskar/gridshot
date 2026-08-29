# Round pocket edges

**"Round pocket edges"** (internally still `bevel_pockets` — see
[Field name](#field-name)), in the multi-tool combine editor (Library →
*Arrange multi-tool bin*), rounds off the top edge of each tool's own pocket
cutout — the edge where the vertical pocket wall meets the bin's top
surface — so it isn't sharp to the touch. It's a bin-level flag, checked by
default, sitting alongside **Stacking lip** and **Magnet holes**.

The pocket outline, its finger-access holes, and their connector (the
stadium/capsule channel joining a two-lobe finger hole's pair of circles)
are all rounded the same way, so a tool's whole set of openings reads as one
consistent edge treatment.

Like [toolshapes' "Fillet bottom"](toolshapes.md#fillet-bottom) (a curved
round-over at a pocket's *bottom* interior corner), this is a curved fillet
rather than a flat chamfer — but a **convex** round-over (the edge is
rounded off, tangent to both the pocket wall and the top face) rather than
Fillet bottom's concave one (rounded inward, tangent to the wall and the
floor), since this is an outside corner instead of an interior one.

## Radius

The round-over radius is a fixed 0.6mm
(`gridshot/core/gridfinity.py`'s `POCKET_ROUND_RADIUS_MM`), not
user-configurable, sized to be visible without being dramatic — same
rationale as the toolshape fillet's fixed 1.5mm.

That 0.6mm is a ceiling, not a guarantee: the round-over flares each
pocket's opening outward by its radius on every side, so a bin with
unusually tight wall margins (a custom `min_wall_mm`, `tool_wall_mm`, or a
stacking lip's own cavity clearance, all configurable via a [Bin
Profile](bin-profiles.md)'s structural overrides) gets a proportionally
smaller round-over instead — down to none at all for margins already
thinner than any round-over — rather than risking a self-intersecting or
too-thin wall. It's also clamped to the pocket's own depth, so a very
shallow pocket never gets a round-over taller than itself.

## Scope

Only has a visible effect at `fill_height_pct=100` and live grid off (the
default "pocket" bin style) — same scoping as the toolshape fillet, and for
the same reason: the corral/grid styles build each tool as a raised wall
around an open shelf rather than cutting a cavity into solid material, so
there's no cut-pocket opening edge to round there. Toggling it on a
corral/grid-style bin is accepted, just has no effect until you switch back
to 100% fill with live grid off.

This is deliberately a bin-level setting, not a [Bin
Profile](bin-profiles.md) field — applying a profile doesn't change it
either way.

Single-tool bins and drawer compositions (Library's "Compose drawer") don't
have this flag yet — it's scoped to the combine editor, per the original ask.

The **trace-tolerance slice coupon** (the thin cross-section export used to
print-test fit before committing to the full bin) always samples the pocket
unrounded, regardless of this flag — a shallow pocket's slice window can
land within 0.6mm of the top, and the coupon exists to test the true wall
dimension, not the flared opening.

## Existing bins

Checked by default applies to bins saved before this existed too, not just
new ones: reopening or re-exporting an older saved bin now includes the
round-over unless you explicitly uncheck it. This is a deliberate geometry
change, not a bug — if a print you already have matches the old sharp-edge
geometry, re-exporting will look slightly different at the pocket openings.

## Field name

The flag started life as a straight chamfer named "Bevel pockets"; once it
became a curved, convex round-over the checkbox was relabeled "Round pocket
edges" to match. The underlying field — `bevel_pockets` in the request/save
JSON, `bevelPockets` in the frontend — kept its original name rather than
being renamed alongside it, since it's already persisted on saved bins and
part of the API surface; only the UI-facing label changed.
