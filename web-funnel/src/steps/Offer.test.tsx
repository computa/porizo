import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Offer } from "./Offer";

describe("offer", () => {
  it("renders the localized API price in both price and CTA", () => {
    render(
      <Offer
        recipient="Sarah"
        products={[
          { price_key: "gift", localized_price: "€17,42", token_count: 1 },
        ]}
        loading={false}
        onSelectProduct={vi.fn()}
        onCheckout={vi.fn()}
        onUseCredit={vi.fn()}
      />,
    );
    expect(screen.getByText("€17,42")).toBeVisible();
    const cta = screen.getByRole("button", { name: "Unlock for €17,42" });
    expect(cta).toBeEnabled();
    expect(cta.closest(".cta-bar")).not.toBeNull();
  });

  it("uses a fungible wallet credit without showing Stripe checkout copy", () => {
    const useCredit = vi.fn();
    render(
      <Offer
        recipient="Sarah"
        products={[
          { price_key: "bundle", localized_price: "$39.99", token_count: 3 },
        ]}
        walletBalance={2}
        loading={false}
        onSelectProduct={vi.fn()}
        onCheckout={vi.fn()}
        onUseCredit={useCredit}
      />,
    );

    expect(
      screen.getByText("2 gift credits available in Porizo"),
    ).toBeVisible();
    screen.getByRole("button", { name: "Use 1 gift credit" }).click();
    expect(useCredit).toHaveBeenCalledOnce();
  });

  it("spends an Etsy-redeemed credit with no price shown anywhere on the path", () => {
    const useCredit = vi.fn();
    const { container } = render(
      <Offer
        recipient="Sarah"
        products={[]}
        walletBalance={1}
        loading={false}
        onSelectProduct={vi.fn()}
        onCheckout={vi.fn()}
        onUseCredit={useCredit}
      />,
    );

    expect(screen.getByText("1 gift credit available in Porizo")).toBeVisible();
    // Pure fulfilment: the Etsy buyer already paid — the credit path must not
    // surface a currency price or Stripe checkout copy.
    expect(container.textContent).not.toMatch(/\$|£|€|Stripe/i);
    const cta = screen.getByRole("button", { name: "Use 1 gift credit" });
    cta.click();
    expect(useCredit).toHaveBeenCalledOnce();
  });

  it("requires an explicit bundle choice when several products are returned", () => {
    render(
      <Offer
        recipient="Sarah"
        products={[
          { price_key: "one", localized_price: "$19.99", token_count: 1 },
          { price_key: "three", localized_price: "$39.99", token_count: 3 },
        ]}
        loading={false}
        onSelectProduct={vi.fn()}
        onCheckout={vi.fn()}
        onUseCredit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Loading price…" }),
    ).toBeDisabled();
    expect(screen.getByText("3 gift credits · $39.99")).toBeVisible();
  });

  it("never falls back to Stripe when an Etsy credit is temporarily unavailable", () => {
    const { container } = render(
      <Offer
        recipient="Sarah"
        products={[
          { price_key: "gift", localized_price: "$19.99", token_count: 1 },
        ]}
        commerceFree
        walletBalance={0}
        loading={false}
        onSelectProduct={vi.fn()}
        onCheckout={vi.fn()}
        onUseCredit={vi.fn()}
      />,
    );
    expect(screen.getByText(/paid Etsy gift credit/i)).toBeVisible();
    expect(container.textContent).not.toMatch(/\$|Stripe|secure checkout/i);
    expect(
      screen.getByRole("link", { name: "Contact support" }),
    ).toHaveAttribute("href", "/support");
  });
});
