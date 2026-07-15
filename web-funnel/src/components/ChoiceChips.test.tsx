import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChoiceChips } from "./ChoiceChips";

describe("choice rails", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [false, "smooth"],
    [true, "auto"],
  ] as const)("brings the selection into view with reduced motion %s", (reduced, behavior) => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: reduced,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    render(
      <ChoiceChips
        label="Style"
        className="choice-rail"
        options={["Pop", "Acoustic", "Soul"]}
        value="Soul"
        onChange={vi.fn()}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior,
      block: "nearest",
      inline: "nearest",
    });
  });
});
