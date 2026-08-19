# Rotation lock for auto-pack

Auto-pack in the multi-tool combine editor (Library → *Arrange multi-tool
bin*) tries every tool at 0°/90°/180°/270° to find the tightest overall
footprint. Sometimes you want one tool to stay at a specific angle — because
it needs to face a particular way, or you've already hand-rotated it to
interlock with a neighbor — while the rest of the bin still re-packs freely
around it.

## Enabling it

Select a tool, check **"Lock rotation (auto-pack)"** next to the rotation
field. The next time you click **"↻ Auto-pack"**, that tool keeps whatever
rotation it currently has — auto-pack only searches for the best position at
that one angle, not a fresh rotation. Every other, unlocked tool still tries
the full rotation set as usual. Locked tools show a 🔒 in the tool list.

Rotation lock only affects auto-pack. Dragging or using the rotation
field/slider on a locked tool still rotates it freely — locking just stops
*auto-pack* from picking a different angle for it later.

## Constraints

The locked angle is whatever the tool's rotation is at the moment you click
Auto-pack — checking the box doesn't snap it to anything. If you want a
specific angle locked, set the rotation first, then check the box.
