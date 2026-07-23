import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DimBrand, SiteFooter, SiteNav, SiteSignInForm } from "./SiteChrome";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("renders the dim-scene brand as plain text rather than a storefront link", () => {
    render(<DimBrand commerceFree />);

    expect(screen.getByText("Porizo")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Porizo home" })).not.toBeInTheDocument();
  });

  it("requests a safe Etsy return intent without putting the receipt in the request URL", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202 }),
    );
    render(
      <SiteSignInForm
        recoveryKind="etsy"
        recoverySessionId="123456"
      />,
    );
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const [, init] = fetcher.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ return_to: "etsy" });
    expect(fetcher.mock.calls[0][0]).toBe("/auth/magic/request");
  });

  it("persists a native Etsy unit before sending a cross-device sign-in link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202 }),
    );
    render(
      <SiteSignInForm
        recoveryKind="etsy_unit"
        recoverySessionId="etsy_unit_42"
      />,
    );
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );

    await vi.waitFor(() =>
      expect(localStorage.getItem("porizo.web-funnel.order-recovery.v1")).toContain(
        '"kind":"etsy_unit"',
      ),
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
