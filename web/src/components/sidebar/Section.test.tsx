// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Section } from "./Section";

afterEach(cleanup);

describe("Section", () => {
  it("renders its children even while closed — content is never unmounted", () => {
    render(
      <Section title="Bin config" open={false} onToggle={() => {}}>
        <p>Bin config body</p>
      </Section>,
    );
    expect(screen.getByText("Bin config body")).toBeTruthy();
  });

  it("calls onToggle when the header is clicked, without relying on onToggle to drive `open`", () => {
    const onToggle = vi.fn();
    render(
      <Section title="Bin config" open={false} onToggle={onToggle}>
        <p>Body</p>
      </Section>,
    );
    fireEvent.click(screen.getByText("Bin config"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps content visible and the header clickable while disabled", () => {
    const onToggle = vi.fn();
    render(
      <Section title="Tool config" open={true} onToggle={onToggle} disabled>
        <button>Duplicate</button>
      </Section>,
    );
    expect(screen.getByText("Duplicate")).toBeTruthy();
    fireEvent.click(screen.getByText("Tool config"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
