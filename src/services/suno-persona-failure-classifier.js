function text(error) {
  return String(error?.message || error || "").toLowerCase();
}

function result(
  category,
  safeToRetry,
  safeAfterGenerate,
  recoveryScope,
  userAction,
  reason,
) {
  return {
    category,
    safeToRetry,
    safeToRetryAfterGenerateRequestStarted: safeAfterGenerate,
    recoveryScope,
    userAction,
    reason,
  };
}

function classifySunoPersonaFailure(error) {
  const message = text(error);

  if (
    message.includes("cancelled") ||
    message.includes("cancellation_requested")
  ) {
    return result("cancelled", false, false, "none", "wait", "cancelled");
  }
  if (
    message.includes("api key") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("callback_not_configured")
  ) {
    return result(
      "auth_config",
      false,
      false,
      "manual_review",
      "contact_support",
      "provider_auth",
    );
  }
  if (
    message.includes("policy") ||
    message.includes("blocked words") ||
    message.includes("violates")
  ) {
    return result(
      "policy",
      false,
      false,
      "manual_review",
      "contact_support",
      "provider_policy",
    );
  }
  if (
    message.includes("current music failed to generate persona") ||
    message.includes("bad source music") ||
    message.includes("music does not exist")
  ) {
    return result(
      "source_audio_retryable",
      true,
      true,
      "same_task_audio",
      "wait",
      "bad_source_music",
    );
  }
  if (
    message.includes("music is still generating") ||
    message.includes("ensure the music generation task is fully completed") ||
    message.includes("create persona error")
  ) {
    return result(
      "transient",
      true,
      true,
      "job_retry",
      "wait",
      "provider_not_ready",
    );
  }
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("fetch failed") ||
    message.includes("network")
  ) {
    return result(
      "transient",
      true,
      false,
      "manual_review",
      "contact_support",
      "provider_not_ready",
    );
  }
  if (
    message.includes("sung_calibration_unavailable") ||
    message.includes("e107_sung_audio_required") ||
    message.includes("too speech-like")
  ) {
    return result(
      "local_capture_terminal",
      false,
      false,
      "none",
      "recapture",
      "bad_sung_audio",
    );
  }
  return result(
    "unknown",
    false,
    false,
    "manual_review",
    "contact_support",
    "unknown",
  );
}

module.exports = {
  classifySunoPersonaFailure,
};
