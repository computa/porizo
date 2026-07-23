import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { EtsyCodeLanding } from "./EtsyCodeLanding";

describe("EtsyCodeLanding", () => {
  it("does not redeem or send anything on mount", () => {
    const checkCode = vi.fn();
    const requestClaim = vi.fn();
    render(
      <EtsyCodeLanding
        checkCode={checkCode}
        requestClaim={requestClaim}
      />,
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(checkCode).not.toHaveBeenCalled();
    expect(requestClaim).not.toHaveBeenCalled();
  });

  it("verifies the code, then emails an account-bound claim", async () => {
    const checkCode = vi.fn(async () => "ready" as const);
    const requestClaim = vi.fn(async () => undefined);
    render(
      <EtsyCodeLanding
        checkCode={checkCode}
        requestClaim={requestClaim}
      />,
    );
    fireEvent.change(screen.getByLabelText("Redemption code"), {
      target: { value: "pz-abcd-2345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText(/protect your paid song/i),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /email my secure link/i }),
    );

    await waitFor(() =>
      expect(requestClaim).toHaveBeenCalledWith(
        "PZ-ABCD-2345",
        "buyer@example.com",
      ),
    );
    expect(await screen.findByText(/open the secure link/i)).toBeVisible();
  });

  it("shows distinct invalid and already-used states without sending email", async () => {
    const requestClaim = vi.fn();
    render(
      <EtsyCodeLanding
        checkCode={vi.fn(async () => "invalid" as const)}
        requestClaim={requestClaim}
      />,
    );
    fireEvent.change(screen.getByLabelText("Redemption code"), {
      target: { value: "PZ-XXXX-XXXX" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/couldn't find that code/i)).toBeVisible();
    expect(requestClaim).not.toHaveBeenCalled();
  });

  it("explains when a code was already used", async () => {
    render(
      <EtsyCodeLanding
        checkCode={vi.fn(async () => "redeemed" as const)}
        requestClaim={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Redemption code"), {
      target: { value: "PZ-USED-2345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/already been used/i)).toBeVisible();
  });

  it("preserves rate-limit state from the initial code check", async () => {
    render(
      <EtsyCodeLanding
        checkCode={vi.fn(async () => "rate_limited" as const)}
        requestClaim={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Redemption code"), {
      target: { value: "PZ-RATE-2345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/too many tries/i)).toBeVisible();
  });

  it("preserves a rejected pre-check's error taxonomy", async () => {
    render(
      <EtsyCodeLanding
        checkCode={vi.fn(async () => {
          throw new ApiError(
            "Slow down",
            429,
            "ETSY_CODE_CHECK_LIMIT_REACHED",
          );
        })}
        requestClaim={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Redemption code"), {
      target: { value: "PZ-RATE-2345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/too many tries/i)).toBeVisible();
  });

  it("treats a retry of an already-pending claim as check-your-email", async () => {
    render(
      <EtsyCodeLanding
        checkCode={vi.fn(async () => "ready" as const)}
        requestClaim={vi.fn(async () => {
          throw new ApiError(
            "Already sent",
            409,
            "CODE_CLAIM_PENDING",
          );
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText("Redemption code"), {
      target: { value: "PZ-WAIT-2345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/protect your paid song/i);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /email my secure link/i }),
    );
    expect(await screen.findByText(/open the secure link/i)).toBeVisible();
  });
});
