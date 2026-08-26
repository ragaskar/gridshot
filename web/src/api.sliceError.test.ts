// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { combineLibrarySlice, exportSavedBinSlice } from "./api";

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 422, json: async () => body, statusText: "error" } as Response;
}

describe("slice-export error formatting", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("combineLibrarySlice surfaces a readable message from a Pydantic validation-error array, not [object Object]", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      detail: [
        {
          type: "less_than_equal", loc: ["body", "slice_thickness_mm"],
          msg: "Input should be less than or equal to 5", input: 6,
        },
      ],
    }, false));

    await expect(combineLibrarySlice(["tool-a"], {})).rejects.toThrow(
      "Input should be less than or equal to 5",
    );
  });

  it("combineLibrarySlice still surfaces a plain string detail unchanged", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "shallowest recess too thin" }, false));

    await expect(combineLibrarySlice(["tool-a"], {})).rejects.toThrow("shallowest recess too thin");
  });

  it("exportSavedBinSlice also formats a validation-error array readably", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      detail: [{ type: "greater_than_equal", loc: ["body", "slice_thickness_mm"], msg: "Input should be greater than or equal to 0.5", input: 0.1 }],
    }, false));

    await expect(exportSavedBinSlice("bin-1")).rejects.toThrow(
      "Input should be greater than or equal to 0.5",
    );
  });
});
