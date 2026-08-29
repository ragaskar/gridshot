// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePersistedBoolean } from "./usePersistedBoolean";

afterEach(cleanup);

describe("usePersistedBoolean", () => {
  it("starts at the given default and toggles both ways", () => {
    const { result } = renderHook(() => usePersistedBoolean(false));
    expect(result.current.value).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.value).toBe(true);
    act(() => result.current.setValue(false));
    expect(result.current.value).toBe(false);
  });

  describe("with a storageKey", () => {
    const KEY = "gridshot.test.persisted.example";

    beforeEach(() => {
      sessionStorage.clear();
    });

    it("persists a toggle across a fresh mount", () => {
      const first = renderHook(() => usePersistedBoolean(false, KEY));
      act(() => first.result.current.toggle());
      first.unmount();

      const second = renderHook(() => usePersistedBoolean(false, KEY));
      expect(second.result.current.value).toBe(true);
    });

    it("falls back to the default when nothing is stored yet", () => {
      const { result } = renderHook(() => usePersistedBoolean(true, KEY));
      expect(result.current.value).toBe(true);
    });
  });
});
