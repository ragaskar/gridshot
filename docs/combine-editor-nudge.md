# Keyboard nudge in the combine editor

Dragging a tool with the mouse in the multi-tool combine editor (Library →
*Arrange multi-tool bin*) is fine for rough placement, but fiddly for
precise fits. Once a tool is selected, the arrow keys nudge it by a small,
configurable distance instead.

## Enabling it

Select a tool (click it in the arrange view or its row in the tool list),
then use the arrow keys:

- **Arrow key** — moves the tool by the "Nudge step (mm)" field's value
  (default **0.1mm**).
- **Shift + arrow key** — moves it by 10× that amount (default: **1mm**).

Left/right/up/down match the arrangement view's own axes. Changing the
nudge-step field changes both the plain and Shift-modified distance — e.g.
setting it to 1mm makes a plain arrow press move 1mm and Shift+arrow move
10mm.

Arrow keys only nudge when a tool is selected and focus isn't inside a text
field (so editing the rotation, clearance, or nudge-step fields themselves
works normally).

## Constraints

Nudging is a client-side move, exactly like dragging — the exact 3D preview
and export both re-solve from the new position a moment after you stop
nudging.

## Distance-to-next-tool annotation

While exactly one tool is selected and you're actively nudging it, a thin
line and label appear in the arrange view **in both the nudge direction and
its opposite**: from that tool's own outline to wherever it first meets
another tool's outline — labeled with the gap at 0.01mm resolution, so you
can read off how close you're getting as you nudge, on both sides at once.

- Only shows for a **single** selected tool — nudging a multi-tool selection
  together never shows it (there's no one "this tool's own center" to
  measure from).
- If no other tool lies along the nudged axis in a given direction, the
  bin's own grid edge stands in for it instead — nudging up with nothing
  above shows the line all the way to the top of the bin. If neither
  direction has a real tool, both lines land on grid edges.
- If the two distances come out exactly equal (rounded to 0.01mm) — the
  tool is exactly centered between whatever bounds it on each side — both
  lines are drawn bold.
- Clears as soon as you deselect, select something else, or do anything
  other than nudge (rotate, drag, etc.) — it only tracks the *current*
  nudging streak.
