# Tool library: tile/list view + selection improvements

The Tool Library page has two ways to browse your saved tools, plus faster ways to
select several at once.

## Tile / List toggle

A **Tile / List** control sits above the tool grid.

- **Tile** (the original view) shows every setting per tool — bin style, finger
  access, magnet holes, dimensions, clearance — with the full **02 · Compose drawer**
  sidebar (width/depth/height inputs, layout preview, 3D preview, export) alongside it.
- **List** is a compact table: a checkbox, a small clipped photo, the tool's name,
  its print readiness as plain text (no badge/border), and clone/delete icons — nothing
  else. Hover any icon or the name for what it does.
  - Clicking the **name** reopens that tool as the current tool (same as tile view's
    "Re-open as current").
  - Clicking the **photo** opens the same photo modal as tile view — full image,
    accepted-selection outline, and "Edit physical cutout"/"Correct photo selection"
    buttons.
  - There's no per-row settings panel and no compose sidebar. Instead, **Compose N
    Tools** and **Combine N Tools** buttons sit at the top of the page. Compose opens a
    small prompt for width/depth/overall height, then runs the same composition as tile
    view; the resulting layout/3D preview/export panel appears below the list.

## Selection

Both views share the same selection model:

- **Select all** — a checkbox above the tool grid/list selects every tool that isn't
  print-blocked (indeterminate when some, but not all, are selected). Clicking it again
  clears the selection.
- **Shift-click** — shift-clicking a tool's checkbox (list view) or its select button
  (tile view) selects every tool between the last tool you clicked (plain, non-shift)
  and the one you just shift-clicked, inclusive. Shift-clicking with nothing selected
  yet just selects that one tool. Repeated shift-clicks resize the range from the same
  starting point, the same way Explorer/Finder-style multi-select works elsewhere.

Print-blocked tools can't be selected by any of these — plain click, shift-click, or
select-all all skip them.
