import { useMemo } from "react";
import { createApiClient } from "./api/client";
import {
  fetchEtsyCodeCheck,
  landingStateForCode,
  normalizeCode,
  redeemLandingState,
} from "./api/etsy";
import { EtsyLanding } from "./steps/EtsyLanding";
import { TOKEN_KEY, createGuestSession } from "./session-bootstrap";

// Wires the real API client into the pure EtsyLanding component. Reads ?code=
// from the URL, pre-checks it, and (on success) redeems against a guest session
// before a full-page hand-off to /create — where the already-built wallet-credit
// offer branch picks up the granted gift credit on the same guest session.
export default function EtsyEntry() {
  const code = useMemo(
    () => normalizeCode(new URLSearchParams(location.search).get("code")),
    [],
  );

  const client = useMemo(
    () => createApiClient({ getToken: () => localStorage.getItem(TOKEN_KEY) }),
    [],
  );

  return (
    <EtsyLanding
      code={code}
      checkCode={async (value) => {
        const check = await fetchEtsyCodeCheck(client, value);
        const state = landingStateForCode(check);
        // The landing only forwards the four pre-check outcomes; a disabled
        // funnel or guard failure surfaces later, at redeem, as its own state.
        return state === "ready" || state === "redeemed" || state === "void"
          ? state
          : "invalid";
      }}
      redeem={(value) => redeemLandingState(client, value)}
      createSession={createGuestSession}
      navigate={(path) => location.assign(path)}
    />
  );
}
