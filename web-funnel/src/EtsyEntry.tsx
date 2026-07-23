import { useMemo, useRef } from "react";
import { createApiClient } from "./api/client";
import {
  claimEtsyOrder,
  checkEtsyOrder,
  landingStateForError,
} from "./api/etsy";
import { EtsyLanding } from "./steps/EtsyLanding";
import { beginEtsyFulfilmentHandoff } from "./etsy-fulfilment";
import {
  TOKEN_KEY,
  createGuestSession,
  refreshExistingSession,
} from "./session-bootstrap";
import { acquireTurnstileToken, TurnstileError } from "./turnstile";

export default function EtsyEntry() {
  const claimProof = useRef<string | undefined>(undefined);
  const client = useMemo(
    () =>
      createApiClient({
        getToken: () => localStorage.getItem(TOKEN_KEY),
        refreshSession: refreshExistingSession,
      }),
    [],
  );

  return (
    <EtsyLanding
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
        if (!claimProof.current) {
          throw new Error("ETSY_CLAIM_PROOF_REQUIRED");
        }
        return claimEtsyOrder(client, receiptId, claimProof.current);
      }}
      createSession={createGuestSession}
      navigate={() =>
        beginEtsyFulfilmentHandoff(() => location.assign("/create"))
      }
    />
  );
}
