# Multi-select in the combine editor

The "Arrange multi-tool bin" modal (Library → select ≥2 ready tools → *Arrange multi-tool bin*)
now lets you select more than one tool at once in the **Arrange 2D** view, as a foundation for
bulk edits (align, distribute, and bulk clearance/finger-access/finger-hole controls land in
later updates on top of this).

## Selecting multiple tools

- **Click** a tool (its outline in the 2D view, or its row in the tool list) to select just that
  one, replacing whatever was selected before.
- **Shift-click** a tool to add it to the current selection, or remove it if it's already
  selected.
- **Click empty space** in the 2D view to clear the selection entirely (the
  view is sized generously so there's plenty of empty space to click).
- **Esc** clears the selection from anywhere in the modal — a reminder
  ("Esc to clear") shows next to the tool name / "N tools selected" header
  whenever something is selected. It's ignored while a text field is
  focused, so it won't surprise you mid-edit.

Hovering an unselected tool in the 2D view shades it slightly so it's clear
you can click it.

The Inspector panel on the right shows a single tool's full settings when exactly one is
selected, or a summary list of names when more than one is selected. Controls that only make
sense for one tool at a time (rotation number/slider, the ±15°/±1° buttons, and "Lock rotation")
grey out whenever the selection isn't exactly one tool.

## Dragging and nudging a group

Once more than one tool is selected, dragging any one of them — or nudging with the arrow keys
— moves the **whole selection together**, preserving each tool's position relative to the
others.

Clicking (without Shift) on a tool that's already part of the current multi-selection is
ambiguous until the gesture finishes: if you drag it (the pointer moves), the whole group moves
together, same as any other drag. If you just click it (the pointer comes back up without
moving), the selection narrows down to that one tool instead — a plain click on an
already-selected tool always ends up selecting just that tool once you let go, whether or not a
drag happened in between. Clicking a tool that *isn't* currently selected always replaces the
selection with just that one, immediately.

## Constraints

- Multi-select only applies within one combine-editor session (the 2D arrange view) — it isn't
  persisted anywhere and has no effect on the library.
- Rotation stays a single-tool operation; there's no "rotate the group" control.
