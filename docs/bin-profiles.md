# Bin Profiles

**Bin Profiles** replace the old hardcoded "Pocket / Corral / Live grid" bin styles with
named, user-editable presets of a bin's *style* — the stacking lip, which of the three
underlying geometry modes to build, magnet-hole defaults, whether custom bin shape is
offered, and (for advanced use) the structural constants that shape the lip, walls,
floor, and corral/grid deck. A profile never carries per-combine content — tool
selection, placements, overrides, overall height, forced footprint, or which cells are
removed all stay exactly where they already live, on the combine request itself.

Applying a profile is a **one-time copy** into whatever's picking a bin style, not a
live reference: editing or deleting a profile later never changes a bin already built
from it.

This landed in phases; it's now complete — storage, CLI, geometry, the REST API, the Bin
Profiles page, and every picker converted to use it.

## Where you apply a profile

Every place that used to offer a hardcoded Pocket/Corral/Live Grid button group now
offers a **Bin profile** dropdown instead:

- The multi-tool **combine editor** — applies base style, lip, allow-custom-shape,
  magnet-hole defaults, and every structural override. A fresh combine (not reopened
  from the Bin Library) auto-applies the first profile in the list as soon as it loads —
  no undo step, since it's the starting state rather than something you did. Reopening a
  saved bin instead shows whichever profile was applied when it was last saved (or no
  selection, for bins saved before this existed) — the picker's selection is stored on
  the saved bin as `applied_profile_id`, alongside the fields it set.
- **Upload** (single-tool capture) — applies base style and lip (this page already had
  its own independent lip toggle, kept as-is).
- The **Result** page's regenerate flow — applies base style, lip (a control this page
  didn't have before — added as part of this conversion), and magnet-hole defaults.
- Each tool's card in the **Tool Library** — applies base style and magnet-hole defaults
  only; a per-tool `lip` default isn't editable through this control today (the
  underlying update endpoint doesn't accept it yet), so it's the one picker with
  narrower parity than the other three.

Applying a profile anywhere is always the same one-time-copy semantics: every field it
sets becomes independently editable again immediately afterward, and picking a different
profile later, or editing/deleting the one you picked, never reaches back into a bin (or
tool default) you already built with it.

## The Bin Profiles page

A new **Bin Profiles** entry in the top nav lists every profile as a card (thumbnail,
name, base style, lip on/off), plus a **"+ New bin profile"** tile. Three are seeded for
you — Pocket, Corral, Live Grid — reproducing today's hardcoded styles exactly.

Clicking a card (or "+ New") opens its editor: a live 3D preview of the synthetic
4×4-unit/2×2-pocket bin next to every field — name, base style, and "Allow custom grid
shape" (an independent checkbox, not derived from base style — checking it for
Corral/Live Grid shows a note that cell removal isn't supported there yet, since the
underlying geometry can't do it regardless of the checkbox), followed by three visible
sections (no accordion — these are the values you're actually here to edit, not hidden
extras):

- **Stacking Lip** — the on/off checkbox plus the lip's own dimensional overrides
  (height, both chamfers, straight section). The four dimensional fields are always
  shown, disabled (not hidden) while the checkbox is off, each starting blank
  (inheriting gridfinity.py's constant) with its default shown as a placeholder.
- **Magnet Holes (default)** — the on/off checkbox plus diameter, depth, and inset-from-edge,
  shown together once it's checked.
- **Wall & Floor Thickness** — pocket wall/floor thickness and the corral/live-grid
  deck's floor, wall, base flare, base reinforcement height, and edge margin; applies
  regardless of base style (the pocket fields to a pocket bin, the corral/grid fields to
  a corral or live-grid bin).

Saving uploads a snapshot of the live preview as the card's thumbnail. The page is
deep-linkable: `/bin-profiles/:id` opens straight to that profile's editor.

## REST API

```
GET    /api/bin-profiles                        list every profile
POST   /api/bin-profiles                         create one (name must be unique)
GET    /api/bin-profiles/{id}                    get one
PATCH  /api/bin-profiles/{id}                     update fields (partial)
DELETE /api/bin-profiles/{id}                     delete (and its preview image)
GET    /api/bin-profiles/{id}/preview             download the preview thumbnail
POST   /api/bin-profiles/{id}/preview             upload a preview thumbnail (multipart)
POST   /api/bin-profiles/preview.glb              synthetic-bin GLB preview for live editing
```

`preview.glb` doesn't touch the tool library or require a saved profile at all — it
takes the in-progress editor form state directly and returns a GLB of a synthetic
4×4-gridfinity-unit bin with one ~2×2-unit square pocket centered in it, built by
calling `bin_solid` directly. This is what a future profile editor page renders live
as you adjust fields, before you've saved anything.

## Structural parameters

Beyond the lip/style/magnet-hole fields above, a profile can also override the
dimensional constants that used to be hardcoded in `gridshot/core/gridfinity.py`:
the lip's own profile (height, both chamfers, straight section), pocket wall
thickness, the floor thickness under a pocket, the magnet hole's inset from the
foot's edge, and the corral/live-grid deck's floor, wall, base flare, base
reinforcement thickness, and edge margin. Every one of these defaults to `None`,
meaning "use gridfinity.py's built-in constant" — which is what guarantees the
seeded Pocket/Corral/Live Grid profiles reproduce today's exact geometry,
unedited.

`corral_edge_margin_mm` only affects auto-pack footprint sizing (`_combine_layout`
in `gridshot/server/app.py`), not `bin_solid()`'s geometry directly — editing it in
the profile editor won't visibly change the live 3D preview, only a real combine's
footprint.

Deliberately **not** adjustable, on any profile: the 42mm pitch, 41.5mm bin
footprint, 7mm height unit, and foot/chamfer profile. These are the dimensions
that make a bin physically interoperable with a real Gridfinity baseplate —
changing them per-profile would produce bins that don't actually stack or seat
correctly, so they stay fixed regardless of style.

## Storage

Profiles live as one JSON file per profile under `config/bin-profiles/`, the same
bind-mounted config directory the Tool Library and Bin Library already use, plus an
optional `<id>-preview.png` thumbnail once the UI lands.

Three profiles are seeded automatically the first time `config/bin-profiles/` is
touched: **Pocket**, **Corral**, and **Live Grid**, reproducing today's exact hardcoded
behavior (every structural field left unset, meaning "inherit gridfinity.py's module
constant"). Deleting a seeded profile does not resurrect it on its own — that's what the
CLI's `reseed` command is for.

## CLI

```
gridshot bin-profiles list              # list every profile; * marks a built-in one
gridshot bin-profiles seed              # create any of the 3 built-ins that are missing
gridshot bin-profiles reseed            # reset the 3 built-ins to factory, leave custom profiles alone
gridshot bin-profiles delete <id>       # delete one profile (and its preview image)
```
