# Overriding pocket depth in the combine editor

Every tool's pocket depth normally comes from either the library entry's own
`pocket_depth_mm` (a persisted override, if you've set one) or an automatic
estimate from the tool's measured height. The multi-tool combine editor
(Library → *Arrange multi-tool bin*) now lets you override the depth for one
bin, at 0.01mm resolution, without touching the library entry at all — the
same request-scoped mechanism already used for clearance and finger access.

## Per-tool

Select a tool. In the Inspector panel, check **"Override pocket depth"**: the
number field seeds with the tool's current effective depth and commits
immediately (so "Depth source" flips to **override** right away — checking
the box with no further edits is itself a valid, if redundant, override).
Edit the number afterward the same way you'd edit clearance. Unchecking the
box reverts to whatever depth applied before (the library's own override, or
automatic) and clears the override.

Negative or zero depths are rejected, both in the field and on the server.

## Multi-select

With [multiple tools selected](combine-editor-multi-select.md), the checkbox
reflects the group: checked when every selected tool has an active override,
unchecked when none do, and shown as a partial/indeterminate check when it's
a mix of both.

Unlike the single-tool case, **checking the box on a multi-selection does
not commit anything by itself** — there's no single unambiguous value to
apply to a mixed group. Instead:

- Checking it (from "none" or "mixed") opens a number field, seeded with the
  shared depth if every selected tool currently has the same effective
  depth, or left blank ("–") otherwise. Nothing is sent to the server yet.
- Typing a valid depth into that field and clicking away applies it to
  **every** selected tool at once — this is what actually saves the change.
- Clicking the checkbox again before typing anything just discards the
  pending field, with no effect on any tool.
- Unchecking the box (only possible when every selected tool currently has
  an override) immediately clears the override for the whole group — this
  is the other case that saves without a number ever being typed.

In short: for a multi-selection, the only two actions that change anything
are typing a depth in after checking, or unchecking a fully-overridden
selection. Simply toggling the box on and clicking away does nothing.

## Constraints

Like the library-level depth override, there's no upper bound checked
against the tool's own thickness or height — an unreasonably deep override
is accepted and will simply grow the bin's required height.
