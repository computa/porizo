"use strict";

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const TURNSTILE_TEST_SECRETS = new Set([
  TURNSTILE_TEST_SECRET,
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

class TurnstileConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TurnstileConfigurationError";
    this.code = "TURNSTILE_NOT_CONFIGURED";
  }
}

class TurnstileUnavailableError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "TurnstileUnavailableError";
    this.code = "TURNSTILE_UNAVAILABLE";
  }
}

function resolveTurnstileSecret({
  secretKey,
  environment = process.env.NODE_ENV,
} = {}) {
  const configured = String(
    secretKey || process.env.TURNSTILE_SECRET_KEY || "",
  ).trim();
  if (configured) {
    if (environment === "production" && TURNSTILE_TEST_SECRETS.has(configured)) {
      throw new TurnstileConfigurationError(
        "Cloudflare Turnstile test secrets are forbidden in production.",
      );
    }
    return configured;
  }
  if (environment === "production") {
    throw new TurnstileConfigurationError(
      "TURNSTILE_SECRET_KEY is required in production.",
    );
  }
  return TURNSTILE_TEST_SECRET;
}

function createTurnstileVerifier({
  secretKey,
  environment = process.env.NODE_ENV,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  expectedAction = "web_session",
  expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME || "porizo.co",
} = {}) {
  const resolvedSecret = resolveTurnstileSecret({ secretKey, environment });
  if (typeof fetchImpl !== "function") {
    throw new TurnstileConfigurationError("A fetch implementation is required.");
  }

  async function verify({ token, remoteIp }) {
    const responseToken = String(token || "").trim();
    if (!responseToken) {
      return { success: false, errorCodes: ["missing-input-response"] };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = new URLSearchParams({
        secret: resolvedSecret,
        response: responseToken,
      });
      if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

      const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new TurnstileUnavailableError(
          `Turnstile Siteverify returned HTTP ${response.status}.`,
        );
      }
      const payload = await response.json();
      const metadataMatches =
        environment !== "production" ||
        (payload?.action === expectedAction &&
          payload?.hostname === expectedHostname);
      return {
        success: payload?.success === true && metadataMatches,
        errorCodes: metadataMatches
          ? Array.isArray(payload?.["error-codes"])
            ? payload["error-codes"]
            : []
          : ["site-metadata-mismatch"],
      };
    } catch (error) {
      if (error instanceof TurnstileUnavailableError) throw error;
      throw new TurnstileUnavailableError(
        "Turnstile Siteverify could not be reached.",
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return { verify };
}

module.exports = {
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_SECRET,
  TURNSTILE_TEST_SECRETS,
  TurnstileConfigurationError,
  TurnstileUnavailableError,
  resolveTurnstileSecret,
  createTurnstileVerifier,
};
