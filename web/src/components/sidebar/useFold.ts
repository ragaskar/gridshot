import { useCallback } from "react";
import { usePersistedBoolean } from "./usePersistedBoolean";

/** Fold state for a Section/Subsection. `forceOpen`/`forceClose` are no-ops
 *  when already in that state, so a selection-driven auto-expand/collapse
 *  never fights a fold the user already set by hand for no reason, and
 *  never writes to storage (or re-renders) needlessly. Pass `storageKey` to
 *  persist across a reload/reopen within the same tab (sessionStorage); omit
 *  it for fold state that shouldn't survive a reload. */
export function useFold(defaultOpen: boolean, storageKey?: string) {
  const { value: open, setValue: setOpen, toggle } = usePersistedBoolean(defaultOpen, storageKey);
  const forceOpen = useCallback(() => setOpen(true), [setOpen]);
  const forceClose = useCallback(() => setOpen(false), [setOpen]);
  return { open, toggle, forceOpen, forceClose };
}
