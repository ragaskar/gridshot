// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { hydrateFromUrl } from "./App";
import type { Session } from "./api";

vi.mock("./api", () => ({
  getSession: vi.fn(),
}));

import { getSession } from "./api";

const ACTIVE_SESSION_KEY = "gridshot.active-single-session.v1";

function setPath(path: string) {
  window.history.pushState({}, "", path);
}

describe("hydrateFromUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(getSession).mockReset();
  });

  afterEach(() => {
    setPath("/");
  });

  it("restores a stored session on the bare root but lands on the Tool Library, not the editor", async () => {
    window.localStorage.setItem(
      ACTIVE_SESSION_KEY,
      JSON.stringify({ session: "s1", params: { foo: 1 } }),
    );
    vi.mocked(getSession).mockResolvedValue({ session: "s1" } as Session);
    setPath("/");

    const setResult = vi.fn();
    const setEditor = vi.fn();
    const navigate = vi.fn();
    hydrateFromUrl(setResult, setEditor, navigate);

    await waitFor(() => expect(setEditor).toHaveBeenCalled());
    expect(setEditor).toHaveBeenCalledWith({ session: "s1" }, { foo: 1 });
    expect(navigate).toHaveBeenCalledWith("library");
  });

  it("does nothing on a bare root with no stored session", () => {
    setPath("/");
    const setResult = vi.fn();
    const setEditor = vi.fn();
    const navigate = vi.fn();
    hydrateFromUrl(setResult, setEditor, navigate);
    expect(setEditor).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("honors an explicit view path even with a stored session", () => {
    window.localStorage.setItem(
      ACTIVE_SESSION_KEY,
      JSON.stringify({ session: "s1", params: {} }),
    );
    setPath("/bins");

    const setResult = vi.fn();
    const setEditor = vi.fn();
    const navigate = vi.fn();
    hydrateFromUrl(setResult, setEditor, navigate);

    expect(navigate).toHaveBeenCalledWith("bins");
    expect(setEditor).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("opens an explicit /editor/:id deep link directly, without redirecting to the library", async () => {
    vi.mocked(getSession).mockResolvedValue({ session: "s2" } as Session);
    setPath("/editor/s2");

    const setResult = vi.fn();
    const setEditor = vi.fn();
    const navigate = vi.fn();
    hydrateFromUrl(setResult, setEditor, navigate);

    await waitFor(() => expect(setEditor).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });
});
