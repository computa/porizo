import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { createInitialState, funnelReducer, serializeState } from "./state/funnel";
import { resolveInitialState } from "./state/initial-state";

describe("initial funnel route", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("lets a checkout success route override saved offer state", () => {
    const stored = {
      ...createInitialState(),
      activeStep: "offer" as const,
      furthestStep: "offer" as const,
    };
    const state = resolveInitialState(
      serializeState(stored),
      "?session_id=checkout-1",
      "/create/success",
    );

    expect(state.activeStep).toBe("success");
    expect(state.answers).toEqual(stored.answers);
  });

  it("supports a cold checkout success route without funnel state", () => {
    const state = resolveInitialState(null, "?session_id=checkout-1", "/create/success");

    expect(state.activeStep).toBe("success");
    expect(state.answers.recipient).toBe("");
  });

  it("preselects valid landing-page occasions", () => {
    const state = resolveInitialState(null, "?occasion=Birthday", "/create");

    expect(state.answers.occasion).toBe("Birthday 🎂");
  });

  it("lets an explicit landing occasion update resumed progress", () => {
    const stored = {
      ...createInitialState(),
      activeStep: "memory" as const,
      furthestStep: "memory" as const,
      answers: { ...createInitialState().answers, occasion: "I Love You ❤️" },
    };

    const state = resolveInitialState(serializeState(stored), "?occasion=Wedding", "/create");

    expect(state.activeStep).toBe("memory");
    expect(state.answers.occasion).toBe("Wedding 💒");
  });

  it("does not invent a Father's Day option before the family enum supports it", () => {
    const state = resolveInitialState(null, "?occasion=Father%27s%20Day", "/create");

    expect(state.answers.occasion).toBe("");
  });

  it("shows the site footer only until the first answer commits", () => {
    const entry = render(<App />);
    expect(screen.getByRole("contentinfo")).toBeVisible();
    entry.unmount();

    let progressed = funnelReducer(createInitialState(), {
      type: "answer",
      step: "recipient",
      value: "Sarah",
    });
    progressed = funnelReducer(progressed, { type: "advance" });
    localStorage.setItem("porizo.web-funnel.v1", serializeState(progressed));
    render(<App />);

    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });
});
