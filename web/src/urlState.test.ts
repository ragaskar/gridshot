import { describe, expect, it } from "vitest";
import { decodeUrlState, pathForBinReopen, pathForCombine, pathForView } from "./urlState";

describe("decodeUrlState", () => {
  it("reads a plain view path", () => {
    expect(decodeUrlState("/library")).toEqual({
      view: "library", session: null, project: null, combineIds: null, reopenBinId: null,
    });
  });

  it("rejects an unknown or unlinkable head segment (including tracing)", () => {
    expect(decodeUrlState("/tracing").view).toBeNull();
    expect(decodeUrlState("/bogus").view).toBeNull();
  });

  it("treats the bare root as nothing decoded, leaving the default view to the caller", () => {
    expect(decodeUrlState("/")).toEqual({
      view: null, session: null, project: null, combineIds: null, reopenBinId: null,
    });
  });

  it("reads editor and result ids from their own path segment", () => {
    expect(decodeUrlState("/editor/abc")).toEqual({
      view: null, session: "abc", project: null, combineIds: null, reopenBinId: null,
    });
    expect(decodeUrlState("/result/xyz")).toEqual({
      view: null, session: null, project: "xyz", combineIds: null, reopenBinId: null,
    });
  });

  it("decodes URI-escaped ids", () => {
    expect(decodeUrlState("/editor/a%20b").session).toBe("a b");
  });

  it("reads a fresh combine selection nested under /library", () => {
    expect(decodeUrlState("/library/combine/id1,id2,id3")).toEqual({
      view: "library", session: null, project: null, combineIds: ["id1", "id2", "id3"], reopenBinId: null,
    });
  });

  it("reads a saved-bin reopen nested under /bins", () => {
    expect(decodeUrlState("/bins/bin1/combine")).toEqual({
      view: "bins", session: null, project: null, combineIds: null, reopenBinId: "bin1",
    });
  });

  it("returns nothing decoded on an empty string", () => {
    expect(decodeUrlState("")).toEqual({
      view: null, session: null, project: null, combineIds: null, reopenBinId: null,
    });
  });
});

describe("pathForView", () => {
  it("maps upload to the root path", () => {
    expect(pathForView("upload")).toBe("/");
  });

  it("maps a plain view to /view", () => {
    expect(pathForView("bins")).toBe("/bins");
  });

  it("encodes editor as /editor/:session when a session id is given", () => {
    expect(pathForView("editor", { session: "s1" })).toBe("/editor/s1");
  });

  it("encodes result as /result/:project when a project id is given", () => {
    expect(pathForView("result", { project: "p1" })).toBe("/result/p1");
  });

  it("returns empty for editor/result with no id yet, and for tracing", () => {
    expect(pathForView("editor")).toBe("");
    expect(pathForView("result")).toBe("");
    expect(pathForView("tracing")).toBe("");
  });

  it("round-trips through decodeUrlState", () => {
    expect(decodeUrlState(pathForView("calibration")).view).toBe("calibration");
    expect(decodeUrlState(pathForView("editor", { session: "s1" })).session).toBe("s1");
  });
});

describe("pathForCombine / pathForBinReopen", () => {
  it("builds and round-trips a fresh combine path", () => {
    const path = pathForCombine(["id1", "id2"]);
    expect(path).toBe("/library/combine/id1,id2");
    expect(decodeUrlState(path)).toEqual({
      view: "library", session: null, project: null, combineIds: ["id1", "id2"], reopenBinId: null,
    });
  });

  it("builds and round-trips a saved-bin reopen path", () => {
    const path = pathForBinReopen("bin1");
    expect(path).toBe("/bins/bin1/combine");
    expect(decodeUrlState(path)).toEqual({
      view: "bins", session: null, project: null, combineIds: null, reopenBinId: "bin1",
    });
  });
});
