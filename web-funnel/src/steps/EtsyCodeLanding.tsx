import { useState } from "react";
import { landingStateForError, type EtsyLandingState } from "../api/etsy";
import { ApiError } from "../api/client";

type CheckResult = EtsyLandingState;
type Phase =
  | "code"
  | "checking"
  | "email"
  | "sending"
  | "sent"
  | Exclude<EtsyLandingState, "ready">;

export interface EtsyCodeLandingProps {
  checkCode: (code: string) => Promise<CheckResult>;
  requestClaim: (code: string, email: string) => Promise<void>;
}

const DEAD_ENDS: Record<
  Exclude<
    Phase,
    "code" | "checking" | "email" | "sending" | "sent"
  >,
  { heading: string; body: string }
> = {
  redeemed: {
    heading: "This code has already been used",
    body: "Sign in to the account that claimed it, or reply through your Etsy order messages and we'll help.",
  },
  void: {
    heading: "This code is no longer valid",
    body: "Reply through your Etsy order messages and we'll get you a working code.",
  },
  invalid: {
    heading: "We couldn't find that code",
    body: "Double-check the code from your Etsy order, or reply through your Etsy order messages.",
  },
  rate_limited: {
    heading: "Too many tries just now",
    body: "Wait up to one hour, then try again. Your paid order is safe.",
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
    body: "Try again shortly. Your paid order is safe.",
  },
  error: {
    heading: "Something went wrong",
    body: "Try again in a moment, or reply through your Etsy order messages.",
  },
};

export function EtsyCodeLanding({
  checkCode,
  requestClaim,
}: EtsyCodeLandingProps) {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("code");

  async function check() {
    setPhase("checking");
    try {
      const result = await checkCode(code);
      setPhase(result === "ready" ? "email" : result);
    } catch (error) {
      const failure = landingStateForError(error);
      setPhase(failure === "ready" ? "error" : failure);
    }
  }

  async function send() {
    setPhase("sending");
    try {
      await requestClaim(code, email);
      setPhase("sent");
    } catch (error) {
      if (error instanceof ApiError && error.code === "CODE_CLAIM_PENDING") {
        setPhase("sent");
        return;
      }
      const failure = landingStateForError(error);
      setPhase(failure === "ready" ? "error" : failure);
    }
  }

  const deadEnd =
    !["code", "checking", "email", "sending", "sent"].includes(phase)
      ? DEAD_ENDS[
          phase as Exclude<
            Phase,
            "code" | "checking" | "email" | "sending" | "sent"
          >
        ]
      : null;

  return (
    <main className="step step-centered etsy-landing">
      <span className="etsy-brand" aria-hidden="true">
        Porizo
      </span>
      <section className="card status-card" aria-live="polite">
        {phase === "code" && (
          <>
            <h1>Your song is paid for.</h1>
            <p>Enter the one-time code we sent through your Etsy order.</p>
            <label className="field-label" htmlFor="etsy-code">
              Redemption code
            </label>
            <input
              id="etsy-code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="PZ-XXXX-XXXX"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <button
              className="btn-primary"
              type="button"
              disabled={!code.trim()}
              onClick={() => void check()}
            >
              Continue
            </button>
          </>
        )}
        {(phase === "checking" || phase === "sending") && (
          <>
            <h1>{phase === "checking" ? "Checking your code…" : "Sending your secure link…"}</h1>
            <p>This only takes a moment.</p>
            <span className="status-orbit" role="status" aria-label="Loading" />
          </>
        )}
        {phase === "email" && (
          <>
            <h1>Protect your paid song.</h1>
            <p>
              Verify your email so the song stays with you if you change
              browser or device.
            </p>
            <label className="field-label" htmlFor="etsy-email">
              Email address
            </label>
            <input
              id="etsy-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button
              className="btn-primary"
              type="button"
              disabled={!email.trim()}
              onClick={() => void send()}
            >
              Email my secure link
            </button>
          </>
        )}
        {phase === "sent" && (
          <>
            <h1>Check your email.</h1>
            <p>
              Open the secure link on any device. Your code stays private and
              is redeemed only after you confirm the email.
            </p>
          </>
        )}
        {deadEnd && (
          <>
            <h1>{deadEnd.heading}</h1>
            <p>{deadEnd.body}</p>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => setPhase("code")}
            >
              Try another code
            </button>
          </>
        )}
      </section>
    </main>
  );
}
