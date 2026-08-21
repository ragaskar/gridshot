// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBinProfiles } from "./useBinProfiles";

vi.mock("./api", () => ({
  listBinProfiles: vi.fn(),
}));

import { listBinProfiles } from "./api";

describe("useBinProfiles", () => {
  it("fetches the profile list once and returns it", async () => {
    vi.mocked(listBinProfiles).mockResolvedValue([
      { id: "p1", name: "Pocket" } as never,
    ]);

    const { result } = renderHook(() => useBinProfiles());

    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].name).toBe("Pocket");
  });

  it("leaves the list empty if the fetch fails, instead of throwing", async () => {
    vi.mocked(listBinProfiles).mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useBinProfiles());

    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual([]);
  });
});
