import { describe, expect, it } from "vitest";
import { decodeUrlState, encodeViewParams } from "./urlState";

describe("decodeUrlState", () => {
  it("reads a plain view param", () => {
    expect(decodeUrlState("?view=library")).toEqual({ view: "library", session: null, project: null });
  });

  it("rejects an unknown or unlinkable view (including tracing)", () => {
    expect(decodeUrlState("?view=tracing").view).toBeNull();
    expect(decodeUrlState("?view=editor").view).toBeNull();
    expect(decodeUrlState("?view=bogus").view).toBeNull();
  });

  it("reads session and project independently of view", () => {
    expect(decodeUrlState("?session=abc")).toEqual({ view: null, session: "abc", project: null });
    expect(decodeUrlState("?project=xyz")).toEqual({ view: null, session: null, project: "xyz" });
  });

  it("returns all null on an empty query", () => {
    expect(decodeUrlState("")).toEqual({ view: null, session: null, project: null });
  });
});

describe("encodeViewParams", () => {
  it("encodes a plain view as view=", () => {
    expect(encodeViewParams("bins")).toBe("view=bins");
  });

  it("encodes editor as session= when a session id is given", () => {
    expect(encodeViewParams("editor", { session: "s1" })).toBe("session=s1");
  });

  it("encodes result as project= when a project id is given", () => {
    expect(encodeViewParams("result", { project: "p1" })).toBe("project=p1");
  });

  it("returns empty for editor/result with no id yet, and for tracing", () => {
    expect(encodeViewParams("editor")).toBe("");
    expect(encodeViewParams("result")).toBe("");
    expect(encodeViewParams("tracing")).toBe("");
  });

  it("round-trips through decodeUrlState", () => {
    const qs = encodeViewParams("calibration");
    expect(decodeUrlState(`?${qs}`).view).toBe("calibration");
  });
});
