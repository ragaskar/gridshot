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

This is landing in phases; this doc grows with each one. **Currently shipped: the
storage layer and CLI only** — there's no UI or REST API yet, so nothing changes for
existing bins or the combine editor until those later phases land.

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
