/** Anchor-based click selection, shared across the tool library's tile and
 *  list views: a plain click toggles one row and becomes the new anchor; a
 *  shift-click selects every row between the anchor and the clicked row
 *  (inclusive), replacing the current selection with that contiguous range.
 *  A shift-click with no anchor yet (nothing selected) just selects the
 *  clicked row, same as a plain click. */
export function applySelectionClick<T>(
  orderedIds: T[],
  current: ReadonlySet<T>,
  anchor: T | null,
  clickedId: T,
  shiftKey: boolean,
): { selection: Set<T>; anchor: T | null } {
  if (!shiftKey) {
    const next = new Set(current);
    next.has(clickedId) ? next.delete(clickedId) : next.add(clickedId);
    return { selection: next, anchor: clickedId };
  }
  if (anchor === null) {
    return { selection: new Set([clickedId]), anchor: clickedId };
  }
  const anchorIndex = orderedIds.indexOf(anchor);
  const clickedIndex = orderedIds.indexOf(clickedId);
  if (anchorIndex === -1 || clickedIndex === -1) {
    return { selection: new Set([clickedId]), anchor: clickedId };
  }
  const [lo, hi] = anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
  return { selection: new Set(orderedIds.slice(lo, hi + 1)), anchor };
}
