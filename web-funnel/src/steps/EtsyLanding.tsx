import { useEffect, useState } from "react";
import type { EtsyLandingState, EtsyRedeemOutcome } from "../api/etsy";

// The buyer already paid on Etsy. This surface's only job is to validate the
// code, establish a guest session, redeem the gift credit, and hand off to the
// existing /create quiz. It is a PURE FULFILMENT surface (plan §1): no pricing,
// no "buy another", no storefront nav, no upsell, no signup wall, no QR. Every
// non-ready outcome is a warm, human dead end — this is a paying customer's
// first impression and must never be a stack trace.

// The two verified states that "the code works" collapses into. Any warm dead
// end is one of the EtsyLandingState variants below.
type CheckResult = "ready" | "redeemed" | "void" | "invalid";

export interface EtsyLandingProps {
  code: string;
  checkCode: (code: string) => Promise<CheckResult>;
  redeem: (code: string) => Promise<EtsyRedeemOutcome>;
  createSession: () => Promise<string>;
  navigate: (path: string) => void;
}

type Phase = "working" | EtsyLandingState;

interface DeadEnd {
  heading: string;
  body: string;
}

// Warm copy for every non-ready terminal state. No mention of price, refunds,
// or buying again — only how to reach a human through Etsy.
const DEAD_ENDS: Record<Exclude<Phase, "working" | "ready">, DeadEnd> = {
  redeemed: {
    heading: "This code has already been used",
    body: "Each code makes one song. If you haven't received yours or need a hand, reply through your Etsy order messages and we'll sort it out.",
  },
  void: {
    heading: "This code is no longer valid",
    body: "Reply through your Etsy order messages and we'll get you a working code straight away.",
  },
  invalid: {
    heading: "We couldn't find that code",
    body: "Double-check the code from your Etsy order, or reply through your Etsy order messages and we'll help.",
  },
  rate_limited: {
    heading: "Too many tries just now",
    body: "Give it a minute, then open your link again. If it keeps happening, reply through your Etsy order messages.",
  },
  unavailable: {
    heading: "We're temporarily unavailable",
    body: "Song creation is paused for a moment. Try your link again shortly — your order is safe.",
  },
  error: {
    heading: "Something went wrong",
    body: "We couldn't start your song just now. Try your link again in a moment, or reply through your Etsy order messages.",
  },
};

export function EtsyLanding({
  code,
  checkCode,
  redeem,
  createSession,
  navigate,
}: EtsyLandingProps) {
  const [phase, setPhase] = useState<Phase>("working");

  useEffect(() => {
    let live = true;
    const settle = (next: Phase) => {
      if (live) setPhase(next);
    };

    async function run() {
      if (!code) return settle("invalid");
      let check: CheckResult;
      try {
        check = await checkCode(code);
      } catch {
        return settle("error");
      }
      if (!live) return;
      if (check !== "ready") return settle(check);

      try {
        await createSession();
      } catch {
        return settle("error");
      }
      if (!live) return;

      let outcome: EtsyRedeemOutcome;
      try {
        outcome = await redeem(code);
      } catch {
        return settle("error");
      }
      if (!live) return;
      if (outcome.state === "ready") {
        navigate("/create");
        return;
      }
      settle(outcome.state);
    }

    void run();
    return () => {
      live = false;
    };
    // Deps are stable per mount; the landing runs its handoff exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "working" || phase === "ready") {
    return (
      <main className="step step-centered etsy-landing">
        <span className="etsy-brand" aria-hidden="true">
          Porizo
        </span>
        <section className="card status-card" aria-live="polite">
          <h1>Your song is paid for.</h1>
          <p>Setting up your song now — this only takes a moment.</p>
          <span className="status-orbit" role="status" aria-label="Loading" />
        </section>
      </main>
    );
  }

  const deadEnd = DEAD_ENDS[phase];
  return (
    <main className="step step-centered etsy-landing">
      <span className="etsy-brand" aria-hidden="true">
        Porizo
      </span>
      <section className="card status-card" aria-live="polite">
        <h1>{deadEnd.heading}</h1>
        <p>{deadEnd.body}</p>
      </section>
    </main>
  );
}
