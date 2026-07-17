import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createInitialState, funnelReducer, serializeState } from "./state/funnel";
import { resolveInitialState, resolveResumeCandidate } from "./state/initial-state";
import { TurnstileError } from "./turnstile";
import { actionErrorCopy, sessionStartErrorCopy } from "./session-errors";
import { ApiError } from "./api/client";

describe("initial funnel route", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty("--t-checkout-timeout");
    localStorage.clear();
    history.replaceState({}, "", "/create");
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

  it("preselects an explicit landing occasion without skipping the occasion step", () => {
    const stored = {
      ...createInitialState(),
      activeStep: "memory" as const,
      furthestStep: "memory" as const,
      answers: { ...createInitialState().answers, occasion: "I Love You ❤️" },
    };

    const state = resolveInitialState(serializeState(stored), "?occasion=Wedding", "/create");

    expect(state.activeStep).toBe("recipient");
    expect(state.answers.occasion).toBe("Wedding 💒");
  });

  it("does not let persisted success state hijack a fresh entry", () => {
    const stored = {
      ...createInitialState(),
      activeStep: "success" as const,
      furthestStep: "success" as const,
      answers: { ...createInitialState().answers, recipient: "Sarah" },
    };

    const state = resolveInitialState(
      serializeState(stored),
      "",
      "/create/",
      "#recipient",
    );

    expect(state.activeStep).toBe("recipient");
    expect(resolveResumeCandidate(serializeState(stored), "", "/create/")).toBeNull();
  });

  it("offers a fresh saved draft for seven days without overwriting route intent", () => {
    const now = Date.now();
    const stored = {
      ...createInitialState(),
      savedAt: now,
      activeStep: "memory" as const,
      furthestStep: "memory" as const,
      answers: { ...createInitialState().answers, recipient: "Sarah" },
    };

    expect(resolveResumeCandidate(serializeState(stored), "", "/create", "", now)?.furthestStep)
      .toBe("memory");
    expect(resolveResumeCandidate(serializeState(stored), "", "/create", "#memory", now))
      .toBeNull();
    expect(resolveResumeCandidate(
      serializeState(stored),
      "",
      "/create",
      "",
      now + 7 * 24 * 60 * 60 * 1000 + 1,
    )).toBeNull();
  });

  it("restores a cancelled checkout to an offer when purchase artifacts exist", () => {
    const stored = {
      ...createInitialState(),
      activeStep: "offer" as const,
      furthestStep: "offer" as const,
      artifacts: {
        ...createInitialState().artifacts,
        trackId: "track-1",
        versionId: "version-1",
      },
    };

    expect(resolveInitialState(
      serializeState(stored),
      "?cancelled=1",
      "/create",
    ).activeStep).toBe("offer");
  });

  it("preselects Custom for the advertised seasonal entry point", () => {
    const state = resolveInitialState(null, "?occasion=Custom", "/create");

    expect(state.answers.occasion).toBe("Custom ✨");
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
    history.replaceState({}, "", "/create#relationship");
    render(<App />);

    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("bridges an existing same-origin web session before creating a guest", async () => {
    vi.spyOn(document, "cookie", "get").mockReturnValue(
      "__Host-porizo_web_csrf=web-csrf-token",
    );
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "signed-in-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText("Recipient's name"), {
      target: { value: "Chioma" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/auth/web/token",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          headers: expect.objectContaining({ "X-CSRF-Token": "web-csrf-token" }),
        }),
      ),
    );
    expect(fetcher).not.toHaveBeenCalledWith("/web/session", expect.anything());
    expect(localStorage.getItem("porizo.web-funnel.token")).toBe("signed-in-token");
  });

  it("confirms reset, preserves guest credentials, and removes stale route intent", () => {
    let progressed = funnelReducer(createInitialState(), {
      type: "answer",
      step: "recipient",
      value: "Sarah",
    });
    progressed = funnelReducer(progressed, { type: "advance" });
    localStorage.setItem("porizo.web-funnel.v1", serializeState(progressed));
    localStorage.setItem("porizo.web-funnel.token", "access-token");
    localStorage.setItem("porizo.web-funnel.refresh-token", "refresh-token");
    history.replaceState({}, "", "/create#relationship");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));

    expect(confirm).toHaveBeenCalledWith("Your song for Sarah will be lost.");
    expect(localStorage.getItem("porizo.web-funnel.token")).toBe("access-token");
    expect(localStorage.getItem("porizo.web-funnel.refresh-token")).toBe("refresh-token");
    expect(location.pathname).toBe("/create");
    expect(location.hash).toBe("#recipient");
    expect(screen.getByRole("heading", { name: "Who's this song for?" })).toBeVisible();
    confirm.mockRestore();
  });

  it("keeps a saved draft until its Start over confirmation is accepted", () => {
    const saved = {
      ...createInitialState(),
      activeStep: "memory" as const,
      furthestStep: "memory" as const,
      answers: { ...createInitialState().answers, recipient: "Sarah" },
    };
    const serialized = serializeState(saved);
    localStorage.setItem("porizo.web-funnel.v1", serialized);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    render(<App />);
    const startOver = screen.getByRole("button", { name: "Start over" });
    fireEvent.click(startOver);
    expect(localStorage.getItem("porizo.web-funnel.v1")).toBe(serialized);
    expect(screen.getByText("Pick up Sarah's song where you left off")).toBeVisible();

    fireEvent.click(startOver);
    expect(screen.queryByText("Pick up Sarah's song where you left off")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Who's this song for?" })).toBeVisible();
    confirm.mockRestore();
  });

  it("reattaches polling when a saved theater job is resumed", async () => {
    const saved = {
      ...createInitialState(),
      activeStep: "theater" as const,
      furthestStep: "theater" as const,
      answers: { ...createInitialState().answers, recipient: "Sarah" },
      artifacts: {
        previewGenerations: 0,
        trackId: "track-1",
        versionId: "version-1",
        versionNum: 1,
        jobId: "job-1",
        lyrics: ["First line"],
      },
    };
    localStorage.setItem("porizo.web-funnel.v1", serializeState(saved));
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/jobs/job-1") {
        return new Response(JSON.stringify({ status: "completed", progress: 100 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/tracks/track-1") {
        return new Response(JSON.stringify({ versions: [{ version_num: 1, preview_url: "/preview.m4a" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${path}`);
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Pick up the song" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/jobs/job-1",
      expect.any(Object),
    ));
    expect(await screen.findByRole("button", { name: "Play preview" })).toBeVisible();
    fetcher.mockRestore();
  });

  it("shows the retry card after the silent preview retry also fails", async () => {
    const saved = {
      ...createInitialState(),
      activeStep: "lyrics" as const,
      furthestStep: "lyrics" as const,
      answers: { ...createInitialState().answers, recipient: "Sarah" },
      artifacts: {
        previewGenerations: 0,
        trackId: "track-1",
        versionId: "version-1",
        versionNum: 1,
        lyrics: ["First line"],
      },
    };
    localStorage.setItem("porizo.web-funnel.v1", serializeState(saved));
    localStorage.setItem("porizo.web-funnel.token", "guest-token");
    history.replaceState({}, "", "/create#lyrics");
    window.turnstileToken = "preview-token";
    window.turnstile = {
      render: vi.fn((_container, options) => {
        options.callback("retry-token");
        return "retry-widget";
      }),
      execute: vi.fn(),
      remove: vi.fn(),
    };
    const responses = [
      {},
      { job_id: "job-1" },
      { status: "failed" },
      { job_id: "job-2" },
      { status: "failed", error: "still failed" },
    ];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Sounds right — hear it" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That take didn't come together");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(5);
    fetcher.mockRestore();
  });

  it("aborts checkout at five seconds and restores the action", async () => {
    const saved = {
      ...createInitialState(),
      activeStep: "offer" as const,
      furthestStep: "offer" as const,
      answers: { ...createInitialState().answers, recipient: "Sarah" },
      artifacts: {
        previewGenerations: 1,
        trackId: "track-1",
        versionId: "version-1",
        versionNum: 1,
      },
    };
    localStorage.setItem("porizo.web-funnel.v1", serializeState(saved));
    localStorage.setItem("porizo.web-funnel.token", "guest-token");
    history.replaceState({}, "", "/create#offer");
    let checkoutSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/web/products") {
        return new Response(JSON.stringify({
          products: [{ price_key: "gift-song-au", localized_price: "$19.99" }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      checkoutSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        checkoutSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });

    render(<App />);
    const checkout = await screen.findByRole("button", { name: "Unlock for $19.99" });
    document.documentElement.style.setProperty("--t-checkout-timeout", "5s");
    vi.useFakeTimers();
    fireEvent.click(checkout);
    expect(screen.getByRole("button", { name: "Opening secure checkout…" })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(4999));
    expect(screen.queryByText("Secure checkout didn't open. Please try again.")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(checkoutSignal?.aborted).toBe(true);
    expect(screen.getByText("Secure checkout didn't open. Your song is saved—please try again.")).toBeVisible();
  });

  it("uses honest Turnstile failure copy", () => {
    expect(sessionStartErrorCopy(new TurnstileError("configuration", "missing"))).toBe(
      "This page isn't configured to start a song. Please try again later.",
    );
    expect(sessionStartErrorCopy(new TurnstileError("network", "offline"))).toContain(
      "security check",
    );
    expect(sessionStartErrorCopy(new TurnstileError("verification", "rejected"))).toBe(
      "We couldn't verify this request. Please try again.",
    );
    expect(sessionStartErrorCopy(new ApiError("invalid", 400, "TURNSTILE_INVALID"))).toBe(
      "We couldn't verify this request. Please try again.",
    );
    expect(sessionStartErrorCopy(new ApiError("offline", 503, "TURNSTILE_UNAVAILABLE"))).toContain(
      "temporarily unavailable",
    );
    expect(sessionStartErrorCopy(new ApiError("limited", 429, "WEB_SESSION_LIMIT_REACHED"))).toContain(
      "Too many song sessions",
    );
  });

  it("maps deliberate action limits to honest forward paths", () => {
    expect(
      actionErrorCopy(
        new ApiError("no credits", 402, "INSUFFICIENT_CREDITS"),
        "approve",
      ),
    ).toMatchObject({ destination: "offer" });
    expect(
      actionErrorCopy(
        new ApiError("preview limit", 429, "WEB_PREVIEW_LIMIT_REACHED"),
        "approve",
      ).message,
    ).toContain("free previews");
    expect(
      actionErrorCopy(
        new ApiError("checkout down", 503, "CHECKOUT_UNAVAILABLE"),
        "checkout",
      ).message,
    ).toContain("temporarily unavailable");
  });
});
