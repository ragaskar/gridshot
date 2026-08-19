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
- **Position** — a slider (and its live mm readout) that slides the hole
  along whichever edge it's on. `0` is that edge's exact midpoint — the
  default placement. Negative values move it toward the edge's low end,
  positive toward its high end (for a tall tool whose hole sits on its
  top/bottom edge, that's left/right, matching how the slider reads). The
  hole always stays snapped exactly onto the tool's real boundary — moving
  it along one axis follows whatever the contour does on the other.

Both settings only apply to this bin — the library entry is unchanged.

## Constraints

Some tool shapes (concave outlines especially) don't have their default
finger hole sitting on one clean bounding-box edge — GridShot falls back to
whichever spot on the boundary is nearest the tool's interior instead. For
those tools, "Switch sides" and "Position" aren't available (there's no
single side to flip or slide along); the inspector says so instead of
showing the controls.

The position slider's range is bounded to roughly half the length of the
edge the hole sits on, sized per tool.
