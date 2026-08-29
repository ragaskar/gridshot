// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ControlGroup } from "./ControlGroup";

afterEach(cleanup);

describe("ControlGroup", () => {
  it("renders a title and its children", () => {
    render(
      <ControlGroup title="Horizontal align">
        <button>Left</button>
      </ControlGroup>,
    );
    expect(screen.getByText("Horizontal align")).toBeTruthy();
    expect(screen.getByText("Left")).toBeTruthy();
  });

  it("renders without a title", () => {
    render(
      <ControlGroup>
        <button>Add tool</button>
      </ControlGroup>,
    );
    expect(screen.getByText("Add tool")).toBeTruthy();
  });
});
