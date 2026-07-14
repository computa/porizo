import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter, SiteNav } from "./SiteChrome";

describe("site chrome", () => {
  it("uses the real static-nav vocabulary with a quiet sign-in action", () => {
    render(<SiteNav />);

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toHaveClass(
      "nav",
      "nav--static",
    );
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/#how");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByText("Get the app")).not.toBeInTheDocument();
  });

  it("opens the canonical email sign-in surface", () => {
    render(<SiteNav />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("heading", { name: "Sign in with email" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeDisabled();
  });

  it("reuses the site footer on the entry state", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("contentinfo")).toHaveTextContent("Your moment, in a song.");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/legal/privacy");
  });
});
