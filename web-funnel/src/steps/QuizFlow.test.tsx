import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInitialState, funnelReducer } from "../state/funnel";
import { QuizFlow } from "./QuizFlow";

describe("stacked quiz", () => {
  it("keeps answered steps as editable summary rows", () => {
    let state = funnelReducer(createInitialState(), { type: "answer", step: "recipient", value: "Sarah" });
    state = funnelReducer(state, { type: "advance" });
    const dispatch = vi.fn();
    render(
      <QuizFlow
        state={state}
        dispatch={dispatch}
        onStartSession={vi.fn().mockResolvedValue(true)}
        onWriteSong={vi.fn()}
        busy={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit for: Sarah" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "edit", step: "recipient" });
    expect(screen.getByRole("heading", { name: "Sarah is your…" })).toBeVisible();
  });

  it("starts a guest session before committing the recipient step", async () => {
    const dispatch = vi.fn();
    const onStartSession = vi.fn().mockResolvedValue(true);
    const state = funnelReducer(createInitialState(), {
      type: "answer",
      step: "recipient",
      value: "Sarah",
    });
    render(
      <QuizFlow
        state={state}
        dispatch={dispatch}
        onStartSession={onStartSession}
        onWriteSong={vi.fn()}
        busy={false}
      />,
    );
    const input = screen.getByLabelText("Recipient's name");

    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(onStartSession).toHaveBeenCalledOnce());
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "advance", to: undefined }));
  });
});
