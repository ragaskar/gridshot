import { describe, expect, it } from "vitest";
import {
  decodeUrlState, pathForBinProfileEdit, pathForBinReopen, pathForCombine, pathForCompose,
  pathForNewBin, pathForView,
} from "./urlState";

const NOTHING = {
  view: null, session: null, project: null, combineIds: null, reopenBinId: null, composeIds: null,
  editBinProfileId: null,
};

describe("decodeUrlState", () => {
  it("reads a plain view path", () => {
    expect(decodeUrlState("/library")).toEqual({ ...NOTHING, view: "library" });
  });

  it("rejects an unknown or unlinkable head segment (including tracing)", () => {
    expect(decodeUrlState("/tracing").view).toBeNull();
    expect(decodeUrlState("/bogus").view).toBeNull();
  });

  it("treats the bare root as nothing decoded, leaving the default view to the caller", () => {
    expect(decodeUrlState("/")).toEqual(NOTHING);
  });

  it("reads editor and result ids from their own path segment", () => {
    expect(decodeUrlState("/editor/abc")).toEqual({ ...NOTHING, session: "abc" });
    expect(decodeUrlState("/result/xyz")).toEqual({ ...NOTHING, project: "xyz" });
  });

  it("decodes URI-escaped ids", () => {
    expect(decodeUrlState("/editor/a%20b").session).toBe("a b");
  });

  it("reads a fresh combine selection from its own page path", () => {
    expect(decodeUrlState("/combine/id1,id2,id3")).toEqual({
      ...NOTHING, view: "combine", combineIds: ["id1", "id2", "id3"],
    });
  });

  it("reads a saved-bin reopen from its own page path", () => {
    expect(decodeUrlState("/combine/reopen/bin1")).toEqual({
      ...NOTHING, view: "combine", reopenBinId: "bin1",
    });
  });

  it("reads a brand-new blank bin from its own page path, with an empty (not null) id list", () => {
    expect(decodeUrlState("/combine/new")).toEqual({
      ...NOTHING, view: "combine", combineIds: [],
    });
  });

  it("reads a fresh compose selection from its own page path", () => {
    expect(decodeUrlState("/compose/id1,id2")).toEqual({
      ...NOTHING, view: "compose", composeIds: ["id1", "id2"],
    });
  });

  it("decodes nothing for a bare /combine or /compose (no selection to show)", () => {
    expect(decodeUrlState("/combine")).toEqual(NOTHING);
    expect(decodeUrlState("/compose")).toEqual(NOTHING);
  });

  it("reads the bare Bin Profiles list path", () => {
    expect(decodeUrlState("/bin-profiles")).toEqual({ ...NOTHING, view: "binProfiles" });
  });

  it("reads a bin profile edit id nested under /bin-profiles", () => {
    expect(decodeUrlState("/bin-profiles/p1")).toEqual({
      ...NOTHING, view: "binProfiles", editBinProfileId: "p1",
    });
  });

  it("returns nothing decoded on an empty string", () => {
    expect(decodeUrlState("")).toEqual(NOTHING);
  });
});

describe("pathForView", () => {
  it("maps upload to the root path", () => {
    expect(pathForView("upload")).toBe("/");
  });

  it("maps a plain view to /view", () => {
    expect(pathForView("bins")).toBe("/bins");
  });

  it("maps binProfiles to the kebab-cased /bin-profiles, matching the REST API", () => {
    expect(pathForView("binProfiles")).toBe("/bin-profiles");
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

  it("returns empty for combine/compose — always addressed with a selection instead", () => {
    expect(pathForView("combine")).toBe("");
    expect(pathForView("compose")).toBe("");
  });

  it("round-trips through decodeUrlState", () => {
    expect(decodeUrlState(pathForView("calibration")).view).toBe("calibration");
    expect(decodeUrlState(pathForView("editor", { session: "s1" })).session).toBe("s1");
    expect(decodeUrlState(pathForView("binProfiles")).view).toBe("binProfiles");
  });
});

describe("pathForCombine / pathForCompose / pathForBinReopen / pathForBinProfileEdit", () => {
  it("builds and round-trips a fresh combine path", () => {
    const path = pathForCombine(["id1", "id2"]);
    expect(path).toBe("/combine/id1,id2");
    expect(decodeUrlState(path)).toEqual({ ...NOTHING, view: "combine", combineIds: ["id1", "id2"] });
  });

  it("builds and round-trips a saved-bin reopen path", () => {
    const path = pathForBinReopen("bin1");
    expect(path).toBe("/combine/reopen/bin1");
    expect(decodeUrlState(path)).toEqual({ ...NOTHING, view: "combine", reopenBinId: "bin1" });
  });

  it("builds and round-trips a new-blank-bin path", () => {
    const path = pathForNewBin();
    expect(path).toBe("/combine/new");
    expect(decodeUrlState(path)).toEqual({ ...NOTHING, view: "combine", combineIds: [] });
  });

  it("builds and round-trips a fresh compose path", () => {
    const path = pathForCompose(["id1", "id2"]);
    expect(path).toBe("/compose/id1,id2");
    expect(decodeUrlState(path)).toEqual({ ...NOTHING, view: "compose", composeIds: ["id1", "id2"] });
  });

  it("builds and round-trips a bin profile edit path", () => {
    const path = pathForBinProfileEdit("p1");
    expect(path).toBe("/bin-profiles/p1");
    expect(decodeUrlState(path)).toEqual({ ...NOTHING, view: "binProfiles", editBinProfileId: "p1" });
  });
});
