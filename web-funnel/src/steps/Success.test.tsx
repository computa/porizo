import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Success } from "./Success";

describe("paid-order lifecycle", () => {
  it("shows delayed confirmation support copy after one minute", () => {
    render(<Success elapsedMs={61000} />);

    expect(screen.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible();
    expect(screen.getByText(/support can help/)).toBeVisible();
  });

  it("shows server progress while the full song renders", () => {
    render(
      <Success
        elapsedMs={0}
        order={{ status: "rendering", recipient_name: "Sarah", progress_copy: "Verse 2 of 3" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Finishing Sarah's song…" })).toBeVisible();
    expect(screen.getByText("Verse 2 of 3")).toBeVisible();
  });

  it("is honest about a refunded render failure", () => {
    render(<Success elapsedMs={0} order={{ status: "refunded", recipient_name: "Sarah" }} />);

    expect(screen.getByRole("heading", { name: "We couldn't finish the song." })).toBeVisible();
    expect(screen.getByText(/refunded you in full/)).toBeVisible();
  });

  it("does not claim a refund completed while it is still processing", () => {
    render(<Success elapsedMs={0} order={{ status: "failed", recipient_name: "Sarah" }} />);

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
});
