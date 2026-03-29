/**
 * Shared step & error classification for the render pipeline.
 *
 * Single source of truth consumed by:
 *   - src/workflows/runner.js (retry decisions, DLQ skip-list)
 *   - src/server.js (classifyRenderFailure for iOS job status)
 *   - test/step-classification.test.js (regression tests)
 */

// Steps that call external provider APIs (Suno, ElevenLabs, Replicate, Seed-VC).
// Mirrors getStepProviders() in runner.js — update both if adding a new provider step.
const PROVIDER_STEPS = new Set([
  "instrumental",
  "instrumental_full",
  "guide_vocal",
  "guide_vocal_full",
  "voice_convert",
  "voice_convert_sections",
]);

function isProviderStep(step) {
  return PROVIDER_STEPS.has(step);
}

function isLocalStep(step) {
  return (
    typeof step === "string" &&
    step.length > 0 &&
    !isProviderStep(step) &&
    step !== "queued" &&
    step !== "ready"
  );
}

/**
 * Classify a render failure by error code, message, and the step where it occurred.
 *
 * @param {string} message - The raw or normalized error message
 * @param {string|null} code - The error code (e.g. "E301_FFMPEG_ERROR")
 * @param {string|null} step - The pipeline step where the error occurred
 * @returns {{ category: string, retryable: boolean, suggestedAction: string, canAutoRewrite: boolean, provider: string|null }}
 */
function classifyError(message, code, step) {
  const msg = typeof message === "string" ? message : "";
  const normalizedCode = typeof code === "string" ? code.toUpperCase() : "";
  const normalized = `${normalizedCode} ${msg}`.toLowerCase();

  // Infer provider from error code prefix
  const provider = normalizedCode.startsWith("E302_SUNO")
    ? "suno"
    : normalizedCode.startsWith("E301_ELEVENLABS") || normalizedCode.startsWith("E305_ELEVENLABS")
      ? "elevenlabs"
      : null;

  // --- Policy errors (need lyrics rewrite, not retryable) ---

  if (
    normalizedCode === "E302_PROVIDER_POLICY_ERROR" ||
    normalizedCode === "E302_SUNO_POLICY_ERROR" ||
    normalized.includes("content policy") ||
    normalized.includes("lyrics policy") ||
    normalized.includes("producer tag") ||
    normalized.includes("specific artists")
  ) {
    return { category: "policy_content", retryable: false, suggestedAction: "rewrite_and_retry", canAutoRewrite: true, provider };
  }

  if (
    normalizedCode === "E301_ELEVENLABS_VALIDATION" ||
    normalized.includes("bad_composition_plan") ||
    normalized.includes("bad_prompt") ||
    normalized.includes("compose validation failed")
  ) {
    return { category: "policy_validation", retryable: false, suggestedAction: "rewrite_and_retry", canAutoRewrite: true, provider: provider || "elevenlabs" };
  }

  // --- Quality gate ---

  if (normalizedCode === "E302_QUALITY_GATE_FAILED" || normalized.includes("quality gate")) {
    return { category: "quality_gate", retryable: true, suggestedAction: "retry_with_adjusted_style", canAutoRewrite: true, provider };
  }

  // --- Provider transient (rate limits) ---

  if (normalizedCode === "PROVIDER_ERROR_429" || normalized.includes("rate limit")) {
    return { category: "provider_transient", retryable: true, suggestedAction: "wait_and_retry", canAutoRewrite: false, provider };
  }

  // --- Provider retryable (incomplete output) ---

  if (
    normalizedCode === "E302_SUNO_INCOMPLETE_OUTPUT" ||
    normalized.includes("no audio url in response") ||
    normalized.includes("no audio data in response") ||
    normalized.includes("incomplete audio result")
  ) {
    return { category: "provider_retryable", retryable: true, suggestedAction: "retry", canAutoRewrite: false, provider: provider || "suno" };
  }

  // --- Missing inputs (deterministic, not retryable) ---

  if (
    normalizedCode === "E301_MISSING_INPUTS" ||
    normalizedCode === "E301_MISSING_STEMS" ||
    normalizedCode === "E301_GUIDE_VOCAL_MISSING" ||
    msg.startsWith("E301_MISSING_INPUTS:") ||
    msg.startsWith("E301_MISSING_STEMS:") ||
    msg.startsWith("E301_GUIDE_VOCAL_MISSING:")
  ) {
    return { category: "input_missing", retryable: false, suggestedAction: "retry", canAutoRewrite: false, provider: null };
  }

  // --- FFmpeg: spawn failures are transient, others are terminal ---

  if (normalizedCode === "E301_FFMPEG_TIMEOUT" || normalizedCode === "E301_FFMPEG_SPAWN" ||
      msg.startsWith("E301_FFMPEG_TIMEOUT:") || msg.startsWith("E301_FFMPEG_SPAWN:")) {
    return { category: "processing_retryable", retryable: true, suggestedAction: "retry", canAutoRewrite: false, provider: null };
  }

  if (normalizedCode === "E301_FFMPEG_ERROR" || msg.startsWith("E301_FFMPEG_ERROR:")) {
    return { category: "processing_terminal", retryable: false, suggestedAction: "retry", canAutoRewrite: false, provider: null };
  }

  // --- Lyrics errors: AI_UNAVAILABLE is transient, rest is terminal ---

  if (normalizedCode === "E201_LYRICS_ERROR" || msg.startsWith("E201_LYRICS_ERROR:")) {
    if (normalized.includes("ai_unavailable")) {
      return { category: "processing_retryable", retryable: true, suggestedAction: "retry", canAutoRewrite: false, provider: null };
    }
    return { category: "processing_terminal", retryable: false, suggestedAction: "retry", canAutoRewrite: false, provider: null };
  }

  // --- Workflow / config errors (deterministic) ---

  if (
    normalizedCode === "E302_WORKFLOW_ERROR" ||
    normalizedCode === "E302_PERSONALIZED_NO_PROVIDER" ||
    normalizedCode === "E301_MISSING_CONFIG" ||
    normalizedCode === "E305_ELEVENLABS_VOICE_ERROR" ||
    normalizedCode === "E301_SOURCE_URL_EXPIRED" ||
    msg.startsWith("E302_WORKFLOW_ERROR:") ||
    msg.startsWith("E302_PERSONALIZED_NO_PROVIDER:") ||
    msg.startsWith("E305_ELEVENLABS_VOICE_ERROR:") ||
    msg.startsWith("E301_SOURCE_URL_EXPIRED:")
  ) {
    return { category: "processing_terminal", retryable: false, suggestedAction: "retry", canAutoRewrite: false, provider };
  }

  // --- Entitlement limits ---

  if (normalizedCode === "INSUFFICIENT_CREDITS" || normalizedCode === "NO_ENTITLEMENTS") {
    return { category: "entitlement_limit", retryable: false, suggestedAction: "upgrade_or_wait", canAutoRewrite: false, provider: null };
  }

  if (normalizedCode === "DAILY_LIMIT_REACHED" || normalized.includes("daily preview limit reached")) {
    return { category: "entitlement_limit", retryable: false, suggestedAction: "wait_for_reset", canAutoRewrite: false, provider: null };
  }

  // --- Network / timeout (generic) ---

  if (normalized.includes("timeout") || normalized.includes("network")) {
    return { category: "processing_retryable", retryable: true, suggestedAction: "retry", canAutoRewrite: false, provider };
  }

  // --- Step-aware fallback ---

  if (isProviderStep(step)) {
    return { category: "provider_terminal", retryable: false, suggestedAction: "retry", canAutoRewrite: false, provider };
  }

  if (isLocalStep(step)) {
    return { category: "processing_terminal", retryable: false, suggestedAction: "retry", canAutoRewrite: false, provider: null };
  }

  // Step is null/undefined/unknown — explicit unknown
  return { category: "unknown_terminal", retryable: false, suggestedAction: "retry", canAutoRewrite: false, provider: null };
}

module.exports = {
  PROVIDER_STEPS,
  isProviderStep,
  isLocalStep,
  classifyError,
};
