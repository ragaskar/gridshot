# No minimum tool count, and a blank "New bin" starting point

A combine-editor bin no longer needs any tools in it. Three related changes:

## No tool-count floor

Previously `_combine_layout` rejected any combine request with fewer than 2
tools (`select at least 2 tools with outlines`), and the combine editor's own
"🗑 Remove" button mirrored that floor client-side. Both are gone — a bin can
be combined, saved, exported, and reopened with 1 tool, or with 0.

A tool-less bin is a plain shell: the outer walls, base, feet, and lip (if
on), with nothing cut into it — the same construction `bin_solid` already
used for the general (deck+wall+fill) path at `fill_height_pct < 100`, now
also reachable with an empty `pockets`/`cuts` list on every path, not just
the fast one.

## + New bin

The Bin Library page has a **"+ New bin"** button (top-right of the header)
that opens the combine editor on a brand-new, blank session — no tool
selection required first. It routes to `/combine/new`
(`pathForNewBin`/`decodeUrlState` in `urlState.ts`), which `CombineBin.tsx`
tells apart from "no combine route matched" (`combineIds: null`) by encoding
a fresh session as `combineIds: []` — an empty array is a valid, addressable
session, `null` isn't.

A tool-less auto-pack has nothing of its own to size a bin against, so a
fresh "New bin" session seeds a default forced footprint of **1×5** grid
units (`CombineEditor`'s `defaultForceSize` prop, consulted only when there's
no `initial` — i.e. not on a reopened bin, which already has its own
force_gx/gy or none at all). The user can turn "Force bin size" off or change
it immediately once in the editor, same as any other bin.

Like any other fresh combine session, opening one auto-mints a Bin Library
entry right away (`mintInitialSave`) and autosaves from then on — so clicking
"+ New bin" does leave a persisted (if you never touch it again, empty)
entry behind, the same tradeoff every other fresh combine session already
makes.

## Removing every tool

The combine editor's "🗑 Remove" button (see
[combine-editor-add-remove-tools.md](combine-editor-add-remove-tools.md))
now stays enabled all the way down to zero selected tools remaining —
removing everything leaves the same plain shell "+ New bin" starts with,
rather than refusing the action.
