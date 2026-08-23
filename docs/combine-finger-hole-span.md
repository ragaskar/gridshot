# Finger-hole span

By default a finger hole is a single circular scallop. **Span** turns it into
a two-lobe stadium/pill straddling the tool instead — two circles, one on
each side, connected by a channel as wide as the hole's own
[diameter](combine-finger-hole-position.md#size). It's useful for a tool wide
enough that you want to pinch it from both sides at once, rather than hooking
a finger in from one edge.

Span is per tool, per bin — the same bin-time-only override model as
[position](combine-finger-hole-position.md) and size, set in the multi-tool
combine editor's Inspector once a hole is selected.

## Turning span on and off

With a hole selected, click **Span both sides** in the Inspector.

- **Turning it on** adds a second focal point directly opposite the first —
  the exact point Up/Down would have jumped to (see
  [position](combine-finger-hole-position.md)). The first point doesn't move.
- **Turning it off** removes that second point again and leaves the first
  exactly where it was — clicking the toggle twice is a no-op round-trip.
- Once span is on, **Up/Down no longer does anything** — there's no single
  "opposite side" once both sides are already occupied.

## Moving each point

Only one of the two focal points moves at a time — whichever one is
"active." The active point behaves exactly like a single-point hole: it's
locked to the outline, drags with the mouse, and nudges with Left/Right (same
[nudge step](combine-editor-nudge.md) and Shift for 10×). The Inspector shows
which point is active (P1 or P2) next to the hole's name.

**Switch the active point** by clicking near the other lobe — you don't have
to click exactly on its outline; clicking anywhere within a small radius
around it selects it. Hovering in that radius (without clicking) shows a
dashed "select hint" ring around the lobe, so you can see where clicking will
land before you commit.

## Interaction with align

[Align finger holes](combine-editor-align-finger-holes.md) understands span
holes — see that doc for the exact rules when a selection mixes single-point
and span holes.
