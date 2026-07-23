import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { EtsyLanding } from "./EtsyLanding";

const navigate = vi.fn();
const createSession = vi.fn(async () => "guest-jwt");

function deps(overrides: Partial<Parameters<typeof EtsyLanding>[0]> = {}) {
  return {
    code: "PZ-ABCD-2345",
    checkCode: vi.fn(),
    redeem: vi.fn(),
    createSession,
    navigate,
    ...overrides,
  };
}

beforeEach(() => {
  navigate.mockClear();
  createSession.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("EtsyLanding", () => {
  it("redeems a valid code and hands the buyer off to /create", async () => {
    const checkCode = vi.fn(async () => "ready" as const);
    const redeem = vi.fn(async () => ({
      state: "ready" as const,
      balanceAfter: 1,
    }));
    render(<EtsyLanding {...deps({ checkCode, redeem })} />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/create"));
    expect(createSession).toHaveBeenCalledOnce();
    expect(redeem).toHaveBeenCalledWith("PZ-ABCD-2345");
  });

  it("tells the buyer the song is paid for while it works", async () => {
    const checkCode = vi.fn(() => new Promise<"ready">(() => {}));
    render(<EtsyLanding {...deps({ checkCode })} />);

    expect(await screen.findByText(/paid for/i)).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows a warm, human message for an already-used code and never a stack trace", async () => {
    const checkCode = vi.fn(async () => "redeemed" as const);
    render(<EtsyLanding {...deps({ checkCode })} />);

    expect(await screen.findByText(/already been used/i)).toBeVisible();
    expect(screen.getByText(/Etsy order messages/i)).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows a warm message for an unrecognised code", async () => {
    const checkCode = vi.fn(async () => "invalid" as const);
    render(<EtsyLanding {...deps({ checkCode, code: "NOT-A-CODE" })} />);

    expect(await screen.findByText(/couldn.t find that code/i)).toBeVisible();
  });

  it("shows a warm message for a voided code", async () => {
    const checkCode = vi.fn(async () => "void" as const);
    render(<EtsyLanding {...deps({ checkCode })} />);

    expect(await screen.findByText(/no longer valid/i)).toBeVisible();
  });

  it("shows a try-again message when redemption is rate-limited", async () => {
    const checkCode = vi.fn(async () => "ready" as const);
    const redeem = vi.fn(async () => ({ state: "rate_limited" as const }));
    render(<EtsyLanding {...deps({ checkCode, redeem })} />);

    expect(await screen.findByText(/too many/i)).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows a temporarily-unavailable message when the funnel is disabled", async () => {
    const checkCode = vi.fn(async () => "ready" as const);
    const redeem = vi.fn(async () => ({ state: "unavailable" as const }));
    render(<EtsyLanding {...deps({ checkCode, redeem })} />);

    expect(await screen.findByText(/temporarily unavailable/i)).toBeVisible();
  });

  it("recovers when session creation fails, without leaking the error", async () => {
    const checkCode = vi.fn(async () => "ready" as const);
    const redeem = vi.fn(async () => ({
      state: "ready" as const,
      balanceAfter: 1,
    }));
    createSession.mockRejectedValueOnce(
      new ApiError("nope", 503, "TURNSTILE_UNAVAILABLE"),
    );
    render(<EtsyLanding {...deps({ checkCode, redeem })} />);

    expect(await screen.findByText(/couldn.t/i)).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows a warm message when there is no code in the URL at all", async () => {
    const checkCode = vi.fn();
    render(<EtsyLanding {...deps({ code: "", checkCode })} />);

    expect(await screen.findByText(/couldn.t find that code/i)).toBeVisible();
    expect(checkCode).not.toHaveBeenCalled();
  });

  it("never shows a price, buy-another, or storefront navigation", async () => {
    const checkCode = vi.fn(async () => "redeemed" as const);
    const { container } = render(<EtsyLanding {...deps({ checkCode })} />);
    await screen.findByText(/already been used/i);

    expect(container.textContent).not.toMatch(
      /\$|price|buy another|checkout|£|€/i,
    );
    // The wordmark must not be a storefront link.
    expect(container.querySelector('a[href="/"]')).toBeNull();
    expect(container.querySelectorAll("a").length).toBe(0);
  });
});
