// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BuildFooter } from "./BuildFooter";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("BuildFooter", () => {
  it("shows the sha and the build time formatted in the browser's own timezone", () => {
    vi.stubEnv("VITE_GIT_SHA", "abc1234");
    vi.stubEnv("VITE_BUILD_TIME", "2026-08-22T15:00:00Z");

    render(<BuildFooter />);

    const expected = new Date("2026-08-22T15:00:00Z").toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
    expect(screen.getByText(`gridshot build abc1234 (${expected})`)).toBeTruthy();
  });

  it("falls back to 'unknown' for an unset sha or an unparsable build time", () => {
    vi.stubEnv("VITE_GIT_SHA", "");
    vi.stubEnv("VITE_BUILD_TIME", "");

    render(<BuildFooter />);

    expect(screen.getByText("gridshot build unknown (unknown)")).toBeTruthy();
  });
});
