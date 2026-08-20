# Finger-hole side and position

By default, GridShot picks a finger-access scallop for each tool
automatically — a spot on the pocket's boundary that lets you lift the tool
out without growing the bin's footprint. The multi-tool combine editor
(Library → *Arrange multi-tool bin*) lets you fine-tune that placement per
tool, per bin, without touching the tool's library settings.

## Enabling it

Select a tool with finger access on. Below the Finger access toggle:

- **Switch sides** — mirrors the hole to the opposite edge of the pocket
  (bottom ↔ top, left ↔ right).
- **Position** — a number field and a slider, kept in sync, that slide the
  hole along whichever edge it's on. `0` is that edge's exact midpoint — the
  default placement. Negative values move it toward the edge's low end,
  positive toward its high end (for a tall tool whose hole sits on its
  top/bottom edge, that's left/right, matching how the slider reads). The
  hole always stays snapped exactly onto the tool's real boundary — moving
  it along one axis follows whatever the contour does on the other.
  The number field's arrow-key/spinner step is 1mm, but you can type any
  value down to 0.01mm for finer placement than the slider or stepper alone
  can reach.

Both settings only apply to this bin — the library entry is unchanged.

## Multi-select

With [multiple tools selected](combine-editor-multi-select.md), "Switch
sides" appears only if **every** selected tool has finger access on and a
flippable side (none of them fall back to the no-single-side case) — one
ineligible tool hides the control for the whole group. When it's shown and
the selection's flip state is mixed, the button reads "–"; clicking it
flips every selected tool to the same side first, then alternates on
subsequent clicks, the same tri-state pattern as bulk finger access.

Position uses the same eligibility rule. When every selected tool's offset
agrees, the number field and slider both show that shared value; when
mixed, the number field shows a "–" placeholder and the slider's thumb sits
at its center (0) until you move it. Editing either one (typing a value and
clicking away, or dragging the slider) sets every selected tool's offset to
the same millimetre value. Both controls' range is bounded to the
*smallest* of the selected tools' individual position limits, so every tool
in the group stays within its own valid range.

## Constraints

Some tool shapes (concave outlines especially) don't have their default
finger hole sitting on one clean bounding-box edge — GridShot falls back to
whichever spot on the boundary is nearest the tool's interior instead. For
those tools, "Switch sides" and "Position" aren't available (there's no
single side to flip or slide along); the inspector says so instead of
showing the controls.

The position slider's range is bounded to roughly half the length of the
edge the hole sits on, sized per tool.
