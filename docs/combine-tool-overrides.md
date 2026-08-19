# Per-tool overrides in the multi-tool combine editor

Each tool in a multi-tool bin (Library → *Arrange multi-tool bin*) has a
handful of settings that normally come from its library entry — finger
access, clearance — but sometimes one bin needs a different value for one
tool without changing that tool's saved default. The combine editor lets you
override these per-bin, per-tool, the same way you can already nudge a
tool's rotation without changing anything about the tool itself.

## Enabling it

Select a tool in the arrange view, then in the inspector panel on the right:

- **Finger access** — an On/Off toggle. Shows "Inherited from library" when
  untouched, "Override for this bin" once you've flipped it away from the
  library default; a "↩ Use library setting" link reverts it.
- **Clearance** — a millimetre field, pre-filled with the tool's effective
  clearance. Same inherited/override language and revert link as finger
  access. Changing it re-solves the pocket at the new clearance immediately.

Both overrides only apply to this bin's export/preview — the library entry
itself is never modified.

## Constraints

Clearance overrides must be `>= 0`, same as the library-level setting.
Growing a tool's clearance grows its pocket, which can grow the bin's
auto-computed footprint (see the tool list's live "Clearance" readout, and
re-run Auto-pack if you want the arrangement to react to the new size).
