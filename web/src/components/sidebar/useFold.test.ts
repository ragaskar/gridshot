// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
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
});
