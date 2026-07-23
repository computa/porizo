import { ApiError, type ApiClient } from "./client";

// Mirrors etsy-redemption-service.validate() and the redeem route's error codes.
export type EtsyCodeStatus = "unredeemed" | "redeemed" | "void" | "not_found";

// The states the /etsy landing can be in. "ready" means the buyer can be handed
// off to /create with a paid-for credit. Everything else is a warm, human dead
// end — the landing must never surface a raw error to a paying customer.
export type EtsyLandingState =
  | "ready"
  | "redeemed"
  | "void"
  | "invalid"
  | "rate_limited"
  | "configuration"
  | "network"
  | "unavailable"
  | "error";

export interface EtsyCodeCheck {
  valid: boolean;
  status: EtsyCodeStatus;
}

export interface EtsyRedeemResponse {
  redeemed: boolean;
  idempotent: boolean;
  balance_after: number;
}

export interface EtsyRedeemOutcome {
  state: EtsyLandingState;
  balanceAfter?: number;
}

export interface EtsyOrderClaim {
  claimed: true;
  order_reference: string;
  unit_ids: string[];
  wallet_balance: number;
  commerce_free: true;
}

export interface EtsyOrderCheck {
  accepted: true;
  claim_proof: string;
}

export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

// Map the pre-check GET /web/etsy/code/:code response to a landing state. A
// still-redeemable code is "ready"; anything else is a specific dead end so the
// buyer sees the right message before we ever attempt a redeem.
export function landingStateForCode(check: EtsyCodeCheck): EtsyLandingState {
  switch (check.status) {
    case "unredeemed":
      return "ready";
    case "redeemed":
      return "redeemed";
    case "void":
      return "void";
    default:
      return "invalid";
  }
}

// Map a redeem failure to a landing state. The redeem route reuses 404 for both
// an unknown code (CODE_NOT_FOUND) and a disabled funnel (NOT_FOUND); the code
// distinguishes them so a paused funnel doesn't read as a bad code.
export function landingStateForError(error: unknown): EtsyLandingState {
  if (!(error instanceof ApiError)) return "error";
  if (
    error.code === "NOT_FOUND" ||
    error.code === "ETSY_ENTRY_DISABLED" ||
    error.code === "ETSY_CONFIG_UNAVAILABLE" ||
    error.code === "TURNSTILE_UNAVAILABLE"
  ) {
    return "unavailable";
  }
  switch (error.status) {
    case 404:
      return "invalid";
    case 409:
      return "redeemed";
    case 410:
      return "void";
    case 429:
      return "rate_limited";
    case 503:
      return "unavailable";
    default:
      return "error";
  }
}

export async function fetchEtsyCodeCheck(
  client: ApiClient,
  code: string,
): Promise<EtsyCodeCheck> {
  return client.post<EtsyCodeCheck>("/web/etsy/code/check", { code });
}

// Redeem a code for the current guest session. Idempotent server-side for the
// same user, so a re-entered code by the same buyer still resolves to "ready".
export async function redeemLandingState(
  client: ApiClient,
  code: string,
): Promise<EtsyRedeemOutcome> {
  try {
    const response = await client.post<EtsyRedeemResponse>(
      "/web/etsy/redeem",
      { code },
      {
        headers: {
          "Idempotency-Key": `etsy-redeem:${code}`,
        },
      },
    );
    return { state: "ready", balanceAfter: response.balance_after };
  } catch (error) {
    return { state: landingStateForError(error) };
  }
}

export async function checkEtsyOrder(
  client: ApiClient,
  receiptId: string,
  turnstileToken: string,
) {
  return client.post<EtsyOrderCheck>("/web/etsy/order/check", {
    receipt_id: receiptId,
    turnstile_token: turnstileToken,
  });
}

export async function claimEtsyOrder(
  client: ApiClient,
  receiptId: string,
  claimProof: string,
): Promise<EtsyOrderClaim> {
  return client.post<EtsyOrderClaim>("/web/etsy/order/claim", {
    receipt_id: receiptId,
    claim_proof: claimProof,
  });
}
