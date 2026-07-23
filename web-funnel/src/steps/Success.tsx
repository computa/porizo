import { useEffect, useState, type ReactNode } from "react";
import { contentStatus, type OrderStatus } from "../api/funnel";
import { cssDurationMs } from "../motion";
import { SiteSignInForm } from "../components/SiteChrome";
import { DeliveryChooser } from "./DeliveryChooser";
import type { deliveryRequest, DeliveryChannelName } from "../delivery-state";

interface SuccessProps {
  order?: OrderStatus;
  elapsedMs: number;
  onStartAnother: () => void;
  needsSignIn?: boolean;
  orderReference?: string;
  orderReferenceKind?: "session" | "order" | "etsy_unit";
  timedOut?: boolean;
  onRetryOrder?: () => void;
  onCheckStatus?: () => void;
  onSaveDelivery?: (body: ReturnType<typeof deliveryRequest>) => Promise<void>;
  automatedDeliveryEnabled?: boolean;
  onStopDeliveryChannel?: (channel: DeliveryChannelName) => Promise<void>;
  onCancelGift?: () => Promise<void>;
  error?: string;
  commerceFree?: boolean;
  onDownloadMp3?: () => Promise<void>;
}

export function Success({
  order,
  elapsedMs,
  needsSignIn,
  orderReference,
  orderReferenceKind,
  timedOut,
  onRetryOrder,
  onCheckStatus,
  onStartAnother,
  onSaveDelivery,
  automatedDeliveryEnabled = false,
  onStopDeliveryChannel,
  onCancelGift,
  error,
  commerceFree = false,
  onDownloadMp3,
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
          <SiteSignInForm
            recoverySessionId={orderReference}
            recoveryKind={orderReferenceKind}
          />
          <SupportDetails orderReference={orderReference} />
          {!commerceFree && (
            <button
              className="btn-quiet success-reset"
              type="button"
              onClick={onStartAnother}
            >
              Make another song
            </button>
          )}
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

  const content = contentStatus(order);

  if (!order || content === "pending") {
    return (
      <StatusScreen
        title="Confirming your payment…"
        body={elapsedMs > 60000 ? "This is taking longer than usual. Your receipt is safe — support can help if it doesn't move." : "Keep this page open for a moment."}
        supportUrl={order?.support_url}
        orderReference={order?.order_reference ?? orderReference}
      />
    );
  }

  if (content === "paid" || content === "rendering") {
    return (
      <main className="step success-step">
        <StatusPanel
          title={`Finishing ${recipient}'s song…`}
          body={order.progress_copy ?? "We're making the complete version now. We'll email you when it's ready."}
        />
        {onSaveDelivery && onStopDeliveryChannel && (
          <DeliveryChooser
            recipient={recipient}
            delivery={order.delivery}
            deliveryStatus={order.delivery_status}
            contentReady={false}
            onSave={onSaveDelivery}
            onStopChannel={onStopDeliveryChannel}
            automatedDeliveryEnabled={automatedDeliveryEnabled}
          />
        )}
      </main>
    );
  }

  if (content === "failed") {
    return (
      <StatusScreen
        title="We couldn't finish the song."
        body="We're arranging your refund now. If it doesn't update, support can help — your details are saved."
        onStartAnother={commerceFree ? undefined : onStartAnother}
        supportUrl={order.support_url}
        orderReference={order.order_reference ?? orderReference}
      />
    );
  }

  if (content === "refunded") {
    return (
      <StatusScreen
        title="We couldn't finish the song."
        body="We've refunded you in full. Your details are saved if you'd like to try again."
        onStartAnother={commerceFree ? undefined : onStartAnother}
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
      <p className="hint">One gift credit was used. Your order details are saved here.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {onSaveDelivery && onStopDeliveryChannel && (
        <DeliveryChooser
          recipient={recipient}
          delivery={order.delivery}
          deliveryStatus={order.delivery_status}
          contentReady
          shareUrl={order.share_url}
          onSave={onSaveDelivery}
          onStopChannel={onStopDeliveryChannel}
          automatedDeliveryEnabled={automatedDeliveryEnabled}
        />
      )}
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
      {commerceFree && onDownloadMp3 && (
        <button
          className="btn-primary"
          type="button"
          onClick={() => void onDownloadMp3()}
        >
          Download MP3
        </button>
      )}
      <div className="share-chips" aria-label="Share the song">
        <a className="chip" href={`sms:&body=${encodeURIComponent(shareText)}`}>Send in Messages</a>
        <a className="chip" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}>WhatsApp</a>
        {"share" in navigator && (
          <button
            className="chip"
            type="button"
            onClick={() => void navigator.share({ text: shareText, url: link })}
          >
            Share
          </button>
        )}
      </div>
      <section className="reaction-nudge">
        <h2>The best part is watching their face.</h2>
        <p>Play it in person if you can — and film it. Reactions like theirs are why this exists.</p>
      </section>
      {!commerceFree && (
        <p className="account-note">Your songs live in your Porizo account. Sign in with the same email whenever you need them.</p>
      )}
      {onCheckStatus && (
        <button className="btn-quiet" type="button" onClick={onCheckStatus}>
          Check delivery status
        </button>
      )}
      {order.can_cancel_gift && onCancelGift && (
        <button
          className="btn-quiet destructive-action"
          type="button"
          onClick={() => {
            if (
              confirm(
                "Cancel this gift and return one gift credit? The gift link will stop working. This is different from stopping an unsent message.",
              )
            ) {
              void onCancelGift();
            }
          }}
        >
          Cancel gift and return credit
        </button>
      )}
      {!commerceFree && (
        <button className="btn-quiet success-reset" type="button" onClick={onStartAnother}>
          Make another song
        </button>
      )}
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
      <StatusPanel title={title} body={body}>
        <SupportDetails supportUrl={supportUrl} orderReference={orderReference} />
        {onStartAnother && (
          <button className="btn-quiet success-reset" type="button" onClick={onStartAnother}>
            Make another song
          </button>
        )}
      </StatusPanel>
    </main>
  );
}

function StatusPanel({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <section className="status-card" aria-live="polite">
      <div className="status-orbit" aria-hidden="true" />
      <h1>{title}</h1>
      <p>{body}</p>
      {children}
    </section>
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
