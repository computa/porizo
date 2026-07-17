import { useEffect, useState } from "react";
import type { OrderStatus } from "../api/funnel";
import { cssDurationMs } from "../motion";
import { SiteSignInForm } from "../components/SiteChrome";

interface SuccessProps {
  order?: OrderStatus;
  elapsedMs: number;
  onStartAnother: () => void;
  needsSignIn?: boolean;
  orderReference?: string;
  timedOut?: boolean;
  onRetryOrder?: () => void;
}

export function Success({
  order,
  elapsedMs,
  needsSignIn,
  orderReference,
  timedOut,
  onRetryOrder,
  onStartAnother,
}: SuccessProps) {
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

  if (needsSignIn) {
    return (
      <main className="step step-centered">
        <section className="status-card" aria-live="polite">
          <h1>Your payment is safe.</h1>
          <p>Sign in with the email on your receipt to find this song on this device.</p>
          <SiteSignInForm recoverySessionId={orderReference} />
          <SupportDetails orderReference={orderReference} />
          <button
            className="btn-quiet success-reset"
            type="button"
            onClick={onStartAnother}
          >
            Make another song
          </button>
        </section>
      </main>
    );
  }

  if (timedOut) {
    return (
      <main className="step step-centered">
        <section className="status-card" aria-live="polite">
          <h1>This is taking longer than expected.</h1>
          <p>Your payment and song details are safe. Check again, or contact support with the reference below.</p>
          <SupportDetails
            supportUrl={order?.support_url}
            orderReference={order?.order_reference ?? orderReference}
          />
          {onRetryOrder && (
            <button className="btn-primary" type="button" onClick={onRetryOrder}>
              Check again
            </button>
          )}
        </section>
      </main>
    );
  }

  if (!order || order.status === "pending") {
    return (
      <StatusScreen
        title="Confirming your payment…"
        body={elapsedMs > 60000 ? "This is taking longer than usual. Your receipt is safe — support can help if it doesn't move." : "Keep this page open for a moment."}
        supportUrl={order?.support_url}
        orderReference={order?.order_reference ?? orderReference}
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
        onStartAnother={onStartAnother}
        supportUrl={order.support_url}
        orderReference={order.order_reference ?? orderReference}
      />
    );
  }

  if (order.status === "refunded") {
    return (
      <StatusScreen
        title="We couldn't finish the song."
        body="We've refunded you in full. Your details are saved if you'd like to try again."
        onStartAnother={onStartAnother}
        supportUrl={order.support_url}
        orderReference={order.order_reference ?? orderReference}
      />
    );
  }

  const link = order.share_url ?? "";
  const shareText = `I made you something. Press play when you're somewhere quiet 🧡 ${link}`;
  return (
    <main className="step success-step">
      <p className="success-mark" aria-hidden="true">✓</p>
      <h1 className="q">{order.recipient_name ? `${recipient}'s song is ready.` : "Your song is ready."}</h1>
      <p className="hint">Sent to your email too, with your receipt.</p>
      <section className="card link-card">
        <p className="context-label">Their gift link</p>
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
      <button className="btn-quiet success-reset" type="button" onClick={onStartAnother}>
        Make another song
      </button>
    </main>
  );
}

function StatusScreen({
  title,
  body,
  onStartAnother,
  supportUrl,
  orderReference,
}: {
  title: string;
  body: string;
  onStartAnother?: () => void;
  supportUrl?: string;
  orderReference?: string;
}) {
  return (
    <main className="step step-centered">
      <section className="status-card" aria-live="polite">
        <div className="status-orbit" aria-hidden="true" />
        <h1>{title}</h1>
        <p>{body}</p>
        <SupportDetails supportUrl={supportUrl} orderReference={orderReference} />
        {onStartAnother && (
          <button className="btn-quiet success-reset" type="button" onClick={onStartAnother}>
            Make another song
          </button>
        )}
      </section>
    </main>
  );
}

function SupportDetails({
  supportUrl = "/support",
  orderReference,
}: {
  supportUrl?: string;
  orderReference?: string;
}) {
  return (
    <p className="support-details">
      <a href={supportUrl}>Contact support</a>
      {orderReference ? <> · Reference {orderReference}</> : null}
    </p>
  );
}
