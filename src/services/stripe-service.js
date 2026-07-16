"use strict";

// Stripe API version this service is written against. Pinning avoids silent
// behaviour drift when the installed SDK's default version bumps.
const STRIPE_API_VERSION = "2024-06-20";

class StripeConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "StripeConfigurationError";
    this.code = "STRIPE_NOT_CONFIGURED";
  }
}

// Resolve the secret key with the same fail-closed posture as the Turnstile
// verifier: production MUST have a real key; test/dev may run with a fake
// injected client and no key at all.
function resolveStripeSecret({
  secretKey,
  environment = process.env.NODE_ENV,
} = {}) {
  const configured = String(
    secretKey || process.env.STRIPE_SECRET_KEY || "",
  ).trim();
  if (configured) {
    if (environment === "production" && configured.startsWith("sk_test_")) {
      throw new StripeConfigurationError(
        "Stripe test secret keys are forbidden in production.",
      );
    }
    return configured;
  }
  // Missing key is "not configured yet", not a misconfiguration: the server
  // must still BOOT (funnel is flag-gated; Stripe setup may come later).
  // Enforcement moves to use time — getClient()/constructEvent throw, and the
  // checkout routes translate that into 503. Only an actively WRONG config
  // (sk_test_ in production, above) stays boot-fatal.
  return null;
}

function resolveWebhookSecret({
  webhookSecret,
  environment = process.env.NODE_ENV,
} = {}) {
  const configured = String(
    webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || "",
  ).trim();
  if (configured) return configured;
  if (environment === "production") {
    // Not boot-fatal (see resolveStripeSecret): constructEvent refuses at use
    // time so an unconfigured webhook can never verify — or accept — events.
    return null;
  }
  // Deterministic dev/test secret so generateTestHeaderString + constructEvent
  // agree without any environment setup.
  return "whsec_test_secret";
}

/**
 * Build the Stripe service. In production it constructs a real Stripe client;
 * in test/dev a fake client can be injected (constructor injection, like the
 * Turnstile verifier). Signature verification always uses a real `stripe`
 * instance so tests can sign events with the same webhook secret.
 *
 * @param {Object} options
 * @param {string} [options.secretKey]
 * @param {string} [options.webhookSecret]
 * @param {string} [options.environment]
 * @param {Object} [options.client] - injected fake client (test/dev)
 * @param {Function} [options.stripeFactory] - override for `require('stripe')`
 */
function createStripeService({
  secretKey,
  webhookSecret,
  environment = process.env.NODE_ENV,
  client = null,
  stripeFactory = null,
} = {}) {
  const resolvedSecret = resolveStripeSecret({ secretKey, environment });
  const resolvedWebhookSecret = resolveWebhookSecret({
    webhookSecret,
    environment,
  });

  const StripeCtor = stripeFactory || require("stripe");
  // A real Stripe instance is used purely for signature verification; it needs
  // no valid key for constructEvent, so a placeholder is safe when only a fake
  // client is injected.
  const signingClient = new StripeCtor(
    resolvedSecret || "sk_test_placeholder",
    {
      apiVersion: STRIPE_API_VERSION,
    },
  );

  let apiClient = client;
  function getClient() {
    if (apiClient) return apiClient;
    if (!resolvedSecret) {
      throw new StripeConfigurationError(
        environment === "production"
          ? "STRIPE_SECRET_KEY is required in production."
          : "Stripe client is not configured for this environment.",
      );
    }
    apiClient = signingClient;
    return apiClient;
  }

  return {
    apiVersion: STRIPE_API_VERSION,
    webhookSecret: resolvedWebhookSecret,
    isConfigured: Boolean((resolvedSecret || client) && resolvedWebhookSecret),

    constructEvent(rawBody, signatureHeader) {
      if (!resolvedWebhookSecret) {
        throw new StripeConfigurationError(
          "STRIPE_WEBHOOK_SECRET is required in production.",
        );
      }
      return signingClient.webhooks.constructEvent(
        rawBody,
        signatureHeader,
        resolvedWebhookSecret,
      );
    },

    async createCheckoutSession(params) {
      return getClient().checkout.sessions.create(params);
    },

    async retrieveCheckoutSession(sessionId, params = undefined) {
      return getClient().checkout.sessions.retrieve(sessionId, params);
    },

    async createRefund(params) {
      return getClient().refunds.create(params);
    },
  };
}

module.exports = {
  STRIPE_API_VERSION,
  StripeConfigurationError,
  resolveStripeSecret,
  resolveWebhookSecret,
  createStripeService,
};
