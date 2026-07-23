import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Success } from "./Success";

describe("paid-order lifecycle", () => {
  it("shows delayed confirmation support copy after one minute", () => {
    render(<Success elapsedMs={61000} onStartAnother={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible();
    expect(screen.getByText(/support can help/)).toBeVisible();
  });

  it("stops the spinner and offers same-browser sign-in after a 401", () => {
    render(
      <Success
        elapsedMs={0}
        needsSignIn
        orderReference="cs_paid_phone"
        onStartAnother={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Your payment is safe." })).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(screen.getByText(/Reference cs_paid_phone/)).toBeVisible();
    expect(screen.queryByText("Confirming your payment…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make another song" })).toBeVisible();
  });

  it("replaces an exhausted poll loop with recovery actions", () => {
    const retry = vi.fn();
    render(
      <Success
        elapsedMs={120_000}
        timedOut
        orderReference="cs_slow"
        onRetryOrder={retry}
        onStartAnother={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "This is taking longer than expected.",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Confirming your payment…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps the checkout reference across the email sign-in redirect", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    render(
      <Success
        elapsedMs={0}
        needsSignIn
        orderReference="cs_paid_phone"
        onStartAnother={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );

    await screen.findByRole("heading", { name: "Check your email" });
    await waitFor(() =>
      expect(localStorage.getItem("porizo.web-funnel.order-recovery.v1")).toContain(
        "cs_paid_phone",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/magic/request",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows server progress while the full song renders", () => {
    render(
      <Success
        elapsedMs={0}
        onStartAnother={vi.fn()}
        order={{ status: "rendering", recipient_name: "Sarah", progress_copy: "Verse 2 of 3" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Finishing Sarah's song…" })).toBeVisible();
    expect(screen.getByText("Verse 2 of 3")).toBeVisible();
  });

  it("is honest about a refunded render failure", () => {
    render(<Success elapsedMs={0} order={{ status: "refunded", recipient_name: "Sarah" }} onStartAnother={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "We couldn't finish the song." })).toBeVisible();
    expect(screen.getByText(/refunded you in full/)).toBeVisible();
  });

  it("does not claim a refund completed while it is still processing", () => {
    render(<Success elapsedMs={0} order={{ status: "failed", recipient_name: "Sarah" }} onStartAnother={vi.fn()} />);

    expect(screen.getByText(/arranging your refund now/)).toBeVisible();
    expect(screen.queryByText(/refunded you in full/)).not.toBeInTheDocument();
  });

  it("builds encoded share intents and announces copy feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const shareUrl = "https://porizo.co/play/w8kq2m";
    render(
      <Success
        elapsedMs={0}
        onStartAnother={vi.fn()}
        order={{ status: "delivered", recipient_name: "Sarah", share_url: shareUrl }}
      />,
    );

    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent(shareUrl)),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(shareUrl);
    expect(await screen.findByRole("button", { name: "Copied ✓" })).toBeVisible();
  });

  it("exposes the paid MP3 and removes alternate commerce in Etsy mode", () => {
    const download = vi.fn(async () => {});
    render(
      <Success
        elapsedMs={0}
        commerceFree
        onDownloadMp3={download}
        onStartAnother={vi.fn()}
        order={{
          status: "delivered",
          recipient_name: "Sarah",
          share_url: "https://porizo.co/play/etsy",
          track_version_id: "version_etsy",
        }}
      />,
    );
    screen.getByRole("button", { name: "Download MP3" }).click();
    expect(download).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Make another song" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it("does not call a wallet-funded gift a paid receipt", () => {
    render(
      <Success
        elapsedMs={0}
        onStartAnother={vi.fn()}
        order={{
          status: "delivered",
          payment_source: "gift_wallet",
          share_url: "https://porizo.co/play/wallet",
        }}
      />,
    );

    expect(screen.getByText(/One gift credit was used/)).toBeVisible();
    expect(screen.queryByText(/with your receipt/)).not.toBeInTheDocument();
  });

  it("uses the same fungible-credit confirmation for Stripe-funded gifts", () => {
    render(
      <Success
        elapsedMs={0}
        onStartAnother={vi.fn()}
        order={{
          status: "delivered",
          payment_source: "stripe",
          share_url: "https://porizo.co/play/stripe",
        }}
      />,
    );

    expect(screen.getByText(/One gift credit was used/)).toBeVisible();
    expect(screen.queryByText(/sent to your email/i)).not.toBeInTheDocument();
  });

  it("offers a manual delivery-status refresh", () => {
    const check = vi.fn();
    render(
      <Success
        elapsedMs={0}
        onStartAnother={vi.fn()}
        onCheckStatus={check}
        order={{ status: "delivered", share_url: "https://porizo.co/play/status" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Check delivery status" }));
    expect(check).toHaveBeenCalledOnce();
  });

  it("starts another song from below the delivered share content", () => {
    const onStartAnother = vi.fn();
    render(
      <Success
        elapsedMs={0}
        order={{ status: "delivered", recipient_name: "Sarah", share_url: "https://porizo.co/play/w8kq2m" }}
        onStartAnother={onStartAnother}
      />,
    );

    const button = screen.getByRole("button", { name: "Make another song" });
    expect(screen.getByText(/Your songs live/).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(onStartAnother).toHaveBeenCalledOnce();
  });

  it.each(["failed", "refunded"] as const)("lets a %s order start another song", (status) => {
    const onStartAnother = vi.fn();
    render(
      <Success
        elapsedMs={0}
        order={{ status, recipient_name: "Sarah" }}
        onStartAnother={onStartAnother}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Make another song" }));
    expect(onStartAnother).toHaveBeenCalledOnce();
  });

  it.each(["failed", "refunded"] as const)(
    "removes make-another commerce from a %s Etsy order",
    (status) => {
      render(
        <Success
          elapsedMs={0}
          order={{ status, recipient_name: "Sarah" }}
          onStartAnother={vi.fn()}
          commerceFree
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Make another song" }),
      ).not.toBeInTheDocument();
    },
  );
});
