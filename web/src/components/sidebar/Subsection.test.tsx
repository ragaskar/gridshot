// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Subsection } from "./Subsection";

afterEach(cleanup);

describe("Subsection", () => {
  it("renders its children even while closed", () => {
    render(
      <Subsection title="Shape" open={false} onToggle={() => {}}>
        <p>Shape body</p>
      </Subsection>,
    );
    expect(screen.getByText("Shape body")).toBeTruthy();
  });

  it("calls onToggle on header click", () => {
    const onToggle = vi.fn();
    render(
      <Subsection title="Shape" open={false} onToggle={onToggle}>
        <p>Body</p>
      </Subsection>,
    );
    fireEvent.click(screen.getByText("Shape"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows headerExtra in both open and closed states, and it doesn't toggle the header on click", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <Subsection
        title="Fingerhole"
        open={false}
        onToggle={onToggle}
        headerExtra={<button>On</button>}
      >
        <p>Body</p>
      </Subsection>,
    );
    expect(screen.getByText("On")).toBeTruthy();
    fireEvent.click(screen.getByText("On"));
    expect(onToggle).not.toHaveBeenCalled();

    rerender(
      <Subsection
        title="Fingerhole"
        open={true}
        onToggle={onToggle}
        headerExtra={<button>On</button>}
      >
        <p>Body</p>
      </Subsection>,
    );
    expect(screen.getByText("On")).toBeTruthy();
  });

  it("bolds the title when relevant, and doesn't when not", () => {
    const { rerender } = render(
      <Subsection title="Shape" open={true} onToggle={() => {}} relevant={true}>
        <p>Body</p>
      </Subsection>,
    );
    expect(screen.getByText("Shape").className).toContain("font-bold");

    rerender(
      <Subsection title="Shape" open={true} onToggle={() => {}} relevant={false}>
        <p>Body</p>
      </Subsection>,
    );
    expect(screen.getByText("Shape").className).not.toContain("font-bold");
  });

  it("shows a down chevron closed and an up chevron open", () => {
    const { rerender } = render(
      <Subsection title="Shape" open={false} onToggle={() => {}}>
        <p>Body</p>
      </Subsection>,
    );
    expect(screen.getByText("▾")).toBeTruthy();

    rerender(
      <Subsection title="Shape" open={true} onToggle={() => {}}>
        <p>Body</p>
      </Subsection>,
    );
    expect(screen.getByText("▴")).toBeTruthy();
  });
});
