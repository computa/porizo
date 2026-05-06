# Reviewer: api-contract (breaking changes vs iOS)

## Findings (15 total)

### BLOCKER

1. **[BLOCKER] src/routes/enrollment.js:464-498 — Persona consent gating breaks old iOS clients (build 105+)**
   - Change: New code requires `consent_scopes: ["voice_suno_persona_v1"]` or `voice_suno_persona_consent: true` in `/voice/enrollment/start` and `/voice/enrollment/complete` request bodies before a Suno persona job is queued. Old iOS builds (105–108) do not send these fields.
   - Breaks: iOS < build 110 enrolls voice successfully but never gets `my_voice_ready=true`. Subsequent My Voice render attempts rejected with 422 `SUNO_VOICE_PERSONA_SETUP_REQUIRED` (code their ErrorHandler doesn't recognize until they update). **Silent feature degradation across live install base.**
   - Fix: Treat existing `consent_accepted=true` + `consent_version=1.0` (historical iOS payload) as implicit grant for `voice_suno_persona_v1`, OR add server-side feature flag that defaults old clients to opt-in until build-110 minimum is enforced.

2. **[BLOCKER] src/workflows/render-contract.js:130-132 — `PERSONALIZED_PIPELINES` no longer accepts legacy frozen contracts**
   - Change: `PERSONALIZED_PIPELINES` shrunk from `{provider_audio_personalized_convert, guide_tts_and_voice_convert}` to `{suno_voice_persona_complete_audio}`. `assertPersonalizedContract` will throw `E302_PERSONALIZED_DIVERSION` for any `track_versions.music_plan_json` previously frozen with old pipeline string.
   - Breaks: Any in-flight or paused My Voice job that already wrote `music_plan_json` pre-deploy. On restart/retry, runner throws and surfaces as generic terminal error. **Users lose the song they were generating at deploy boundary.**
   - Fix: Either (a) keep legacy pipeline strings in `PERSONALIZED_PIPELINES` and route to a deprecation pathway, OR (b) ship one-time SQL backfill that nulls/upgrades `render_contract.pipeline` for queued/processing jobs before deploy. Document deploy ordering.

3. **[BLOCKER] PorizoApp/Controllers/RenderController.swift:854 — iOS error code mismatch for persona-not-ready**
   - Change: Server emits `error_code = "E302_SUNO_PERSONA_NOT_READY"` (with `E302_` prefix) per `runner.js:1985,1997,2002,2852`. iOS RenderController checks `normalizedCode == "SUNO_PERSONA_NOT_READY"` (no prefix). **Dedicated branch never matches.**
   - Breaks: When user_voice render fails because Suno persona is still preparing, iOS falls into catch-all `("infra_terminal","retry")` — exactly the misclassification the comment claims to fix. Users see "retry" but retry never succeeds while persona still pending.
   - Fix: Either change iOS check to `normalizedCode == "E302_SUNO_PERSONA_NOT_READY"` (and `E302_SUNO_PERSONA_CONSENT_REQUIRED`), OR strip `E302_` prefix server-side before persisting `error_code`. Apply identically for `E302_VOICE_PROFILE_REQUIRED` and `E302_PERSONALIZED_VOICE_CONVERSION_DISABLED`.

### HIGH

4. **[HIGH] src/routes/tracks.js:822 vs src/routes/story.js:3081 — Inconsistent HTTP status for SAME persona-not-ready condition**
   - Change: tracks.js returns HTTP 422 for `SUNO_VOICE_PERSONA_REQUIRED/FAILED/SETUP_REQUIRED`. story.js returns HTTP 409 for same three codes. tracks.js `/tracks/:id/voice_mode` returns 409 (line 591), `/tracks` POST returns 409 (line 333), `/render_preview` returns 422 (line 822), `/render_full` returns 422 (line 1075).
   - Breaks: Clients that switch on status code branch differently per endpoint. iOS `ErrorHandler.handleAPIError` keys on `code` (string) so message renders, but analytics/retry-policy logic keyed on HTTP status will misclassify across endpoints.
   - Fix: Pick one status (422 — Unprocessable Entity for missing precondition) and apply uniformly across `/tracks` create, `/tracks/:id/voice_mode`, `/tracks/:id/versions/:v/render_preview`, `/render_full`, `/retry`, and `/story/.../lyrics`.

5. **[HIGH] src/routes/tracks.js:951,1198 — New top-level field `user_voice_engine` added to render-start response**
   - Change: `/render_preview` and `/render_full` now return `user_voice_engine: "suno_voice_persona" | null` at top level of 202 response.
   - Breaks: Old clients ignore unknown fields (Swift `Codable` defaults safe). Theoretically nothing on iOS, but contract drift not in spec.
   - Fix: Document `user_voice_engine` in API spec. Confirm no strict-decode usage in iOS.

6. **[HIGH] src/routes/enrollment.js:1459-1476 — `/voice/profile` response gained 3 new top-level fields**
   - Change: GET `/voice/profile` returns `local_voice_ready: bool`, `my_voice_ready: bool`, `voice_provider_profile: { ... } | null`. Old clients ignore unknown fields, but their `hasProfile` computed property keys off `status == "active"` — they treat user as having My Voice ready when persona is still preparing.
   - Breaks: Old iOS shows "My Voice" available, user picks it, render fails with persona-not-ready (which old build doesn't have a handler for in `ErrorHandler.swift`).
   - Fix: Either gate `/voice/profile.status` to NOT return `active` until persona is ready (controlled by `Accept-Version` header or `app_version`), OR add fallback `SUNO_VOICE_PERSONA_*` localized message in old-client error display.

7. **[HIGH] src/routes/enrollment.js:1394 — Enrollment-complete response gained `voice_provider_profile` field with new statuses**
   - Change: `/voice/enrollment/complete` 200 response now includes `voice_provider_profile: { provider, status, id, job_id }` where `status` is `consent_required | source_audio_unavailable | pending | upload_submitted | cover_submitted | persona_submitted | active | failed`. iOS decodes only `voiceProviderProfile.status` as `String?`. Computed accessors (`isMyVoicePreparing`, `isMyVoiceSetupRequired`) only switch on a specific subset.
   - Breaks: A status iOS doesn't enumerate (e.g., `manual_cleanup_required` if added) falls into `default` branch of `isMyVoicePreparing` → false, then `isMyVoiceSetupRequired` returns true via catch-all — incorrect UX.
   - Fix: Document closed enum of statuses in API spec. Add explicit "unknown" handling path in iOS that falls back to `ready` flag.

8. **[HIGH] src/workflows/render-contract.js:60-65 — `buildRenderContract` now THROWS for legacy user_voice without persona engine**
   - Change: When `voiceMode = user_voice` but `userVoiceEngine != "suno_voice_persona"`, `buildRenderContract` throws `E302_SUNO_PERSONA_REQUIRED`. Previously fell through to `guide_tts_and_voice_convert` (Seed-VC pipeline).
   - Breaks: Any caller (test, queued retry, downstream service) calling `buildRenderContract` with legacy shape now gets exception. Legacy retry paths in runner.js could surface this throw as iOS-unfriendly `E302_SUNO_PERSONA_REQUIRED` (not in iOS error map).
   - Fix: Either preserve `seedvc` engine option behind feature flag for in-flight legacy work, OR add `E302_SUNO_PERSONA_REQUIRED` to iOS ErrorHandler with same message as `SUNO_VOICE_PERSONA_SETUP_REQUIRED`.

9. **[HIGH] src/routes/internal-suno-callback.js:55-152 — New unauthenticated webhook depends on env config**
   - Change: New POST `/internal/suno/callback` route. Requires `SUNO_CALLBACK_HMAC_SECRET` env var; returns 503 `CALLBACK_NOT_CONFIGURED` if unset.
   - Breaks: If Suno is configured to call back without env var set on production, every callback returns 503 (Suno retries until circuit breaker; meanwhile no state transitions). Callback is a no-op stub regardless — logs and returns 200, never advances `voice_provider_jobs.status`.
   - Fix: Document required Railway env var. Add startup check that fails fast if `SUNO_VOICE_PERSONA` enabled but `SUNO_CALLBACK_HMAC_SECRET` unset. Document route is intentionally a stub; state advancement happens via polling, not callback.

10. **[HIGH] PorizoApp/APIClient.swift:255 — `User-Agent` format change**
    - Change: From `PorizoApp/X.Y (build Z; iOS)` to `PorizoApp/X.Y(Z)`. Drops `iOS` token and `(build N;)` shape.
    - Breaks: Server-side analytics, CDN routing, or platform-detection regex matching `; iOS)` will silently fail to identify iOS app traffic. None present in diff search but contract has shifted; consumed by external services (logs, Datadog, Sentry).
    - Fix: Restore `(build \(build); iOS)` segment, OR document new UA format and update consumers.

### MEDIUM

11. **[MEDIUM] src/routes/tracks.js:332-358 — `voice_mode` preflight on POST `/tracks` rejects 409 instead of 403 for `user_voice` with no persona**
    - Change: Previous 403 `VOICE_PROFILE_REQUIRED`; now still 403 for missing voice_profile but new 409 for `SUNO_VOICE_PERSONA_REQUIRED/FAILED/SETUP_REQUIRED`.
    - Breaks: Old iOS clients checking only 403 for "voice profile setup needed" fall through to generic error path on 409. Old clients also don't recognize new error codes.
    - Fix: Map all four codes to same status (422) consistently across entire API. **(Overlaps with #4.)**

12. **[MEDIUM] src/routes/enrollment.js:1486-1495 — `/voice/profile` returns `model_version` from a possibly stub**
    - Change: When `shouldEmbed = false` (provider not configured), code writes `"embed_stub"` as model_version. Old contract: real model id when embedding succeeded.
    - Breaks: iOS or admin tooling doing string-equality on `model_version` to known set won't recognize `embed_stub`.
    - Fix: Document stub value. Add to closed enum.

13. **[MEDIUM] src/routes/legal.js:115-131 — `formatSitemapLastmod` exported & sitemap date format normalized**
    - Change: Sitemap `<lastmod>` strictly `YYYY-MM-DD` from any timestamp form. Previously raw first 10 chars of `String(value)` were used; rows where `updated_at`/`published_at` was a Date object emitted `Sun, 03 May` (malformed lastmod).
    - Breaks: This is a fix, not a break — but changes lastmod values crawlers may have indexed. Google may treat as retroactive change to many entries and re-crawl.
    - Fix: No action needed on contract. Monitor Google Search Console for re-crawl spikes.

14. **[MEDIUM] src/routes/story.js:3066-3082 — `requires_voice_enrollment` field added to error details**
    - Change: Error envelope carries `requires_voice_enrollment: bool` typed flag. iOS doesn't currently parse.
    - Breaks: Nothing immediately, but contract has partially-typed error shape that's inconsistent (only persona-related errors carry it).
    - Fix: Either include `requires_voice_enrollment` on ALL error envelopes implying enrollment recovery (default false), OR document as optional hint.

### SUGGESTION

15. **[SUGGESTION] src/routes/internal-suno-callback.js:144-148 — Callback receives no observable state mutation**
    - Change: Callback logs `callback_type` and body size, returns 200. Does NOT update `voice_provider_jobs.status` or `voice_provider_profiles.status`.
    - Breaks: Nothing today but contract trap — operators will assume it advances state; debugging fatigue when persona jobs appear stuck.
    - Fix: Add clear comment block in route AND in `docs/api/internal-callbacks.md` stating this is no-op observability hook, state advancement happens via polling, future state transition MUST add CSRF/replay protection.

## Top 3 to fix before merge

1. **#3** — iOS will mishandle dedicated persona-not-ready error code (prefix mismatch).
2. **#1** — Old iOS builds (105–108) silently lose My Voice capability.
3. **#2** — Pre-deploy in-flight My Voice jobs fail terminally on pipeline whitelist change.
