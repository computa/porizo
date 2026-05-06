# Verification: BLOCKERS

## B1 — Legacy iOS consent fallback

**Status: FIXED**

- Evidence: `src/routes/enrollment.js:143-166` defines `resolvePersonaConsentScopes(body, consentAccepted)` granting `voice_suno_persona_v1` when `consentAccepted === true && body.consent_version === "1.0"` (legacy iOS payload).
- Called from `/voice/enrollment/start` at `src/routes/enrollment.js:559-562` and `/voice/enrollment/complete` late-grant at `src/routes/enrollment.js:983-1001`.
- Gaps: No feature flag was added for runtime kill-switch (was offered as optional). The complete-handler late-grant is gated behind `if (!session.consent_scopes)`, so any session that failed to record scope at /start is rescued at /complete.

## B2 — Pipeline whitelist deploy safety

**Status: FIXED**

- Evidence: `migrations/099_voice_provider_integrity.sql:12-21` (SQLite) and `migrations/pg/099_voice_provider_integrity.sql:80-89` (PG) both contain UPDATE that cancels in-flight `track_versions` with legacy pipeline strings (`provider_audio_personalized_convert`, `guide_tts_and_voice_convert`) using LIKE patterns covering both quoted forms.
- `PERSONALIZED_PIPELINES` whitelist in `src/workflows/render-contract.js:130` remains `{SUNO_VOICE_PERSONA_PIPELINE}` only.
- Gaps: LIKE-based JSON match is brittle (newline/tab in JSON would miss); `JSON.stringify` doesn't introduce those, so OK. Brief deploy-window race exists between server start and migration completion where an in-flight tick could trigger `E302_PERSONALIZED_DIVERSION`. Acceptable for deploy-time race.

## B3 — iOS E302\_ prefix

**Status: FIXED**

- Evidence: `PorizoApp/PorizoApp/Controllers/RenderController.swift:854-870` now matches BOTH prefixed and non-prefixed codes:
  - `SUNO_PERSONA_NOT_READY`, `E302_SUNO_PERSONA_NOT_READY`, `SUNO_VOICE_PERSONA_REQUIRED` → `("input_missing", "wait_for_persona")`
  - `E302_SUNO_PERSONA_CONSENT_REQUIRED`, `E302_SUNO_PERSONA_REQUIRED`, `E302_VOICE_PROFILE_REQUIRED`, `E302_SUNO_PERSONA_PROFILE_MISSING` → `("input_missing", "enroll_voice")`
  - `E302_PERSONALIZED_VOICE_CONVERSION_DISABLED`, `E302_SUNO_PERSONA_FAILED` → `("input_missing", "switch_voice_mode")`
- Server still emits prefixed codes (`runner.js:1993, 2005, 2010, 2015, 2817, 2860, 2864`). iOS uppercases for case-insensitive match.
- Gaps: Old iOS builds (105–109) still misclassify — fix helps build 110+ only. Server-side prefix strip would have helped legacy clients but path chosen was iOS-side update. Practical impact limited to UX wording for old clients hitting catch-all retry.
