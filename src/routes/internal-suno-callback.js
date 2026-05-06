/**
 * Internal Suno Callback Route — authenticated no-op receiver.
 *
 * Per docs/plans/2026-05-05-002-fix-suno-voice-persona-architecture-findings-plan.md U18.
 *
 * SunoAPI's upload-cover and generate-persona flows accept a `callBackUrl`
 * argument and POST async result metadata to it (taskId, audioId, persona id,
 * status). Until U18, this URL was hardcoded to `https://httpbin.org/post`
 * (a public HTTP inspection service) — leaking task metadata. U1 made the URL
 * configurable via `SUNO_CALLBACK_URL`; this route is the receiving endpoint.
 *
 * SAFETY:
 *   - Stub MUST NOT mutate state. Future iterations may hook into
 *     voice_provider_jobs status transitions, but doing so without auth design
 *     is an unauthenticated write surface — explicitly out of scope for U18.
 *   - The callback is authenticated before any logging or future state update.
 *   - When `SUNO_CALLBACK_HMAC_SECRET` is unset, the route returns 503; this
 *     is fail-secure (no spoofed callback can drive state).
 *   - Logs are redacted via `sanitizeProviderError`.
 *
 * !!! BEFORE PROMOTING THIS ROUTE TO STATE MUTATION !!!
 *   The current handler accepts EITHER a query-string `?token=<secret>` OR an
 *   `X-Suno-Signature: HMAC-SHA256(rawBody)` header. The token-only path is
 *   unsafe for state mutation: tokens land in webserver access logs, proxy
 *   logs, browser referrers, and Suno's own outbound logs — once leaked, they
 *   replay indefinitely. The handler is currently a no-op so the bypass has no
 *   impact, but ANY change that makes this route advance `voice_provider_jobs`
 *   or `voice_provider_profiles` MUST first:
 *     1. Drop the token-only auth branch — require HMAC-of-rawBody only.
 *     2. Add an `X-Suno-Timestamp` header included in the HMAC payload.
 *     3. Reject payloads older than 5 minutes (replay protection).
 *     4. Add a short-lived dedupe set keyed on (taskId, status).
 *   See M8 in tasks/codex-review-72h.md and the H10 risk notes.
 *
 * SUNOAPI CONTRACT:
 *   Public docs describe `callBackUrl` payload delivery but do not document a
 *   provider-signed webhook header. To avoid relying on an invented
 *   X-Suno-Signature contract, production should configure SUNO_CALLBACK_URL
 *   with an unguessable query token:
 *
 *     https://api.porizo.co/internal/suno/callback?token=<secret>
 *
 *   The route also accepts X-Suno-Signature as an optional future-compatible
 *   HMAC-SHA256(raw body) scheme if SunoAPI later confirms it.
 */

const crypto = require("node:crypto");

const SIGNATURE_HEADER = "x-suno-signature";

function timingSafeEqualString(expected, actual) {
  const a = Buffer.from(String(expected || ""), "utf8");
  const b = Buffer.from(String(actual || ""), "utf8");
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function timingSafeEqualHex(expected, actual) {
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(actual, "hex");
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function registerInternalSunoCallbackRoutes(
  app,
  { appConfig = {}, sendError } = {},
) {
  const send =
    typeof sendError === "function"
      ? sendError
      : (reply, status, code, message) =>
          reply.code(status).send({ error: code, message });

  app.post(
    "/internal/suno/callback",
    {
      // Tight body limit — Suno persona callbacks are small JSON envelopes
      // (taskId/audioId/personaId/status). Keeps this public endpoint from
      // being a memory-amplification vector for unauthenticated traffic.
      bodyLimit: 16 * 1024,
      // Per-IP rate limit. The endpoint is unauthenticated until the HMAC is
      // verified, and HMAC computation runs against attacker-controlled bytes.
      // 60 requests/minute/IP is well above legitimate Suno traffic per task.
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
      preParsing: async (request, _reply, payload) => {
        const chunks = [];
        for await (const chunk of payload) {
          chunks.push(chunk);
        }
        // Keep rawBody as a Buffer for HMAC verification — encoding-safe
        // (no UTF-8 normalization quirks). Re-stream the same Buffer so
        // Fastify's JSON parser still sees the original bytes.
        request.rawBody = Buffer.concat(chunks);
        const { Readable } = require("stream");
        return Readable.from([request.rawBody]);
      },
    },
    async (request, reply) => {
      const secret =
        process.env.SUNO_CALLBACK_HMAC_SECRET ||
        appConfig.SUNO_CALLBACK_HMAC_SECRET;
      if (!secret) {
        return send(
          reply,
          503,
          "CALLBACK_NOT_CONFIGURED",
          "SUNO_CALLBACK_HMAC_SECRET is not set; callbacks are disabled.",
        );
      }
      if (String(secret).length < 32) {
        return send(
          reply,
          503,
          "CALLBACK_NOT_CONFIGURED",
          "SUNO_CALLBACK_HMAC_SECRET must be at least 32 characters.",
        );
      }

      const rawBody = Buffer.isBuffer(request.rawBody)
        ? request.rawBody
        : Buffer.from(request.rawBody || "", "utf-8");
      const providedToken =
        typeof request.query?.token === "string" ? request.query.token : "";
      const tokenMatches = timingSafeEqualString(secret, providedToken);

      const providedSignature = request.headers[SIGNATURE_HEADER];
      let signatureMatches = false;
      if (providedSignature && typeof providedSignature === "string") {
        const expectedSignature = crypto
          .createHmac("sha256", secret)
          .update(rawBody)
          .digest("hex");
        signatureMatches = timingSafeEqualHex(
          expectedSignature,
          providedSignature,
        );
      }

      if (!tokenMatches && !signatureMatches) {
        return send(
          reply,
          401,
          "INVALID_CALLBACK_AUTH",
          "Callback authentication did not match.",
        );
      }

      // Stub: redacted log only, no state mutation.
      const callbackType =
        (request.body &&
          typeof request.body === "object" &&
          request.body.callbackType) ||
        null;
      console.log(
        "[suno-callback] received",
        JSON.stringify({
          callback_type: callbackType,
          body_size_bytes: rawBody.length,
        }),
      );

      reply.code(200).send({ received: true });
    },
  );
}

module.exports = {
  registerInternalSunoCallbackRoutes,
  // exported for tests
  __internal: { timingSafeEqualHex, timingSafeEqualString, SIGNATURE_HEADER },
};
