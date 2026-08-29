import { useCallback, useState } from "react";

/** Fold state for a Section/Subsection. `forceOpen` only ever opens — never
 *  closes — so a selection-driven auto-expand (e.g. Fingerhole opening when
 *  a hole is picked) never fights a fold the user already set by hand, and
 *  deselecting never re-folds something they opened. */
export function useFold(defaultOpen: boolean) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const forceOpen = useCallback(() => setOpen(true), []);
  return { open, toggle, forceOpen };
}
