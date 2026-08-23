# Mirror a tool's outline

The multi-tool combine editor (Library → *Arrange multi-tool bin*) lets
you rotate a tool freely, but a rotation can never turn a left-handed
version of a shape into a right-handed one (or back) — mirroring is a
genuinely different transform. **Mirror horizontal**/**Mirror vertical**
give you that second transform, independent of rotation.

## Using it

Select exactly one tool. Two toggle buttons appear in the Inspector, next
to the rotation controls:

- **↔ Mirror horizontal** — flips the tool's outline across its own local
  vertical axis (left ↔ right).
- **↕ Mirror vertical** — flips it across its own local horizontal axis
  (top ↔ bottom).

Both are independent booleans — either, both, or neither can be on for a
tool at once. The pocket cut, the finger-access hole, and the rendered
outline all flip together, so the exported bin always matches what Arrange
2D shows.

Mirroring is only shown for a single selected tool — it's hidden during a
multi-tool selection, the same as the rotation field.

## Interaction with other controls

Mirror composes with rotation: the outline is mirrored in the tool's own
local frame first, then rotated into place — the same order regardless of
which you set first, so toggling mirror doesn't change the tool's current
rotation angle.

Duplicating a tool starts the copy unmirrored, the same as it starts
unrotated — a duplicate re-packs into the bin fresh rather than carrying
its source's placement forward.

Undo/redo covers mirror toggles the same as every other placement change.
