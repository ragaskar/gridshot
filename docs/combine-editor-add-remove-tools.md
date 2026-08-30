# Adding and removing tools in the combine editor

The multi-tool combine editor's Arrange 2D view can add tools to a bin, or
remove them, without leaving the page.

## Adding a tool

Next to **"▢ Rounded Rectangle"** under Toolshapes sits an **"ADD
TOOL"** button. Clicking it opens a picker modal listing every tool in the
Tool Library, each shown with its thumbnail and label. A tool whose
readiness check is blocking (`readiness.status === "block"`) appears
greyed out and can't be picked — same rule the Tool Library itself
enforces elsewhere.

Picking a tool closes the picker and arms placement mode, mirroring
toolshape placement exactly: a status line reads `Click the grid to place
"<label>" · Esc to cancel`, a ghost preview (an approximation of the
tool's footprint, from its `grid_x`/`grid_y` cell size — not its real
outline, which the library listing doesn't carry) follows the pointer, and
clicking anywhere on the grid places it at that point. Placing forks a
fresh private `bintool-*` copy into this bin via the same "⧉ Duplicate"
mechanism used elsewhere (see
[library-clone-tool.md](library-clone-tool.md)) — the Tool Library entry
itself is untouched, so the same tool can be added more than once. The
newly placed copy is auto-selected afterward, same as a freshly placed
toolshape.

Starting a toolshape placement while a tool placement is armed (or vice
versa) cancels the other one first — only one placement mode is ever
active at a time. **Esc** cancels whichever placement mode is active
(toolshape or tool) without creating anything; this is also what Esc now
does for toolshape placement, which previously had no cancel key.

The Tool Library listing only shows library entries, not other bin-tools
already in this bin — there's no way to pick something you just removed
back out of the bin itself; re-add it from the library instead.

## Removing a tool

Selecting one or more tools shows a **"🗑 Remove"** button in the
inspector, alongside "⧉ Duplicate". Removing drops the selected tool(s)
from the bin's arrangement (client-side only — the server has no
per-bin membership to update) and reloads the layout.

There's no minimum tool count — Remove stays enabled all the way down to
zero, leaving a plain, pocketless bin shell (the same starting point
"+ New bin" produces; see [combine-new-bin.md](combine-new-bin.md)).
