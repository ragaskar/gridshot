import { useCallback, useState } from "react";

function readStored(key: string | undefined, fallback: boolean): boolean {
  if (!key || typeof sessionStorage === "undefined") return fallback;
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function writeStored(key: string | undefined, value: boolean) {
  if (!key) return;
  try {
    sessionStorage.setItem(key, value ? "1" : "0");
  } catch {
    // storage unavailable/full — in-memory state still works
  }
}

/** A boolean React state that (when given a `storageKey`) survives a reload
 *  or reopen within the same browser tab via sessionStorage — sidebar
 *  collapse and section/subsection fold state use this so the layout stays
 *  put across a refresh. With no `storageKey`, this never touches
 *  sessionStorage and behaves exactly like plain `useState`. */
export function usePersistedBoolean(defaultValue: boolean, storageKey?: string) {
  const [value, setValueState] = useState(() => readStored(storageKey, defaultValue));

  const setValue = useCallback((next: boolean) => {
    setValueState((current) => {
      if (current === next) return current;
      writeStored(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const toggle = useCallback(() => {
    setValueState((current) => {
      const next = !current;
      writeStored(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return { value, setValue, toggle };
}
