import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Offer } from "./Offer";

describe("offer", () => {
  it("renders the localized API price in both price and CTA", () => {
    render(
      <Offer
        recipient="Sarah"
        product={{ price_key: "gift", localized_price: "€17,42" }}
        loading={false}
        onCheckout={vi.fn()}
      />,
    );
    expect(screen.getByText("€17,42")).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock for €17,42" })).toBeEnabled();
  });
});
