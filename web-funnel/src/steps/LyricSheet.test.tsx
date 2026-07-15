import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LyricSheet } from "./LyricSheet";

describe("lyric sheet", () => {
  it("highlights only the recipient and renders no kicker", () => {
    render(
      <LyricSheet
        recipient="Sarah"
        lines={["One true line"]}
        generations={1}
        busy={false}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    const heading = screen.getByRole("heading", { name: "These are Sarah's words." });
    expect(heading.querySelector(".lyric-recipient")).toHaveTextContent("Sarah");
    expect(screen.queryByText(/for sarah/i)).not.toBeInTheDocument();
  });
});
