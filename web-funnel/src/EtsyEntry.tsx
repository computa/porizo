import { useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "./api/client";
import {
  claimEtsyOrder,
  checkEtsyOrder,
  fetchEtsyCodeCheck,
  fetchEtsyFulfilmentMode,
  landingStateForCode,
  landingStateForError,
  normalizeCode,
  requestEtsyCodeClaim,
  type EtsyFulfilmentMode,
} from "./api/etsy";
import { EtsyCodeLanding } from "./steps/EtsyCodeLanding";
import { EtsyLanding as EtsyReceiptLanding } from "./steps/EtsyLanding";
import { beginEtsyFulfilmentHandoff } from "./etsy-fulfilment";
import {
  TOKEN_KEY,
  createGuestSession,
  refreshExistingSession,
} from "./session-bootstrap";
import { acquireTurnstileToken, TurnstileError } from "./turnstile";

export default function EtsyEntry() {
  const forceCode =
    location.pathname.replace(/\/$/, "") === "/etsy/code";
  const [mode, setMode] = useState<EtsyFulfilmentMode>();
  const claimProof = useRef<string | undefined>(undefined);
  const client = useMemo(
    () =>
      createApiClient({
        getToken: () => localStorage.getItem(TOKEN_KEY),
        refreshSession: refreshExistingSession,
      }),
    [],
  );

  useEffect(() => {
    let live = true;
    fetchEtsyFulfilmentMode(client)
      .then((value) => {
        if (live) setMode(value);
      })
      .catch(() => {
        if (live) setMode("off");
      });
    return () => {
      live = false;
    };
  }, [client]);

  if (!mode) {
    return (
      <main className="step step-centered etsy-landing">
        <section className="card status-card" aria-live="polite">
          <h1>Opening your Etsy order…</h1>
          <span className="status-orbit" role="status" aria-label="Loading" />
        </section>
      </main>
    );
  }

  if (mode === "off") {
    return (
      <main className="step step-centered etsy-landing">
        <section className="card status-card">
          <h1>We're temporarily unavailable.</h1>
          <p>Your paid Etsy order is safe. Try again shortly.</p>
        </section>
      </main>
    );
  }

  if (forceCode || mode === "code") {
    return (
      <EtsyCodeLanding
        checkCode={async (rawCode) => {
          try {
            const check = await fetchEtsyCodeCheck(
              client,
              normalizeCode(rawCode),
            );
            return landingStateForCode(check);
          } catch (error) {
            return landingStateForError(error);
          }
        }}
        requestClaim={async (rawCode, email) => {
          await requestEtsyCodeClaim(client, {
            code: normalizeCode(rawCode),
            email,
          });
        }}
      />
    );
  }

  return (
    <EtsyReceiptLanding
      checkReceipt={async (receiptId) => {
        try {
          const checked = await checkEtsyOrder(
            client,
            receiptId,
            await acquireTurnstileToken(),
          );
          claimProof.current = checked.claim_proof;
          return "ready";
        } catch (error) {
          if (error instanceof TurnstileError) {
            return error.code === "configuration" ? "configuration" : "network";
          }
          return landingStateForError(error);
        }
      }}
      claim={async (receiptId) => {
        if (!claimProof.current) throw new Error("ETSY_CLAIM_PROOF_REQUIRED");
        return claimEtsyOrder(client, receiptId, claimProof.current);
      }}
      createSession={createGuestSession}
      navigate={() =>
        beginEtsyFulfilmentHandoff(() => location.assign("/create"))
      }
    />
  );
}
