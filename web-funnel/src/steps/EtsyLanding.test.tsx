import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { EtsyLanding } from "./EtsyLanding";

function deps(
  overrides: Partial<Parameters<typeof EtsyLanding>[0]> = {},
): Parameters<typeof EtsyLanding>[0] {
  return {
    checkReceipt: vi.fn(async () => "ready" as const),
    claim: vi.fn(async () => ({
      claimed: true as const,
      order_reference: "etsy_order_1",
      unit_ids: ["unit_1"],
      wallet_balance: 1,
      commerce_free: true as const,
    })),
    createSession: vi.fn(async () => "token"),
    navigate: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("EtsyLanding", () => {
  it("never consumes an entitlement on mount and requires an explicit action", () => {
    const claim = vi.fn();
    render(<EtsyLanding {...deps({ claim })} />);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("claims a receipt only after the buyer submits it", async () => {
    const claim = vi.fn(async () => ({
      claimed: true as const,
      order_reference: "etsy_order_1",
      unit_ids: ["unit_1", "unit_2"],
      wallet_balance: 2,
      commerce_free: true as const,
    }));
    const navigate = vi.fn();
    render(<EtsyLanding {...deps({ claim, navigate })} />);
    fireEvent.change(screen.getByLabelText(/receipt number/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(claim).toHaveBeenCalledWith("123456"));
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("shows verified-email recovery rather than burning the order into a guest", async () => {
    render(
      <EtsyLanding
        {...deps({
          claim: vi.fn(async () => {
            throw new ApiError("verified email required", 401);
          }),
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText(/receipt number/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByText(/sign in with the email on your Etsy receipt/i),
    ).toBeVisible();
  });

  it("maps claim limits and displays the server retry interval", async () => {
    render(
      <EtsyLanding
        {...deps({
          claim: vi.fn(async () => {
            throw new ApiError(
              "too many attempts",
              429,
              "ETSY_REDEEM_LIMIT_REACHED",
              120,
            );
          }),
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText(/receipt number/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/try again in 2 minutes/i)).toBeVisible();
  });

  it("offers an explicit account switch after a mismatched claim", async () => {
    render(
      <EtsyLanding
        {...deps({
          claim: vi.fn(async () => {
            throw new ApiError(
              "This order belongs to another account.",
              409,
              "ETSY_ORDER_ALREADY_CLAIMED",
            );
          }),
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText(/receipt number/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /use another account/i }),
    );

    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(
      screen.getByText(/email on your Etsy receipt/i),
    ).toBeVisible();
  });

  it("maps initial configuration and rate failures to honest states", async () => {
    const { rerender } = render(
      <EtsyLanding
        {...deps({ checkReceipt: vi.fn(async () => "unavailable" as const) })}
      />,
    );
    fireEvent.change(screen.getByLabelText(/receipt number/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/temporarily unavailable/i)).toBeVisible();

    rerender(
      <EtsyLanding
        {...deps({ checkReceipt: vi.fn(async () => "rate_limited" as const) })}
      />,
    );
  });
});
