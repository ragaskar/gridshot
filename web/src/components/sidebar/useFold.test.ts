// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useFold } from "./useFold";

afterEach(cleanup);

describe("useFold", () => {
  it("starts at the given default and toggles both ways", () => {
    const { result } = renderHook(() => useFold(false));
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it("forceOpen only ever opens, never closes", () => {
    const { result } = renderHook(() => useFold(false));
    act(() => result.current.forceOpen());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle()); // user folds it back manually
    expect(result.current.open).toBe(false);
    act(() => result.current.forceOpen());
    expect(result.current.open).toBe(true);
    act(() => result.current.forceOpen()); // calling again while already open is a no-op
    expect(result.current.open).toBe(true);
  });

  it("forceClose only ever closes, never opens", () => {
    const { result } = renderHook(() => useFold(true));
    act(() => result.current.forceClose());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle()); // user opens it back manually
    expect(result.current.open).toBe(true);
    act(() => result.current.forceClose());
    expect(result.current.open).toBe(false);
    act(() => result.current.forceClose()); // calling again while already closed is a no-op
    expect(result.current.open).toBe(false);
  });

  describe("with no storageKey", () => {
    beforeEach(() => {
      vi.spyOn(Storage.prototype, "getItem");
      vi.spyOn(Storage.prototype, "setItem");
    });

    it("never reads or writes sessionStorage", () => {
      const { result } = renderHook(() => useFold(false));
      act(() => result.current.toggle());
      act(() => result.current.forceOpen());
      act(() => result.current.forceClose());
      expect(sessionStorage.getItem).not.toHaveBeenCalled();
      expect(sessionStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe("with a storageKey", () => {
    const KEY = "gridshot.test.fold.example";

    beforeEach(() => {
      sessionStorage.clear();
    });

    it("persists across remounts and survives a simulated reload", () => {
      const first = renderHook(() => useFold(false, KEY));
      act(() => first.result.current.toggle());
      expect(first.result.current.open).toBe(true);
      first.unmount();

      // A fresh mount (simulating a reload within the same tab) picks up
      // the persisted value instead of the passed default.
      const second = renderHook(() => useFold(false, KEY));
      expect(second.result.current.open).toBe(true);
    });
  });
});
