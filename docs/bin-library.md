# Bin Library

The multi-tool combine editor (Library → *Arrange multi-tool bin*) lets you arrange several
tools into one bin, but until now the arrangement only existed for that session. **Bin Library**
(its own page in the top nav) saves a finished arrangement as a named entry you can come back to
later, independent of the Tool Library.

## Saving

A fresh combine (not reopened from the Bin Library) shows one button, **"💾 Save to Bin
Library"** (near the export buttons). It opens a small dialog with a name field, pre-filled
with `"Combined Bin YYYY-MM-DD"` (today's date, in your browser's local time) — edit it to
whatever you like, or leave it as-is. Naming works like tool-library entries: fully editable
afterward, no uniqueness requirement.

Once a bin has been saved this session (or the editor was reopened from an existing one), that
single button becomes two:

- **💾 Save** — overwrites that same Bin Library entry in place (same id, same name unless you
  rename it elsewhere), no dialog.
- **Save As…** — the original dialog, pre-filled with the current name; always creates a
  **separate, new** entry rather than touching the one you started from.

## What gets saved

A saved bin stores its **recipe**, not a frozen 3D snapshot: which tools, each tool's actual
placed position/rotation, every per-tool override (clearance, finger access, side/position,
pocket-depth), the bin-wide settings (style, overall height, lip, magnet holes, forced size),
and which [Bin Profile](bin-profiles.md) (if any) the editor had applied when it was saved —
purely so reopening shows the same picker selection, not a live link back to that profile.
Exporting or reopening a saved bin always regenerates geometry from the tools' *current* library
state — so if you edit a tool's outline or clearance later, a saved bin using that tool reflects
the change next time you export or reopen it. If a tool is deleted entirely, the bin still lists
(showing "(deleted tool)" in its place) and exports with whatever tools remain, degrading exactly
the way the live combine editor already does when a tool disappears mid-session.

## The Bin Library page

Each saved bin is a card: its name (editable in place, same as the Tool Library), the save date,
bin style, and the tools it contains. Four actions:

- **↻ Reopen** — opens the combine editor seeded with this bin's exact saved arrangement (not a
  fresh auto-pack) so you can keep arranging it. **💾 Save** from there overwrites this same
  entry; **Save As…** creates a separate new one instead.
- **↓ Export bin** / **↓ Export slice** — regenerate and download the 3MF directly from the list,
  without opening the editor.
- **× Delete** — removes the saved bin (asks for confirmation first). This never touches the
  tools it references, only the saved arrangement itself.

## Export filenames

Exported files (from either the combine editor or the Bin Library list) are named after
the bin, not a generic `multitool-bin.3mf`:

- **Saved** — the bin's own name (the one you gave it, or edited afterward). Reopening a
  saved bin and exporting from *inside* the editor uses this too, even before saving again
  in that session — and if you save it under a new name mid-session, exports made after
  that use the new name.
- **Not saved** — the selected tools' names, joined (e.g. `Wrench, Pliers`), capped at 3
  names plus a count (`Wrench, Pliers, Hammer +2 more`) for a large selection.

Slice exports get a `-slice` suffix on the same base name either way.

## Constraints

- This pass only covers *combined* bins (arrangements from the multi-tool combine editor) — not
  single-tool bins or drawer compositions.
- No thumbnail image (a combined bin doesn't have one obvious shape to render, unlike a single
  tool); the tool list stands in for it.
