# Save Slice: splitting one big layout into printable bins

**Save Slice is unrelated to "Export slice (3MF)"**, the trace-tolerance
coupon feature described in
[trace-tolerance-slice.md](trace-tolerance-slice.md) — that one exports a
thin cross-section through every tool's cutout to test-fit before printing
the full bin. This feature spins off a whole new *bin*.

## Why

The combine editor's grid can be laid out all at once — one big forced-size
arrangement, so alignment between neighbouring tools is handled by hand once,
in one place. But a single huge bin is a long print, and a bad idea if
anything in the layout might get rearranged later. Save Slice lets you carve
a sub-region of that big grid off into its own, independently-printable bin,
without disturbing anything about the tools' actual placement.

## Using it

**"Save Slice…"** sits in the combine editor's toolbar, next to "Save As…".
It's only available once this bin has a locked, forced-size grid (100% fill
height, live grid off, and nothing currently crossing the locked edge) — the
same "Force size" setup **Edit Grid** requires (see
[combine-editor-add-remove-tools.md](combine-editor-add-remove-tools.md) for
Force size itself).

Clicking it opens a small panel — a **Name** field (defaulting to
`"<bin name> Slice"`) and **Cancel**/**Save As** buttons — and switches the
Arrange 2D view into a grid-cell picker, reusing the same click-a-cell
gesture Edit Grid uses. Click cells to build up the sub-region you want to
carve off:

- Every tool colours itself by how it relates to the current selection:
  its normal colour if it's **entirely inside** the selected cells (it'll be
  included in the new bin), dimmed grey if it's **entirely outside** (left
  behind, untouched), or the same warning orange the locked-bin-overflow
  check uses if it **straddles** the boundary. A straddling tool blocks
  **Save As** until the selection grows or shrinks to put it cleanly on one
  side — a tool is never split between the two bins.
- The selection doesn't have to be a filled rectangle: any bounding-box cell
  you leave unselected becomes a hole in the new bin, the same "custom bin
  shape" holes Edit Grid can carve — see
  [combine-editor-multi-select.md](combine-editor-multi-select.md) and
  the Edit Grid section of
  [combine-editor-add-remove-tools.md](combine-editor-add-remove-tools.md).
  A selection with holes only works when the active bin profile allows a
  custom shape (`allowCustomShape`); a hole otherwise blocks Save As with an
  explanation. A cell already cut out of the *source* bin can't be selected
  either — there's no material there to include.
- **Esc**, or the **Cancel** button, drops the selection and returns to
  normal 2D arrange mode. Nothing about the source bin is ever changed by
  selecting, cancelling, or saving a slice — unlike Edit Grid, this never
  touches `removed_cells` on the bin you're slicing *from*.

**Save As** (disabled until at least one cell is selected, nothing
straddles, and any hole is allowed) creates a **brand-new** Bin Library
entry: a locked bin sized to exactly the selected cells' bounding box, with
the included tools' placements translated so the slice's own footprint lands
verbatim on the new bin's origin — no re-auto-fit, no repacking. A tool that
was flush against another in the big layout is still flush against it in the
slice.

Everything else about the new bin — fill height, magnets, bevels, lip,
structural overrides, the applied bin profile — is copied straight from the
bin you sliced from. Anything computed from the bin's own footprint (most
notably magnet corner positions with "corners only" on) recomputes against
the *slice's* corners automatically, since that's derived from the bin's
own geometry at generation time, never cached per-tool.

Saving leaves you exactly where you were, still editing the source bin — the
whole point is being able to slice the same big layout more than once. The
panel shows a confirmation with a link to open the new bin in a new tab.

## Implementation notes

- Selection state (`saveSliceCells`, a `Set<CellKey>` of *included* cells) is
  purely local UI state — it never touches `removedCells`, `tools`, or any
  other committed bin state, so there's no undo/redo interaction and no
  baseline-snapshot dance the way Edit Grid needs.
- A toggle is rejected outright (not applied, then rejected) if it would
  leave a disconnected or diagonally-pinched shape — see
  `saveSliceToggleCandidate` in `CombineEditor.tsx` and `hasDiagonalPinch` in
  `geometry/binOutline.ts`. Unlike Edit Grid's `canRemoveCell` (which only
  ever needs to check the single newly-removed cell against an
  already-valid fixed-size grid), this selection's own bounding box can grow
  or shrink with every click, so legality is re-checked against the whole
  candidate shape each time.
- Tool containment ("in"/"out"/"straddle") is a bounding-box overlap test
  against every cell in the source grid — the same approximation the
  locked-bin overflow and removed-cell checks already make — with a small
  epsilon so a tool placed flush against a grid line reads as cleanly on one
  side rather than straddling it by a floating-point hair.
- Saving calls the ordinary `saveBin` API directly with a translated
  placement list and a forced `force_gx`/`force_gy`/`removed_cells` — no new
  backend endpoint. The server already honours placements verbatim (no
  re-centring) whenever `force_gx`/`force_gy` accompany them, which is
  exactly what makes the "don't let auto-fit move anything" guarantee hold.
