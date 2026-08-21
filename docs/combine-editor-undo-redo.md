# Undo/redo in the combine editor

The multi-tool combine editor (Library → *Arrange multi-tool bin*) tracks every
change you make — drags, nudges, rotations, bin-style switches, magnet holes,
custom bin shape, overrides — so a mistake is one keystroke away from being
undone.

## Using it

- **Undo** / **Redo** buttons sit next to the "Arrange multi-tool bin" header.
- **Cmd/Ctrl+Z** undoes; **Cmd/Ctrl+Shift+Z** redoes. Both are ignored while
  typing in a text field, so editing a number field doesn't accidentally
  trigger one.
- Undo history is local to the current editor session — closing and reopening
  the editor (or the whole modal) starts fresh.

## What's tracked

Every tool's position and rotation, the bin style, magnet holes (on/off,
diameter, depth), forced bin size, custom bin shape (on/off and which cells
are removed), and rotation locks. Selection, which tab you're on (Arrange vs.
Preview 3D), and open dialogs are *not* tracked — undo restores content, not
where you're looking.

## Gesture coalescing

A drag, or a rapid burst of nudge/rotate keypresses, undoes in **one step**
rather than one step per pixel or keypress:

- A drag reverts to wherever the tool was before you picked it up, however
  many times the pointer moved in between.
- A burst of nudges (or fine-rotation clicks, or typing a rotation value)
  collapses into one step as long as you keep going within about a second of
  the last one; pausing for a second closes that step, so the next nudge
  starts a new one.

Every other action — switching bin style, toggling a checkbox, committing a
number field, clicking Auto-pack — is its own discrete undo step.

## Position and out-of-bounds tools

Undo restores the editor's live arrangement state directly (the same state
the Arrange 2D view renders from), not the save/export schema. A tool nudged
or dragged outside a locked bin's boundary shows the same overflow warning
after an undo/redo round trip as it does live — there's no "jump" the way
there might be if undo went through the export-time placements schema
instead.
