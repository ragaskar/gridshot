# Bin Library

The multi-tool combine editor (Library → *Arrange multi-tool bin*) lets you arrange several
tools into one bin. **Bin Library** (its own page in the top nav) is where that arrangement
lives as a named entry you can come back to later, independent of the Tool Library.

## Saving

A combine session always has its own Bin Library entry, from the moment it opens — a fresh
session (not reopened from the Bin Library) mints one immediately, named
`"Combined Bin YYYY-MM-DD"` (today's date, in your browser's local time), with no dialog and
nothing to click. From then on, every change **autosaves** to it automatically a moment after
you stop editing — there's no explicit "Save" button.

The one manual action that remains is **Save As…**: opens a dialog pre-filled with the current
name, and always creates a **separate, new** entry (its own name, its own forked copies of every
tool) rather than touching the one you started from. Use it to branch a variation off without
disturbing the original.

If the initial mint fails (a network hiccup, or a validation error the server rejects the
arrangement for), the editor shows the error in place of the Save controls with a **⟳ Retry**
button — nothing autosaves until it succeeds.

## What gets saved

A saved bin stores its **recipe**, not a frozen 3D snapshot: each tool's actual placed
position/rotation, every per-tool override (clearance, finger access, side/position,
pocket-depth), the bin-wide settings (style, overall height, lip, magnet holes, forced size),
and which [Bin Profile](bin-profiles.md) (if any) the editor had applied when it was saved —
purely so reopening shows the same picker selection, not a live link back to that profile.

**Each tool itself is frozen the moment a fresh session mints its bin.** That mint forks every
selected tool into a private copy (a "bin tool" — see [Duplicating a tool](#duplicating-a-tool)
below) that lives independently of the Tool Library from that moment on. So editing a tool's
outline or clearance in the Tool Library, or deleting it entirely, has **no effect** on any bin
already using it — the bin keeps exporting and reopening exactly as it looked when it was
forked. (Bins saved before this existed still reference the live library tool the old way,
including the "(deleted tool)" label if it's since been removed — this only applies going
forward.)

## Duplicating a tool

Inside the combine editor, select a single tool and click **"⧉ Duplicate"** to get a second,
independently-editable copy of it in the same bin (its own rotation, its own finger-hole/
clearance overrides) — for using one tool's shape twice without adding a second entry to the
Tool Library. This replaces the old workflow of cloning a whole Tool Library entry (photo,
calibration, provenance, and all) just to select it twice.

The copy is a **bin tool** — the same private, per-bin mechanism the mount-time mint above uses,
forked immediately so it previews and undoes like any other tool. Undo removes it from the bin
again, same as any other change.

Since every session mints its own bin right away, a duplicate normally ends up referenced by a
saved bin within moments (the next autosave). The one remaining way to orphan a bin tool is if
that initial mint itself fails and stays failed for the rest of the session — deleting a saved
bin already cleans up its own, but nothing else catches this case automatically. Run
`gridshot bin-tools gc` to delete every bin tool no saved bin references any more.

## Preview thumbnail

Each card shows a small static "snap" of the multi-tool combine editor's 2D arrange view — the
bin's footprint, its grid lines, and each tool's placed outline in the same per-tool colors the
editor uses, no interactivity. It renders lazily once the Bin Library page opens (one request per
bin, not a bulk endpoint) and is cached in the browser against a hash of everything about the bin
that affects its geometry — every placement, override, and bin-wide structural/style field, but
not cosmetic ones like its name. Reopening the Bin Library with nothing changed reuses the cached
thumbnail with no network round-trip; a re-arrange, a resize, or any other geometry-affecting edit
changes the hash and the next open re-renders it. If the preview request itself fails — in
practice, only a legacy bin from before bin tools existed (see [What gets
saved](#what-gets-saved) above), still pointing at a since-deleted Tool Library entry, since a
bin tool's own fork can't be deleted out from under a bin that references it — the card shows a
"no preview" placeholder instead of a broken image.

A custom-shape bin (gridfinity units cut out of a forced footprint) renders its full bounding
rectangle here — the notch isn't drawn, since the preview only knows the bin's outer size, not
its shape. Reopen for the actual outline.

## The Bin Library page

Each saved bin is a card: its preview thumbnail, its name (editable in place, same as the Tool
Library), the save date, bin style, and the tools it contains. Four actions:

- **↻ Reopen** — opens the combine editor seeded with this bin's exact saved arrangement (not a
  fresh auto-pack) so you can keep arranging it. Every change autosaves back to this same entry;
  **Save As…** creates a separate new one instead.
- **↓ Export bin** / **↓ Export slice** — regenerate and download the 3MF directly from the list,
  without opening the editor.
- **× Delete** — removes the saved bin (asks for confirmation first). Also deletes any bin tool
  it referenced that no *other* remaining saved bin still uses (two bins can share one via
  reopen-then-Save-As); never touches an actual Tool Library entry.

## Export filenames

Exported files (from either the combine editor or the Bin Library list) are named after
the bin's own name (the one auto-generated at mint, or edited afterward via **Save As…**), not
a generic `multitool-bin.3mf` — since every session has a bin from the start, this is the name
used from the very first export onward, not just once you've explicitly saved.

Slice exports get a `-slice` suffix on the same base name.

## Constraints

- This pass only covers *combined* bins (arrangements from the multi-tool combine editor) — not
  single-tool bins or drawer compositions.
