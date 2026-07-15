import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theater } from "./Theater";

describe("generation theater", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.style.removeProperty("--t-stage");
    document.documentElement.style.removeProperty("--t-theater-hold");
  });

  it("never regresses when server progress reports an earlier stage", () => {
    const props = { recipient: "Sarah", lyrics: ["First line"] };
    const { rerender } = render(<Theater {...props} progressStage={4} />);
    expect(screen.getByText("Mixing")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Making your song" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );

    rerender(<Theater {...props} progressStage={1} />);
    expect(screen.getByText("Mixing")).toBeVisible();
  });

  it("offers the hold form only after 150 seconds and submits its email", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--t-stage", "12s");
    document.documentElement.style.setProperty("--t-theater-hold", "150s");
    const onHoldPlace = vi.fn();
    render(
      <Theater
        recipient="Sarah"
        lyrics={["First line"]}
        onHoldPlace={onHoldPlace}
      />,
    );

    act(() => vi.advanceTimersByTime(149999));
    expect(screen.queryByLabelText("Want us to tell you when it's ready?")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    const email = screen.getByLabelText("Want us to tell you when it's ready?");
    fireEvent.change(email, { target: { value: "ambrose@example.com" } });
    fireEvent.submit(email.closest("form")!);
    expect(onHoldPlace).toHaveBeenCalledWith("ambrose@example.com");
  });
});
