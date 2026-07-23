import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter, SiteNav } from "./SiteChrome";

describe("site chrome", () => {
  it("uses the real static-nav vocabulary with a quiet sign-in action", () => {
    render(<SiteNav />);

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toHaveClass("nav", "nav--static");
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "/#how",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByText("Get the app")).not.toBeInTheDocument();
  });

  it("opens the canonical email sign-in surface", () => {
    render(<SiteNav />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      screen.getByRole("heading", { name: "Sign in with email" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeDisabled();
  });

  it("reuses the site footer on the entry state", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("contentinfo")).toHaveTextContent(
      "Your moment, in a song.",
    );
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
  });
});

describe("commerce-free chrome (etsy fulfilment)", () => {
  it("keeps the Porizo wordmark but drops every commerce/nav affordance from the nav", () => {
    const { container } = render(<SiteNav commerceFree />);

    expect(screen.getByText("Porizo")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sign in" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Pricing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "How it works" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Blog" }),
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /pricing|sign in|how it works|blog/i,
    );
  });

  it("keeps the Porizo wordmark but drops every commerce link from the footer", () => {
    const { container } = render(<SiteFooter commerceFree />);

    expect(screen.getByText("Porizo")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Pricing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Download" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "All gift ideas" }),
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pricing|download|gift ideas/i);
  });
});
