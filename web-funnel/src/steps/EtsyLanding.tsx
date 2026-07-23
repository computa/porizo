import { useState } from "react";
import {
  landingStateForError,
  type EtsyLandingState,
  type EtsyOrderClaim,
} from "../api/etsy";
import { ApiError } from "../api/client";
import { SiteSignInForm } from "../components/SiteChrome";
import {
  clearPendingEtsyReceipt,
  readPendingEtsyReceipt,
} from "../etsy-fulfilment";

export interface EtsyLandingProps {
  checkReceipt: (receiptId: string) => Promise<EtsyLandingState>;
  claim: (receiptId: string) => Promise<EtsyOrderClaim>;
  createSession: () => Promise<string>;
  navigate: () => void;
}

type Phase = "entry" | "working" | "sign_in" | EtsyLandingState;

const DEAD_ENDS: Record<
  Exclude<Phase, "entry" | "working" | "ready" | "sign_in">,
  { heading: string; body: string }
> = {
  redeemed: {
    heading: "This order is already claimed",
    body: "This receipt belongs to another account. Reply through your Etsy order messages if you need help.",
  },
  void: {
    heading: "This order was cancelled",
    body: "Reply through your Etsy order messages if you need help.",
  },
  invalid: {
    heading: "We couldn't match that receipt",
    body: "Check the receipt number in Etsy, or reply through your Etsy order messages.",
  },
  rate_limited: {
    heading: "Too many attempts",
    body: "Please wait up to one hour before trying again. Your paid order is safe.",
  },
  configuration: {
    heading: "This page isn't ready",
    body: "Etsy fulfilment is not configured right now. Your paid order is safe.",
  },
  network: {
    heading: "We couldn't connect",
    body: "Check your connection and try again. Your paid order is safe.",
  },
  unavailable: {
    heading: "We're temporarily unavailable",
    body: "Your Etsy order is safe. Try again shortly.",
  },
  error: {
    heading: "Something went wrong",
    body: "We couldn't claim your Etsy order just now. Try again shortly.",
  },
};

export function EtsyLanding({
  checkReceipt,
  claim,
  createSession,
  navigate,
}: EtsyLandingProps) {
  const [receiptId, setReceiptId] = useState(readPendingEtsyReceipt);
  const [phase, setPhase] = useState<Phase>("entry");
  const [retryCopy, setRetryCopy] = useState<string>();

  async function continueClaim() {
    const normalized = receiptId.trim();
    if (!normalized) return;
    setPhase("working");
    const check = await checkReceipt(normalized);
    if (check !== "ready") {
      setPhase(check);
      return;
    }
    try {
      await createSession();
      const result = await claim(normalized);
      if (result.claimed) {
        clearPendingEtsyReceipt();
        navigate();
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401) {
        setPhase("sign_in");
        return;
      }
      if (error instanceof ApiError && error.status === 429) {
        const seconds = error.retryAfterSeconds;
        const when = error.retryAt ? new Date(error.retryAt) : undefined;
        setRetryCopy(
          seconds
            ? `Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute${seconds > 60 ? "s" : ""}. Your paid order is safe.`
            : when && Number.isFinite(when.getTime())
              ? `Try again after ${when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Your paid order is safe.`
              : undefined,
        );
      }
      setPhase(landingStateForError(error));
    }
  }

  return (
    <main className="step step-centered etsy-landing">
      <span className="etsy-brand" aria-hidden="true">
        Porizo
      </span>
      <section className="card status-card" aria-live="polite">
        {phase === "entry" && (
          <>
            <h1>Your song is paid for.</h1>
            <p>Enter the receipt number from your Etsy order.</p>
            <label className="field-label" htmlFor="etsy-receipt">
              Etsy receipt number
            </label>
            <input
              id="etsy-receipt"
              inputMode="numeric"
              autoComplete="off"
              value={receiptId}
              onChange={(event) =>
                setReceiptId(event.target.value.replace(/\D/g, ""))
              }
            />
            <button
              className="btn-primary"
              type="button"
              disabled={!receiptId.trim()}
              onClick={() => void continueClaim()}
            >
              Continue to your song
            </button>
          </>
        )}
        {phase === "working" && (
          <>
            <h1>Checking your Etsy order…</h1>
            <p>This only takes a moment.</p>
            <span className="status-orbit" role="status" aria-label="Loading" />
          </>
        )}
        {phase === "sign_in" && (
          <>
            <h1>Check your email to continue.</h1>
            <p>
              Sign in with the email on your Etsy receipt. This protects your
              paid song on every device.
            </p>
            <SiteSignInForm recoverySessionId={receiptId} recoveryKind="etsy" />
          </>
        )}
        {!["entry", "working", "sign_in", "ready"].includes(phase) && (
          <>
            <h1>{DEAD_ENDS[phase as keyof typeof DEAD_ENDS].heading}</h1>
            <p>
              {phase === "rate_limited" && retryCopy
                ? retryCopy
                : DEAD_ENDS[phase as keyof typeof DEAD_ENDS].body}
            </p>
            {(phase === "invalid" || phase === "redeemed") && (
              <button
                className="btn-secondary"
                type="button"
                onClick={() => setPhase("sign_in")}
              >
                Use another account
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
