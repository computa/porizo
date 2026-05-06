# Verification: HIGH (Routes + Migrations + iOS, H12-H30)

## H12 — Enrollment-complete transaction atomicity in PG

**Status: FIXED**

- Evidence: `src/routes/enrollment.js:1407-1565` wraps state mutations in `db.transaction(async (query) => { const txDb = dbFromQuery(query); ... })`. `dbFromQuery` (line 235-256) wraps the passed `query` function. `cancelVoiceProviderJobsForVoiceProfile`, `softDeleteProviderProfilesForVoiceProfile`, `createPendingProviderProfile`, `createVoiceProviderJob` accept `db` as first arg and use `db.prepare(...).run/get` — compatible with the txDb adapter.
- Gap: Embedding download + ElevenLabs clone (1270-1381) intentionally before transaction; not atomic with profile insert (outside scope).

## H13 — `/voice/enrollment/complete` idempotency

**Status: FIXED**

- Evidence:
  1. Early guard `enrollment.js:1052-1060`: `if (session.status !== "recording" && session.status !== "processing") sendError(reply, 409, "SESSION_ALREADY_FINALIZED", ...)`.
  2. Unique partial index in `migrations/099_voice_provider_integrity.sql:7-10` (SQLite) and `migrations/pg/099_voice_provider_integrity.sql:12-15` (PG): `idx_voice_provider_profiles_pending_unique ON (voice_profile_id, provider) WHERE status IN ('pending','upload_submitted','cover_submitted','persona_submitted') AND deleted_at IS NULL`.

## H14 — Persona preflight ordering

**Status: FIXED**

- Evidence:
  - `render_preview`: `tracks.js:806-816` preflight runs BEFORE `:817 if (existingJob && isTerminalFailedJobStatus(existingJob.status))`.
  - `render_full`: `tracks.js:1064-1079` preflight runs after the active-job 202 short-circuit but no terminal-failed branch exists below it.
  - `retry`: `tracks.js:1236-1246` preflight runs before `retryFailedJob()` at :1260.

## H15 — Uniform 422 for SUNO*VOICE_PERSONA*\*

**Status: FIXED**

- Evidence:
  - `tracks.js:811, 1074, 1241` all use `sendError(reply, 422, personaPreflight.code, ...)`.
  - `story.js:3079`: `sendError(reply, 422, code, message, ...)` for the three persona codes.
  - `enrollment.js`: no SUNO*VOICE_PERSONA*\* sends (grep returns 0).
- Gap: `VOICE_PROFILE_REQUIRED` is 403 in story.js:3047 vs 422 in tracks.js:351 — separate code, outside H15's scope.

## H16 — Webhook configuration safety

**Status: FIXED**

- Evidence:
  1. Auto-append: `suno.js:15-45` `appendToken(url)` parses + sets `?token=<secret>` if absent.
  2. Length-validate >=32: `suno.js:21-25` throws `E302_SUNO_CALLBACK_NOT_CONFIGURED` if secret <32 chars; mirrored in route at `internal-suno-callback.js:106-113` (returns 503).
  3. Startup check: `server.js:4840-4846` — when LIVE_PROVIDERS=true, warns if secret unset and throws if <32 chars.
  4. SAFETY block: `internal-suno-callback.js:12-18` documents no-mutation contract; HMAC + token timing-safe at :120-142.

## H17 — `user_voice_engine` documented

**Status: FIXED**

- Evidence: `docs/api/voice-persona-contract.md:5-7` documents the field for both `render_preview` and `render_full`.

## H18 — `/voice/profile` gating for old iOS

**Status: FIXED**

- Evidence: `enrollment.js:1666-1674` — `parsePorizoBuild(request.headers["user-agent"])` (defined :258-261), `legacyClientNeedsPersonaGate = appBuild < 110`, then maps profile.status `"active"` → `"preparing"` when persona not ready and client is legacy. Build >=110 gets raw status.

## H19 — `voice_provider_profile.status` enum documented

**Status: FIXED**

- Evidence: `docs/api/voice-persona-contract.md:18-32` lists closed enum (pending, upload_submitted, cover_submitted, persona_submitted, active, failed, cancelled, manual_cleanup_required, deleted, consent_required, source_audio_unavailable). iOS ErrorHandler.swift uses catch-all `default` cases.
- Gap: iOS-side doesn't expose explicit "unknown status fallback" at the model layer (verification limited to docs requirement).

## H20 — iOS ErrorHandler maps E302_SUNO_PERSONA_REQUIRED

**Status: FIXED**

- Evidence: `ErrorHandler.swift:390` — `case "SUNO_VOICE_PERSONA_SETUP_REQUIRED", "E302_SUNO_PERSONA_REQUIRED", "E302_SUNO_PERSONA_PROFILE_MISSING":` returns user-actionable validation message + "Set Up My Voice" CTA. Adjacent E302_SUNO_PERSONA_NOT_READY (:376) and E302_SUNO_PERSONA_FAILED (:383) also mapped.

## H21 — iOS User-Agent format

**Status: FIXED**

- Evidence: `APIClient.swift:255` returns `"PorizoApp/\(version)(\(build); iOS)"`. Server parser `enrollment.js:259` `/PorizoApp\/[^(]+\((\d+)/i` matches and captures build. `; iOS)` segment preserved.

## H22 — Tests for `resolveSunoPersonaForRender` 4 guard branches

**Status: NOT FIXED**

- Evidence: `runner.js:1986-2030` defines 4 guards; grep `resolveSunoPersonaForRender` in test/ returns 0 matches. Function is closure-scoped (not exported), making direct unit testing impossible without refactor.
- Gap: All four guard branches remain untested.

## H23 — FK constraints

**Status: FIXED**

- Evidence:
  - PG: `migrations/pg/099:17-50` adds 5 FKs (`NOT VALID` for online migration).
  - SQLite: `migrations/097:3-4,39,41` declares REFERENCES inline at table creation.

## H24 — CHECK constraints on voice_provider_jobs.status / step

**Status: FIXED**

- Evidence:
  - PG: `migrations/pg/099:60-78` adds `voice_provider_jobs_status_check` (`pending|running|completed|failed|cancelled`), `voice_provider_jobs_step_check` (`prepare_persona|generate_persona|persona_active|completed`), and provider check.
  - SQLite: `migrations/097:43,45` declares same CHECK inline.

## H25 — SQLite ADD COLUMN idempotency

**Status: FIXED**

- Evidence: `migrations/098` is single-statement (`ALTER TABLE enrollment_sessions ADD COLUMN consent_scopes TEXT;`). `src/database/sqlite.js:160-189` runs without per-migration transaction, but single-statement migrations have atomic outcome. Migration comment :7-10 acknowledges this. PG runner wraps in transaction.
- Gap: SQLite runner has no per-migration transaction wrapping. Future multi-ALTER SQLite migrations would still be at risk (generic concern, not specific to 098).

## H26 — Backfill scope for consent_scopes

**Status: FIXED**

- Evidence: `migrations/pg/098:13-14` comments "Existing rows intentionally remain NULL. Persona consent is granted only by an enrollment request payload, not by retroactively copying provider rows." File contains only `ADD COLUMN IF NOT EXISTS consent_scopes TEXT` and a CHECK — no UPDATE backfill. SQLite mirror also no backfill.

## H27 — uploadTask cancellation handle (iOS)

**Status: FIXED**

- Evidence: `EnrollmentFlowView.swift:45` `@State private var uploadTask: Task<Void, Never>?`; `:600 uploadTask = Task { ... }`; `:599` cancels prior; `:90-94 .onDisappear { uploadTask?.cancel() }`.

## H28 — Blocking MainActor with file I/O (iOS)

**Status: FIXED**

- Evidence: `EnrollmentFlowView.swift:602-608` — `try await Task.detached(priority: .userInitiated) { let data = try Data(contentsOf: url); let checksum = SHA256.hash(data: data); ...; return (data, checksum) }.value`. File read + SHA256 hash off MainActor.

## H29 — pollingTask reset cancellation (iOS)

**Status: FIXED**

- Evidence: `EnrollmentFlowView.swift:659 pollingTask?.cancel()` before `:660 pollingTask = Task { ... }`. Also cancelled in onDisappear at `:92`.

## H30 — Polling timeout UX (iOS)

**Status: FIXED**

- Evidence: `EnrollmentFlowView.swift:747-753` — `guard !Task.isCancelled else { return }; await MainActor.run { errorMessage = "Voice profile is still processing. You can check back from Settings."; showingError = true; dismiss() }`. No reset to `.welcome`. Same pattern at :735-742 for 5-consecutive-failures branch.

**Tally: 18 FIXED · 1 NOT_FIXED**
