// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PhotoLightbox } from "./PhotoLightbox";
import type { PhotoOutline } from "../api";

afterEach(() => cleanup());

const BASE: PhotoOutline = {
  has_photo: true,
  display: "/api/library/t1/photo",
  width: 400,
  height: 300,
  outline: [[10, 10], [100, 10], [100, 100], [10, 100]],
  diverged: false,
};

describe("PhotoLightbox divergence overlay", () => {
  it("draws a single outline and no legend when the cutout hasn't diverged", () => {
    const { container } = render(
      <PhotoLightbox data={BASE} label="Wrench" onClose={vi.fn()} onCutout={vi.fn()} onRefine={vi.fn()} />,
    );

    expect(container.querySelectorAll("polygon")).toHaveLength(2); // halo + colored, one outline
    expect(screen.queryByText("photo selection")).toBeNull();
    expect(screen.queryByText("physical cutout")).toBeNull();
  });

  it("draws both outlines and a legend once the cutout has diverged", () => {
    const data: PhotoOutline = {
      ...BASE,
      diverged: true,
      cutout_outline: [[20, 20], [110, 20], [110, 110], [20, 110]],
    };
    const { container } = render(
      <PhotoLightbox data={data} label="Wrench" onClose={vi.fn()} onCutout={vi.fn()} onRefine={vi.fn()} />,
    );

    expect(container.querySelectorAll("polygon")).toHaveLength(4); // two outlines, halo + colored each
    expect(screen.getByText("photo selection")).toBeTruthy();
    expect(screen.getByText("physical cutout")).toBeTruthy();
  });
});
