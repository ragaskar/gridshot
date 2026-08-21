// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { commitOnChange } from "./domEvents";

describe("commitOnChange", () => {
  it("commits on the native change event, with the input's current value", () => {
    const el = document.createElement("input");
    el.value = "start";
    const onCommit = vi.fn();
    commitOnChange(onCommit)(el);

    el.value = "2.5";
    el.dispatchEvent(new Event("change"));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("2.5", expect.any(Event));
  });

  it("does not commit on a bare input event (per-keystroke typing)", () => {
    const el = document.createElement("input");
    const onCommit = vi.fn();
    commitOnChange(onCommit)(el);

    el.value = "1";
    el.dispatchEvent(new Event("input"));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("is a no-op when the ref callback runs with a null element (unmount)", () => {
    expect(() => commitOnChange(vi.fn())(null)).not.toThrow();
  });
});
