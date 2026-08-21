import { describe, expect, it } from "vitest";
import { binExportName } from "./exportNaming";

describe("binExportName", () => {
  it("uses the saved bin's name when there is one", () => {
    expect(binExportName("My Combined Bin", ["Wrench", "Pliers"])).toBe("My Combined Bin");
  });

  it("falls back to the tool names when not saved", () => {
    expect(binExportName(null, ["Wrench", "Pliers"])).toBe("Wrench, Pliers");
    expect(binExportName(undefined, ["Wrench"])).toBe("Wrench");
  });

  it("ignores a blank bin label and falls back to tool names", () => {
    expect(binExportName("   ", ["Wrench", "Pliers"])).toBe("Wrench, Pliers");
  });

  it("caps a long tool selection at 3 names plus a count", () => {
    expect(binExportName(null, ["Wrench", "Pliers", "Hammer", "Chisel", "Level"]))
      .toBe("Wrench, Pliers, Hammer +2 more");
  });

  it("skips blank tool labels", () => {
    expect(binExportName(null, ["Wrench", "", "  ", "Pliers"])).toBe("Wrench, Pliers");
  });

  it("falls back to a generic name when nothing is usable", () => {
    expect(binExportName(null, [])).toBe("multitool-bin");
    expect(binExportName(null, ["", "  "])).toBe("multitool-bin");
  });

  it("replaces filesystem-unsafe characters", () => {
    expect(binExportName('Bin: "Corner" / Test', [])).toBe("Bin- -Corner- - Test");
  });

  it("collapses internal whitespace and trims", () => {
    expect(binExportName("  Spacey   Bin  ", [])).toBe("Spacey Bin");
  });
});
