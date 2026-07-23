import { ApiError } from "./api/client";
import { acquireTurnstileToken } from "./turnstile";

// Storage keys are shared across every funnel entry point (the /create App and
// the /etsy landing) so a guest session established on one surface is the same
// session the other reuses. Do not fork these constants.
export const TOKEN_KEY = "porizo.web-funnel.token";
export const REFRESH_TOKEN_KEY = "porizo.web-funnel.refresh-token";
export const WEB_CSRF_COOKIE = "__Host-porizo_web_csrf";

export function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

// Bridge an already-signed-in web session (CSRF cookie present) into a bearer
// token. Returns null when there is no signed-in session to bridge.
export async function exchangeWebSession(): Promise<string | null> {
  const csrf = readCookie(WEB_CSRF_COOKIE);
  if (!csrf) return null;
  const response = await fetch("/auth/web/token", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": csrf,
    },
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(
      failure.message ?? "Signed-in session could not be restored",
      response.status,
      failure.error,
    );
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("Signed-in session response did not include a token.");
  }
  localStorage.setItem(TOKEN_KEY, body.access_token);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  return body.access_token;
}

// Establish (or reuse) a guest session, returning a bearer token. Prefers a
// bridged signed-in session, then an existing stored token, then a fresh guest
// session gated by Turnstile.
export async function createGuestSession(): Promise<string> {
  const bridged = await exchangeWebSession();
  if (bridged) return bridged;
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;
  const turnstileToken = await acquireTurnstileToken();
  const response = await fetch("/web/session", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      turnstile_token: turnstileToken,
      entry_url: location.href,
    }),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      message?: string;
    };
    throw new ApiError(
      failure.message ?? "Session could not be started",
      response.status,
      failure.error ?? failure.code,
    );
  }
  const body = (await response.json()) as {
    access_token?: string;
    token?: string;
    refresh_token?: string;
  };
  const token = body.access_token ?? body.token;
  if (!token) {
    throw new Error("Guest session response did not include a token.");
  }
  localStorage.setItem(TOKEN_KEY, token);
  if (body.refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, body.refresh_token);
  }
  return token;
}
