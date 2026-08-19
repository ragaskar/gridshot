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
