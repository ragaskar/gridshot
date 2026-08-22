// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  binProfilePreviewUrl,
  combinePreview,
  createBinProfile,
  deleteBinProfile,
  getBinProfile,
  listBinProfiles,
  previewBinProfileGlb,
  updateBinProfile,
  uploadBinProfilePreview,
} from "./api";

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 422, json: async () => body, statusText: "error" } as Response;
}

describe("Bin Profiles API client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listBinProfiles GETs /api/bin-profiles and unwraps .profiles", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ profiles: [{ id: "p1", name: "Pocket" }] }));

    const profiles = await listBinProfiles();

    expect(fetchMock).toHaveBeenCalledWith("/api/bin-profiles");
    expect(profiles).toEqual([{ id: "p1", name: "Pocket" }]);
  });

  it("getBinProfile GETs the single-profile endpoint and throws with the server detail on failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "no such bin profile" }, false));

    await expect(getBinProfile("missing")).rejects.toThrow("no such bin profile");
    expect(fetchMock).toHaveBeenCalledWith("/api/bin-profiles/missing");
  });

  it("createBinProfile POSTs the given fields as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "new", name: "Mine" }));

    await createBinProfile({ name: "Mine", lip: false });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/bin-profiles");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Mine", lip: false });
  });

  it("updateBinProfile PATCHes only the given fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1", name: "Renamed" }));

    await updateBinProfile("p1", { name: "Renamed" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/bin-profiles/p1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "Renamed" });
  });

  it("deleteBinProfile DELETEs the profile", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: true }));

    await deleteBinProfile("p1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/bin-profiles/p1");
    expect(init.method).toBe("DELETE");
  });

  it("uploadBinProfilePreview POSTs a multipart form with a 'photo' field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    await uploadBinProfilePreview("p1", blob);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/bin-profiles/p1/preview");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).has("photo")).toBe(true);
  });

  it("binProfilePreviewUrl builds the plain image URL", () => {
    expect(binProfilePreviewUrl("p1")).toBe("/api/bin-profiles/p1/preview");
  });

  it("previewBinProfileGlb POSTs the live form fields and returns a blob", async () => {
    const blob = new Blob([new Uint8Array([1])]);
    fetchMock.mockResolvedValue({ ok: true, blob: async () => blob } as Response);

    const result = await previewBinProfileGlb({ fill_height_pct: 0, lip_height_mm: 8 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/bin-profiles/preview.glb");
    expect(JSON.parse(init.body)).toEqual({ fill_height_pct: 0, lip_height_mm: 8 });
    expect(result).toBe(blob);
  });

  it("combinePreview maps CombineOptions camelCase fields to the server's snake_case request body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tools: [] }));

    await combinePreview(["tool-a"], {
      lip: false, fillHeightPct: 0, liveGrid: true,
      lipHeightMm: 8.0, toolWallMm: 4.0, magnetHoleInsetFromEdgeMm: 6.0,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/library/combine/preview");
    const body = JSON.parse(init.body);
    expect(body.lip).toBe(false);
    expect(body.fill_height_pct).toBe(0);
    expect(body.live_grid).toBe(true);
    expect(body.lip_height_mm).toBe(8.0);
    expect(body.tool_wall_mm).toBe(4.0);
    expect(body.magnet_hole_inset_from_edge_mm).toBe(6.0);
  });

  it("combinePreview defaults lip to true and fill_height_pct to 100 when options is omitted", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tools: [] }));

    await combinePreview(["tool-a"]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.lip).toBe(true);
    expect(body.fill_height_pct).toBe(100);
    expect(body.live_grid).toBe(false);
    expect(body.lip_height_mm).toBeUndefined();
  });
});
