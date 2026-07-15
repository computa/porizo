import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState, funnelReducer } from "../state/funnel";
import { QuizFlow } from "./QuizFlow";

describe("stacked quiz", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.style.removeProperty("--t-chip-delay");
    document.documentElement.style.removeProperty("--t-step");
  });

  it("uses the family-vocabulary recipient placeholder", () => {
    render(
      <QuizFlow
        state={createInitialState()}
        dispatch={vi.fn()}
        onStartSession={vi.fn().mockResolvedValue(true)}
        onWriteSong={vi.fn()}
        busy={false}
      />,
    );

    expect(screen.getByLabelText("Recipient's name")).toHaveAttribute("placeholder", "Their name");
  });

  it("offers explicit resume and start-over actions for a saved draft", () => {
    const onResume = vi.fn();
    const onDiscardResume = vi.fn();
    render(
      <QuizFlow
        state={createInitialState()}
        dispatch={vi.fn()}
        onStartSession={vi.fn().mockResolvedValue(true)}
        onWriteSong={vi.fn()}
        busy={false}
        resumeRecipient="Sarah"
        onResume={onResume}
        onDiscardResume={onDiscardResume}
      />,
    );

    expect(screen.getByText("Pick up Sarah's song where you left off")).toBeVisible();
    expect(screen.getByLabelText("Recipient's name")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Pick up the song" }));
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onDiscardResume).toHaveBeenCalledOnce();
  });

  it("auto-advances a relationship after the 250ms chip delay", async () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--t-chip-delay", "250ms");
    document.documentElement.style.setProperty("--t-step", "0ms");
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

    fireEvent.click(screen.getByRole("button", { name: "Mum" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "answer", step: "relationship", value: "Mum" });
    await vi.advanceTimersByTimeAsync(249);
    expect(dispatch).not.toHaveBeenCalledWith({ type: "advance", to: undefined });
    await vi.advanceTimersByTimeAsync(1);
    await vi.runOnlyPendingTimersAsync();
    expect(dispatch).toHaveBeenCalledWith({ type: "advance", to: undefined });
  });
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
    expect(dispatch).toHaveBeenCalledWith({ type: "edit", step: "recipient", returnTo: "relationship" });
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

  it("keeps downstream context visible while a completed answer is edited", () => {
    let state = createInitialState();
    for (const [step, value] of [
      ["recipient", "Sarah"],
      ["relationship", "Mum"],
      ["occasion", "I Love You ❤️"],
      ["memory", "She sang every Sunday while making breakfast."],
    ] as const) {
      state = funnelReducer(state, { type: "answer", step, value });
      state = funnelReducer(state, { type: "advance" });
    }
    state = funnelReducer(state, { type: "edit", step: "recipient" });

    render(
      <QuizFlow
        state={state}
        dispatch={vi.fn()}
        onStartSession={vi.fn().mockResolvedValue(true)}
        onWriteSong={vi.fn()}
        busy={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Who's this song for?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit your: Mum" })).toBeVisible();
    expect(screen.getByLabelText("How should it sound? Waiting while you edit")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel edit" })).toBeVisible();
  });

  it("preserves the original return step when switching editors", () => {
    let state = createInitialState();
    for (const [step, value] of [
      ["recipient", "Sarah"],
      ["relationship", "Mum"],
      ["occasion", "I Love You ❤️"],
      ["memory", "She sang every Sunday while making breakfast."],
    ] as const) {
      state = funnelReducer(state, { type: "answer", step, value });
      state = funnelReducer(state, { type: "advance" });
    }
    state = funnelReducer(state, { type: "edit", step: "recipient" });
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

    fireEvent.click(screen.getByRole("button", { name: "Edit your: Mum" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "edit", step: "relationship", returnTo: "sound" });
  });

  it("keeps the dense sound choices in compact horizontal rails", () => {
    let state = createInitialState();
    state = { ...state, activeStep: "sound", furthestStep: "sound" };

    render(
      <QuizFlow
        state={state}
        dispatch={vi.fn()}
        onStartSession={vi.fn().mockResolvedValue(true)}
        onWriteSong={vi.fn()}
        busy={false}
      />,
    );

    expect(screen.getByRole("group", { name: "Style" }).querySelector(".chips")).toHaveClass(
      "choice-rail",
      "style-rail",
    );
    expect(screen.getByRole("group", { name: "Mood" }).querySelector(".chips")).toHaveClass("choice-rail");
    expect(screen.getByRole("group", { name: "Voice" }).querySelector(".chips")).not.toHaveClass("choice-rail");
  });
});
