# Bin Profiles v2: parameterized bin geometry (proposal)

**Status: proposal, not implemented.** This document is the design spec to build from,
not a description of shipped behavior — for that, see [bin-profiles.md](bin-profiles.md).

## Motivation

Bin Profiles (shipped) replaced hardcoded style buttons with named, editable presets — but
what they're presets *of* is still a closed 3-way enum, `base_style: "pocket" | "corral" |
"grid"`, hardcoded as a branch in `bin_solid()` and threaded through `derive_tool_spec()`,
`LibraryTool`, `SavedBin`, `CombineRequest`, and `BinProfile.base_style`. A preset of a
closed enum can rename and bundle the three styles, but it can't express anything between
or beyond them — the profile mechanism is only as composable as what it's a profile *of*.

Tracing `bin_solid()`'s actual construction shows the three styles were never three
fundamentally different things — they're specific points reached by two independent,
already-latent parameters. This proposal makes those parameters real and continuous
instead of enum-shaped, so new bin styles become combinations you can reach by turning a
number, not new code paths someone has to write.

## The core model

### `fill_height_pct` (float, 0–100, bin-wide)

Today's corral/grid construction already builds three structural pieces unconditionally,
regardless of any tool's depth: a thin **deck** across the whole footprint, the **outer
wall**, and each tool's own **wall + shelf** (full height, from the deck up to that
tool's own recess floor). What corral leaves permanently hollow is everything else — the
general floor area between tools, inside the outer wall, above the deck.

`fill_height_pct` is a knob on exactly that leftover region, and only that region:

- `fill_top_z = deck_top + (fill_height_pct / 100) × (total_h − deck_top)`
- The general floor area — footprint minus the union of every tool's own wall-bounded
  footprint minus the outer wall ring — is solid from `deck_top` up to `fill_top_z`,
  hollow from there to `total_h`.
- `fill_height_pct = 0` → nothing added → today's corral, unchanged.
- `fill_height_pct = 100` → `fill_top_z = total_h` → the whole general area is solid,
  clear to the top → today's pocket.

**Sized against the bin's own height, never against any individual tool's depth.** A
deep tool makes the bin itself taller (today's existing, separate height-sizing
mechanism), which changes how much absolute material a given percentage represents — but
the percentage itself has no per-tool reference point, because the general-fill region is
excluded from every tool's own wall footprint at every height, not just at the tool's own
floor level. A shallow tool and a deep tool sitting in the same bin don't affect each
other here.

*Worked example:* a 100mm-tall bin, deck at 6mm (`floor_thickness_mm`), holding a 50mm-deep
tool somewhere in it. The general floor area spans 6mm→100mm (94mm of range). At 50%
fill, that area is solid from 6mm to 53mm and hollow from 53mm to 100mm — completely
independent of where that 50mm-deep tool's own pocket floor happens to sit, because the
tool's own wall+shelf column was already carved out separately and isn't part of this
calculation.

### `live_grid` (bool, bin-wide — name unchanged)

Adds gridfinity baseplate sockets to any grid cell no tool's wall+clearance envelope
reaches, independent of `fill_height_pct`. The cell-eligibility test
(`grid_available_cells`/`grid_reserved_cells`) is already pure XY-plane geometry today —
it never looks at style — so no new predicate is needed. The only new step: an eligible
cell that would otherwise be solid (inside the `fill_height_pct` region) gets locally
hollowed to `floor_thickness_mm` first, then the socket unions in exactly like today's
corral/grid case.

New reachable failure mode: the existing "≥2u so socket walls stay below the stacking
plane" check currently only fires for `style == "grid"`. Once `live_grid` can pair with
any `fill_height_pct`, a short bin with `live_grid` on becomes a new, previously
unreachable error path that needs its own test.

### `tool_wall_mm` and friends (bin-wide, scope unchanged from today)

Real geometry — the separator/base/shelf structure — wherever there's still hollow space
above the general fill for a wall to bound, i.e. whenever `fill_height_pct < 100`. At
`fill_height_pct = 100` there's nothing hollow left anywhere, so no *new* geometry
appears — but the field still feeds the auto-pack clearance margin around each tool,
exactly as it already does today (currently gated to corral/grid only; this proposal
just removes that gate).

## Parameter map: current → proposed

| Current field | Proposed field | Change |
|---|---|---|
| `base_style: "pocket"\|"corral"\|"grid"` | `fill_height_pct: float` (0–100) **+** `live_grid: bool` | Replaced — the enum was two independent bits; split into them directly |
| `corral_wall_mm` | `tool_wall_mm` | Renamed |
| `corral_base_flare_mm` | `tool_wall_flare_mm` | Renamed |
| `corral_base_reinforcement_h_mm` | `tool_wall_reinforcement_h_mm` | Renamed |
| `corral_floor_mm` | `floor_thickness_mm` | Renamed — the deck's own thickness, i.e. `fill_height_pct`'s `0%` baseline |
| `corral_edge_margin_mm` | `edge_margin_mm` | Renamed |
| `min_wall_mm` | *(unchanged)* | Outer wall thickness — already un-branded, not worth churning |
| `min_floor_mm` | *(unchanged)* | Pocket fast path's own depth guard, unrelated to any of this |
| `lip`, `lip_height_mm`, `lip_chamfer_top_mm`, `lip_straight_mm`, `lip_chamfer_bottom_mm` | *(unchanged)* | Orthogonal to all of this |
| `magnet_holes_default`, `magnet_hole_diameter_mm_default`, `magnet_hole_depth_mm_default`, `magnet_hole_inset_from_edge_mm` | *(unchanged)* | Orthogonal to all of this |
| `allow_custom_shape` | *(unchanged)* | Still gated to `fill_height_pct = 100` for now — not a fundamental limit (see below), just deferred |

## How the old types parameterize

| Old `base_style` | `fill_height_pct` | `live_grid` | What's actually happening |
|---|---|---|---|
| `pocket` | `100` | `False` | General floor area solid clear to `total_h` — no visible wall geometry anywhere |
| `corral` | `0` | `False` | General floor area fully hollow above the deck — unchanged |
| `grid` | `0` | `True` | Same, plus sockets fill whatever cells no tool's wall+clearance envelope reaches |
| *(new — unbuilt today)* | `0 < x < 100` | either | General floor area solid from the deck up to `fill_top_z`, hollow above — each tool's own wall doing real, partial-height work bounding the hollow above the fill line |

Three named presets sit at fixed points on one continuous, bin-wide axis, plus one
independent toggle. Everything between and around those three points is real,
addressable territory instead of a fourth hardcoded style.

## `bin_solid()` construction changes

- **Pocket keeps its exact existing single-extrusion code path** as a fast path for
  `fill_height_pct = 100` — guarantees byte-identical mesh output for the default case,
  and sidesteps any question about whether the general construction's boolean unions
  reproduce the same triangulation (they should reproduce the same *volume* regardless).
- **Every other value** routes through one general construction: deck + outer perimeter +
  each tool's own wall/shelf (all unconditional, exactly as today's corral/grid already
  build them) + a new general-fill boolean op — extrude `outer_footprint minus (union of
  every tool's own wall footprint)` from `deck_top` to `fill_top_z`, union it in.
- **Two depth guards stay two guards, not merged:** the fast path keeps
  `floor_z < BASE_H + min_floor_mm`; the general path keeps `floor_z < deck_top`, because
  every tool's own wall+shelf construction is unconditional and independent of
  `fill_height_pct`'s value — that guard doesn't change no matter what the general floor
  area is doing.
- **`live_grid`'s eligibility test is unchanged.** Only the host geometry for an
  eligible-but-currently-solid cell changes (local hollow-to-`floor_thickness_mm`, then
  socket, as above).
- **Custom bin shape (`included_cells`) stays gated to the fast path in v1.** Not a
  fundamental restriction — the general construction's deck/perimeter/general-fill are
  still built from a fixed outer rect rather than the (possibly polyomino) `outline`.
  Extending it means teaching that construction to consume `outline` instead, *and*
  making the "does a removed cell clash with the grid edge" check account for both the
  outer wall thickness and the tool wall thickness (real geometry once
  `fill_height_pct < 100`). Real, well-defined follow-up work — explicitly out of scope
  for this proposal.
- **Dead code to collapse while this is being touched:** `style_finished_height_mm` and
  `height_u_for_style_overall` already ignore their `style` argument entirely and
  delegate straight to the style-less versions — drop the parameter (or the wrapper
  functions) as part of this pass.

## Migration

`bin_style`/`base_style` is persisted on `LibraryTool`, `SavedBin`, `CombineRequest`, and
`BinProfile.base_style`, plus a dozen-plus `Literal["pocket","corral","grid"]` echoes
across `app.py`. The mapping is exact and lossless:

| Legacy `bin_style` | `fill_height_pct` | `live_grid` |
|---|---|---|
| `pocket` | 100 | `False` |
| `corral` | 0 | `False` |
| `grid` | 0 | `True` |

Rollout:

1. Add `fill_height_pct`/`live_grid` (and the renamed `tool_wall_*`/`floor_thickness_mm`/
   `edge_margin_mm`) everywhere the old fields live, alongside them.
2. Backfill on read: any record with only the legacy fields gets the new ones derived via
   the table above.
3. Keep writing `bin_style` as a closest-legacy label for one deprecation window, so a
   client that hasn't updated yet doesn't break mid-rollout.
4. Drop `bin_style` once nothing reads it.

The three seeded Bin Profiles (Pocket/Corral/Live Grid) keep working unmodified through
the whole migration — they become named presets of the new fields instead of the enum,
which is exactly what Bin Profiles were already supposed to be.

## Phasing

- **Phase A — pure refactor.** Rename the 5 `corral_*` fields, add `fill_height_pct`/
  `live_grid`, migrate off the enum via the mapping above, collapse the dead `style`
  parameters. Pocket's and corral/grid's existing code stay essentially as they are,
  just re-gated on the new fields instead of the enum. **Acceptance: byte-identical mesh
  for all three legacy combos.**
- **Phase B — ship the new territory.** The general-fill boolean op for intermediate
  `fill_height_pct` values; `live_grid` paired with any `fill_height_pct` (the
  previously-`grid`-only ≥2u check now reachable from any of them; the packing-margin
  gate widened from "style in (corral, grid)" to "`fill_height_pct < 100 or
  live_grid`"). **The Bin Profile editor exposes `fill_height_pct` as a real 0–100
  slider from the start**, not gated behind a later phase — the field is continuous at
  the API/geometry level from Phase A onward, so a slider instead of a checkbox is a
  difference in which control is bound to the field, not new plumbing.

**Explicitly deferred, not a phase:** custom bin shape at `fill_height_pct < 100` (see
the `bin_solid()` section above) — real, scoped, and intentionally not part of this
pass.

## Open items to verify during implementation, not decided here

- Whether the general construction's boolean unions ever produce a degenerate/duplicate
  coplanar face where the deck, the general-fill block, and a tool's shelf all meet —
  worth a mesh-validity check in Phase A/B tests, not a design concern.
- Exact wording/placement of `fill_height_pct` in the Bin Profile editor's "Wall & Floor
  Thickness" section once Phase B's slider ships.
