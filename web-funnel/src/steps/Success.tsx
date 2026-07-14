import { useEffect, useState } from "react";
import type { OrderStatus } from "../api/funnel";
import { cssDurationMs } from "../motion";

interface SuccessProps {
  order?: OrderStatus;
  elapsedMs: number;
}

export function Success({ order, elapsedMs }: SuccessProps) {
  const [copied, setCopied] = useState(false);
  const recipient = order?.recipient_name ?? "Your";

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(
      () => setCopied(false),
      cssDurationMs("--t-copy-feedback"),
    );
    return () => clearTimeout(timer);
  }, [copied]);

  if (!order || order.status === "pending") {
    return (
      <StatusScreen
        title="Confirming your payment…"
        body={elapsedMs > 60000 ? "This is taking longer than usual. Your receipt is safe — support can help if it doesn't move." : "Keep this page open for a moment."}
      />
    );
  }

  if (order.status === "paid" || order.status === "rendering") {
    return (
      <StatusScreen
        title={`Finishing ${recipient}'s song…`}
        body={order.progress_copy ?? "We're making the complete version now. We'll email you when it's ready."}
      />
    );
  }

  if (order.status === "failed") {
    return (
      <StatusScreen
        title="We couldn't finish the song."
        body="We're arranging your refund now. If it doesn't update, support can help — your details are saved."
      />
    );
  }

  if (order.status === "refunded") {
    return (
      <StatusScreen
        title="We couldn't finish the song."
        body="We've refunded you in full. Your details are saved if you'd like to try again."
      />
    );
  }

  const link = order.share_url ?? "";
  const shareText = `I made you something. Press play when you're somewhere quiet 🧡 ${link}`;
  return (
    <main className="step success-step">
      <p className="success-mark" aria-hidden="true">✓</p>
      <h1 className="q">{order?.recipient_name ? `${recipient}'s song is ready.` : "Your song is ready."}</h1>
      <p className="hint">Sent to your email too, with your receipt.</p>
      <section className="card link-card">
        <p className="eyebrow">Their gift link</p>
        <p className="share-link">{link}</p>
        <button
          className="btn-primary"
          type="button"
          aria-live="polite"
          onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </section>
      <div className="share-chips" aria-label="Share the song">
        <a className="chip" href={`sms:&body=${encodeURIComponent(shareText)}`}>Send in Messages</a>
        <a className="chip" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}>WhatsApp</a>
      </div>
      <section className="reaction-nudge">
        <h2>The best part is watching their face.</h2>
        <p>Play it in person if you can — and film it. Reactions like theirs are why this exists.</p>
      </section>
      <p className="account-note">Your songs live in your Porizo account — we emailed a sign-in link.</p>
    </main>
  );
}

function StatusScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="step step-centered">
      <section className="status-card" aria-live="polite">
        <div className="status-orbit" aria-hidden="true" />
        <h1>{title}</h1>
        <p>{body}</p>
      </section>
    </main>
  );
}
