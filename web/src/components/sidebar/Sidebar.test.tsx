// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

describe("Sidebar", () => {
  it("renders children when expanded", () => {
    render(
      <Sidebar side="right" collapsed={false} onToggleCollapse={() => {}}>
        <p>Bin config</p>
      </Sidebar>,
    );
    expect(screen.getByText("Bin config")).toBeTruthy();
  });

  it("hides children when collapsed, keeping only the expand toggle", () => {
    render(
      <Sidebar side="right" collapsed={true} onToggleCollapse={() => {}}>
        <p>Bin config</p>
      </Sidebar>,
    );
    expect(screen.queryByText("Bin config")).toBeNull();
    expect(screen.getByLabelText("Expand right sidebar")).toBeTruthy();
  });

  it("calls onToggleCollapse from either state's toggle button", () => {
    const onToggleCollapse = vi.fn();
    const { rerender } = render(
      <Sidebar side="left" collapsed={false} onToggleCollapse={onToggleCollapse}>
        <p>Content</p>
      </Sidebar>,
    );
    fireEvent.click(screen.getByLabelText("Collapse left sidebar"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);

    rerender(
      <Sidebar side="left" collapsed={true} onToggleCollapse={onToggleCollapse}>
        <p>Content</p>
      </Sidebar>,
    );
    fireEvent.click(screen.getByLabelText("Expand left sidebar"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(2);
  });
});
