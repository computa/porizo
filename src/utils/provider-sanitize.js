/**
 * Provider-Sanitize Utility (U5)
 *
 * Single source of truth for redacting Bearer tokens, URLs, and provider
 * resource IDs from error messages before they reach logs or are returned to
 * clients. Pre-U5, two near-identical implementations existed:
 *   - src/providers/suno-persona.js `sanitizeProviderMessage` (no length cap)
 *   - src/services/voice-provider-profile-service.js `sanitizeProviderError`
 *     (1000-char cap)
 * The cap asymmetry meant that long Suno error bodies could leak sensitive
 * data through the persona-provider path. This module enforces the cap
 * uniformly.
 */

const MAX_LENGTH = 1000;

function sanitizeProviderError(input) {
  const message =
    input && typeof input === "object" && typeof input.message === "string"
      ? input.message
      : input;
  return String(message || "unknown_error")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/\S+/gi, "[redacted_url]")
    .replace(/\bpersona[_-][A-Za-z0-9_-]+/gi, "persona_[redacted]")
    .replace(/\btask[_-][A-Za-z0-9_-]+/gi, "task_[redacted]")
    .replace(/\baudio[_-][A-Za-z0-9_-]+/gi, "audio_[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[redacted_jwt]",
    )
    .replace(/\b[a-z]+_[A-Za-z0-9]{20,}\b/g, "[redacted_provider_id]")
    .replace(
      /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/g,
      "[redacted_uuid]",
    )
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted_hex_id]")
    .slice(0, MAX_LENGTH);
}

module.exports = {
  sanitizeProviderError,
};
