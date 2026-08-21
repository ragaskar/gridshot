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

This is landing in phases; this doc grows with each one. **Currently shipped: storage,
CLI, geometry, the REST API, and the Bin Profiles page itself** — the four places you
currently pick a bin style (the combine editor, single-tool capture, the result page's
regenerate flow, and a tool's per-tool default) haven't been converted to use profiles
yet, so nothing changes there until that lands.

## The Bin Profiles page

A new **Bin Profiles** entry in the top nav lists every profile as a card (thumbnail,
name, base style, lip on/off), plus a **"+ New bin profile"** tile. Three are seeded for
you — Pocket, Corral, Live Grid — reproducing today's hardcoded styles exactly.

Clicking a card (or "+ New") opens its editor: a live 3D preview of the synthetic
4×4-unit/2×2-pocket bin next to every field — name, base style, stacking lip, magnet-hole
defaults, and "Allow custom grid shape" (an independent checkbox, not derived from base
style — checking it for Corral/Live Grid shows a note that cell removal isn't supported
there yet, since the underlying geometry can't do it regardless of the checkbox). An
"Advanced (structural)" section holds the 12 dimensional overrides described below, each
starting blank (inheriting gridfinity.py's constant) with its default shown as a
placeholder.

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

## Structural parameters (advanced)

Beyond the lip/style/magnet-hole fields above, a profile can also override the
dimensional constants that used to be hardcoded in `gridshot/core/gridfinity.py`:
the lip's own profile (height, both chamfers), pocket wall thickness, the
floor thickness under a pocket, and the corral/live-grid deck's floor, wall,
base flare, and base reinforcement thickness. Every one of these defaults to
`None`, meaning "use gridfinity.py's built-in constant" — which is what
guarantees the seeded Pocket/Corral/Live Grid profiles reproduce today's exact
geometry, unedited.

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
