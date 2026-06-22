# Feature Audit: Voice Enrollment & Voice Profiles

**Domain:** Voice Enrollment, Voice Profiles, Provider Profiles  
**Audit date:** 2026-06-22  
**Auditor:** Claude Code (feature-discovery pass — read-only)  
**Scope:** Backend only (Node.js + Fastify + PostgreSQL)

---

## Key files surveyed

| File                                                       | Role                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/routes/enrollment.js`                                 | All enrollment HTTP endpoints                                              |
| `src/services/enrollment-session-service.js`               | Session & prompt helpers                                                   |
| `src/services/enrollment.js`                               | `validateEnrollmentAudio` — QC orchestration                               |
| `src/services/audio-preprocessing.js`                      | FFmpeg noise-suppress / normalize / VAD pipeline                           |
| `src/services/audio-quality.js`                            | `assessAudioQuality`, `calculateQualityGrade`, thresholds                  |
| `src/services/voice-provider-profile-service.js`           | CRUD + state machine for `voice_provider_profiles` / `voice_provider_jobs` |
| `src/services/content-filter.js`                           | Text moderation, injection detection, normalization                        |
| `src/providers/moderation.js`                              | Impersonation pattern matching, voice-cloning prevention                   |
| `src/providers/whisper.js`                                 | OpenAI Whisper transcription                                               |
| `src/providers/seedvc.js`                                  | Seed-VC zero-shot voice conversion (Gradio)                                |
| `src/providers/replicate.js`                               | ECAPA-TDNN embedding extraction + RVC voice conversion                     |
| `src/providers/elevenlabs-voice.js`                        | ElevenLabs Instant Voice Clone creation/deletion                           |
| `migrations/pg/001_init.sql`                               | Core schema: `voice_profiles`, `enrollment_sessions`                       |
| `migrations/pg/039_voice_quality_tiers.sql`                | `quality_tier`, `quality_metrics_json`, feature flags                      |
| `migrations/pg/097_voice_provider_profiles.sql`            | `voice_provider_profiles`, `voice_provider_jobs` tables                    |
| `migrations/pg/098_enrollment_sessions_consent_scopes.sql` | Consent scope columns                                                      |
| `migrations/pg/099_voice_provider_integrity.sql`           | Provider integrity constraints                                             |
| `migrations/pg/118_granted_identities.sql`                 | `granted_identities` (voice persona consent)                               |

---

## DB tables touched

`users`, `enrollment_sessions`, `voice_profiles`, `voice_provider_profiles`, `voice_provider_jobs`, `granted_identities`, `rate_limits`, `audit_logs`, `feature_flags`

---

## Features

### 1. Enrollment session start

**user_story:** A user begins voice enrollment by accepting consent and receiving a set of prompts with pre-signed upload URLs.

**expected_behavior (VERIFIED):**

- `POST /voice/enrollment/start`
- Risk gate: `blocked` and `high` risk levels are rejected with `403 ACCOUNT_BLOCKED`
- Consent gate runs _before_ rate-limit consumption (gap-2 fix — prevents DoS on quota)
- Rate limit: 25 sessions / 24 h per user (`enrollment_start` action)
- Prompt set generated via `enrollment-session-service` (spoken phrases + sung calibration prompts)
- Session created with status `recording`; `expires_at` set
- Response includes `session_id`, `prompts`, `upload_urls`, `recording_settings` (`44100 Hz, mono, WAV, max 20s/chunk`)
- Audit entry created (`enrollment_started`)

**status:** implemented

**gaps:**

- No check that an already-active enrollment session for the same user is cancelled/superseded; a user can have multiple `recording` sessions open simultaneously
- `upload_urls` are pre-signed — expiry handling if user takes longer than the pre-sign TTL is not verified in code
- `consent_version` defaults to `"1.0"` if omitted by client — no enforcement that the client sends the canonical current version

**key_files:** `src/routes/enrollment.js` (enrollmentStart handler), `src/services/enrollment-session-service.js`  
**db_tables:** `enrollment_sessions`, `rate_limits`, `audit_logs`

---

### 2. Chunk upload (debug route)

**user_story:** The iOS client uploads individual recorded WAV chunks during the enrollment session.

**expected_behavior (VERIFIED):**

- `POST /voice/enrollment/chunk_upload` (multipart) — gated behind `enableDebugRoutes` flag
- Reads raw WAV bytes; parses RIFF header to compute `duration_sec`
- Writes to `storage/enrollment/raw/{userId}/{sessionId}/{chunkId}.wav`
- Updates `enrollment_sessions.chunk_count` and `quality_metrics` JSON per chunk
- Returns `{ status: "accepted", chunk_id, duration_sec }`

**status:** partial — route is **debug-only** (`enableDebugRoutes`). Production clients upload directly to pre-signed storage URLs; the chunk-uploaded notification endpoint (`POST /voice/enrollment/chunk_uploaded`) updates metadata without file handling.

**gaps:**

- No maximum chunk size validation on the debug route (unbounded `Buffer.concat`)
- Duration calculation silently returns `0` for non-WAV or malformed headers — no client error
- `chunk_uploaded` notification endpoint: no signature/token verification that the upload actually happened vs. a spoofed notification
- No deduplication: posting the same `chunk_id` twice increments `chunk_count` again

**key_files:** `src/routes/enrollment.js` (chunk_upload + chunk_uploaded handlers)  
**db_tables:** `enrollment_sessions`

---

### 3. Audio preprocessing pipeline

**user_story:** Raw enrollment recordings are cleaned (denoised, normalized, VAD-trimmed) before QC analysis.

**expected_behavior (VERIFIED):**

- `preprocessBatch` in `audio-preprocessing.js` runs per-chunk: noise suppression → loudnorm (`-20 LUFS, -1.5 TP`) → VAD trim (`-40 dB threshold`) via FFmpeg
- Sung prompts use different parameters (`isSung=true`)
- `useEnhancedPipeline` flag triggers a stacked filter pipeline
- Feature flags control strategy: `voice_enrollment_preprocessing_strategy` (`ffmpeg|ml_server|hybrid`), `voice_enrollment_ml_provider` (`deepfilternet|resemble|adobe`)
- Output written to `storage/enrollment/clean/{userId}/{sessionId}/clean.wav`

**status:** implemented (FFmpeg path); ML/hybrid paths are feature-flagged but implementation status of the ml_server branch is unknown from this pass.

**gaps:**

- FFmpeg child process failures propagate as thrown errors but there is no retry logic within the preprocessing step itself
- No disk-space guard before writing preprocessed audio
- `ml_server` and `hybrid` strategies are referenced in feature flags but their concrete implementation in the source was not confirmed implemented
- Preprocessed audio (`clean.wav`) is never explicitly scheduled for deletion; only raw chunks are mentioned for 7-day deletion in spec, but no cron/job implementing that deletion was found in this pass

**key_files:** `src/services/audio-preprocessing.js`  
**db_tables:** `feature_flags`

---

### 4. QC processing (VAD / clipping / SNR analysis)

**user_story:** After preprocessing, each audio chunk is analyzed for acoustic quality to determine if it meets enrollment standards.

**expected_behavior (VERIFIED):**

- `assessAudioQuality` in `audio-quality.js` computes: `snr_db`, `clipping_ratio`, `vad_ratio`, `reverb_score`
- Thresholds differ by prompt type:
  - Spoken: `minSnr=12`, `maxClipping=0.05`, `maxReverb=0.6`, `minVadRatio=0.15`
  - Sung: `minSnr=8`, `maxClipping=0.08` (relaxed)
- VAD uses `parseWavBuffer` to handle extended WAV headers (iOS JUNK/LIST chunks)
- Grades: A (≥80), B (≥60 → "good"), C (≥40 → "fair"), F (<40 → "minimal")
- `validateEnrollmentAudio` in `enrollment.js` aggregates chunks; minimum total duration: 10 s; SNR threshold: 15 dB; clipping threshold: 5%
- Minimum acceptable grade for passing enrollment: `C`

**status:** implemented

**gaps:**

- `assessAudioQuality` throws on parse errors — caught upstream in `enrollment.js` but error propagation to the client relies on the caller not swallowing it
- No per-chunk failure granularity returned to client; if 1 of 6 chunks is bad, the aggregate may still pass while masking a problem chunk
- Reverb score computation method not independently verified (internal algorithm, no cross-validation)
- Sung threshold relaxation controlled by feature flag `voice_enrollment_sung_threshold_relaxation` — if flag is off, sung prompts are graded with spoken thresholds (likely too strict)

**key_files:** `src/services/audio-quality.js`, `src/services/enrollment.js`  
**db_tables:** `enrollment_sessions`

---

### 5. Enrollment complete & quality gate

**user_story:** After recording, the user submits their session for final QC scoring and voice profile creation.

**expected_behavior (VERIFIED):**

- `POST /voice/enrollment/complete`
- Fetches session (must be `recording` status and belong to current user)
- Runs `validateEnrollmentAudio` → `assessAudioQuality` → `calculateQualityGrade`
- Hard gate: `qualityScore < 70` OR `qcResult.passed === false` OR `grade === "F"` → `422 E101_AUDIO_TOO_NOISY`; session set to `failed_quality`
- Passes: quality tier computed (`excellent`/`good`/`fair`/`basic`/`minimal` from grade)
- ElevenLabs Instant Voice Clone created if `ELEVENLABS_API_KEY` set and clean audio exists (non-fatal on failure)
- Upsert logic: existing active profile compared by `quality_score`; outcome tagged `new|upgraded|replaced`
- New `voice_profile` inserted with status `pending_provider` (if Suno persona will be queued) or `active`
- Suno persona job enqueued if `shouldQueueSunoPersona && hasProviderConsent && cleanAudioReady && sunoPersonaAudioUploaded`
- DB transaction covers: voice_profile upsert, old profile status update, voice_provider_profile creation, voice_provider_job creation
- Audit entry created (`enrollment_completed`)
- Session set to `completed`

**status:** implemented

**gaps:**

- ElevenLabs clone creation happens **outside** the DB transaction — if it succeeds but the transaction rolls back (e.g. duplicate profile insert), the ElevenLabs voice is orphaned and never deleted
- `sunoPersonaAudioUploaded` flag depends on a prior upload step; if that upload silently fails (non-throwing), `shouldEnqueuePersona` is false but no user-visible indication is given
- Re-enrollment: if a user re-enrolls with a _lower_ quality score, the old profile is `replaced` (not preserved), even if the new recording is worse — the `outcome` field records this but there is no warning to the user
- Rate limit for the `/complete` endpoint itself: not found in this pass — only `/start` and `/chunk_upload` are rate-limited; a user could POST `/complete` repeatedly against the same session

**key_files:** `src/routes/enrollment.js` (enrollmentComplete handler), `src/services/enrollment.js`, `src/services/audio-quality.js`  
**db_tables:** `enrollment_sessions`, `voice_profiles`, `voice_provider_profiles`, `voice_provider_jobs`, `audit_logs`

---

### 6. Voice profile status lifecycle

**user_story:** A user's voice profile progresses through statuses as the system processes and activates it.

**expected_behavior (VERIFIED):**

- Statuses observed in code: `pending_provider` → `active`; `deleted` (soft-delete)
- `voice_provider_profiles` has its own state machine: `pending` → `upload_submitted` → `cover_submitted` → `persona_submitted` → `ready` (and error states)
- `voice_provider_jobs` tracks individual async steps: `prepare_persona` step with `maxAttempts=8`
- Job state: `pending` → `running` (with optimistic lock: `attempts < max_attempts`) → `succeeded|failed`
- `markVoiceProviderJobRunning` uses `WHERE status = ? AND attempts < max_attempts` — prevents over-run but does not use a distributed lock

**status:** implemented

**gaps:**

- No `expired` status for profiles — a `pending_provider` profile that never completes (e.g. Suno API permanently down) stays `pending_provider` indefinitely
- No dead-letter / max-attempts exhaustion handler found for `voice_provider_jobs` — job silently stops retrying but user's profile stays `pending_provider` with no notification
- Concurrent enrollment completions for the same user are possible (no `SELECT FOR UPDATE` on profile upsert); the transaction protects DB integrity but could produce two active profiles briefly
- `voice_provider_profiles.deleted_at` is checked on all transitions but orphan cleanup (deleting profiles for deleted users) not verified

**key_files:** `src/services/voice-provider-profile-service.js`  
**db_tables:** `voice_profiles`, `voice_provider_profiles`, `voice_provider_jobs`

---

### 7. Voice embedding extraction (Replicate / ECAPA-TDNN)

**user_story:** The system extracts a 256-dim voice embedding from clean enrollment audio via Replicate API, stored as `embedding_ref` on the voice profile.

**expected_behavior (VERIFIED):**

- `extractEmbedding` in `replicate.js`: posts `{ audio: audioUrl }` to Replicate ECAPA-TDNN model
- `waitForPrediction` with exponential backoff polling (`pollingConfig` not fully visible but backoff structure confirmed)
- Returns `{ embedding_url, prediction_id }`
- `embedding_url` stored as `voice_profiles.embedding_ref`
- `modelVersion` is a required parameter — no default hardcoded in the provider; caller must supply

**status:** implemented (provider layer); integration into enrollment complete flow — embedding is stored on the voice profile but the actual call site in the enrollment route was not directly observed (may be in the worker/runner rather than the route). Status: **partial** — endpoint-to-embedding wiring requires runner verification.

**gaps:**

- `audioUrl` for embedding must be a public URL — for local filesystem storage this means a temp URL or base64 payload, mechanism not confirmed
- No local caching of embedding bytes — only URL stored; if Replicate URL expires, embedding is unrecoverable without re-enrollment
- Model version hash is caller-supplied — no validation that it matches the expected ECAPA-TDNN model; wrong version would produce silently incorrect embeddings
- Timeout is caller-specified; no default guard in the provider against indefinite polling

**key_files:** `src/providers/replicate.js`  
**db_tables:** `voice_profiles`

---

### 8. Quality scoring and tier assignment

**user_story:** The system assigns a numeric quality score (0–100) and a tier label that controls downstream voice conversion parameters.

**expected_behavior (VERIFIED):**

- `calculateQualityGrade` maps score to grade: A (≥80), B (≥60), C (≥40), F (<40)
- Tiers: `excellent` (≥80), `good` (≥60), `fair` (≥40/C), `basic` (≥20), `minimal` (<20)
- `QUALITY_TIERS` drives Seed-VC parameters: `diffusionSteps` (25→150), `cfgRate` (0.7→0.3), `lengthAdjust` (1.0)
- Gate: score ≥ 70 required to pass enrollment (enforced in route, not in service)
- `voice_enrollment_sung_weight` feature flag (default 0.6) weights sung vs spoken contributions

**status:** implemented

**gaps:**

- Quality score gate (≥70) is enforced in the route layer only — the service `validateEnrollmentAudio` returns `passed: true/false` based on different thresholds (SNR/clipping), creating two independent pass criteria that must both align; mismatch is possible
- Sung weight flag applied at the feature-flag layer but no fallback if flag read fails
- `GRADE_VALUES` export used externally — if the grade-to-value map changes, callers using cached values would silently drift

**key_files:** `src/services/audio-quality.js`, `src/routes/enrollment.js`  
**db_tables:** `voice_profiles`, `feature_flags`

---

### 9. Voice provider profile creation (Suno persona)

**user_story:** After successful enrollment, the system asynchronously creates a Suno voice persona using the user's sung calibration audio, enabling high-quality voice-matched song generation.

**expected_behavior (VERIFIED):**

- Triggered if: `shouldQueueSunoPersona && hasProviderConsent && cleanAudioReady && sunoPersonaAudioUploaded`
- `createPendingProviderProfile` inserts `voice_provider_profiles` row (status: `pending`)
- `createVoiceProviderJob` inserts job with `step=prepare_persona`, `maxAttempts=8`
- Job step data: `providerProfileId`, `sessionId`, `userId`, `model` (default `V5_5`), `audioWeight` (default 0.85), `vocalWindow`, `sourceAudioKey`
- State machine transitions: `pending` → `upload_submitted` → `cover_submitted` → `persona_submitted` → `ready`
- `voice_profiles.status` set to `pending_provider` during this phase; transitions to `active` when job completes

**status:** implemented (job creation & state machine); worker that processes the job steps (upload, cover, persona) is in workflow runner — not audited in this pass.

**gaps:**

- If Suno API is unavailable for extended period, `maxAttempts=8` exhausts and profile stays `pending_provider` with no user notification path found
- `vocalWindow` (the best sung segment) is extracted from the sung calibration audio before the transaction; if extraction logic changes the window is not re-derivable without re-enrollment
- No rollback of Suno persona if ElevenLabs clone creation subsequently fails (they are independent but both affect `voice_profiles`)
- `consent_scopes` / `REQUIRED_CONSENT_SCOPE` required for persona; if user revokes consent after enrollment, the pending job continues processing

**key_files:** `src/routes/enrollment.js`, `src/services/voice-provider-profile-service.js`  
**db_tables:** `voice_provider_profiles`, `voice_provider_jobs`, `voice_profiles`, `granted_identities`

---

### 10. ElevenLabs voice clone creation

**user_story:** The system creates an ElevenLabs Instant Voice Clone from the user's clean enrollment audio for potential use in guide vocal generation.

**expected_behavior (VERIFIED):**

- `createVoiceClone` in `elevenlabs-voice.js`: multipart POST to `https://api.elevenlabs.io/v1/voices/add`
- Requires: `apiKey`, local `audioPath` (must exist on disk), `name`
- Name pattern: `porizo_user_{userId[0:8]}_{profileId[0:8]}`
- `voice_id` stored in `voice_profiles.elevenlabs_voice_id`
- Failure is **non-fatal** (caught, logged, enrollment continues)
- Deletion: `deleteVoiceClone` called on voice profile delete (`DELETE /voice/profile`)

**status:** implemented

**gaps:**

- Clone creation is outside the DB transaction — orphan ElevenLabs voice on transaction rollback (noted in feature 5)
- No retry on transient ElevenLabs API errors (single attempt, failure swallowed)
- No periodic reconciliation to detect ElevenLabs voices that were created but whose `voice_profiles.elevenlabs_voice_id` was never saved (due to crash between API call and DB write)
- `audioPath` references local filesystem — in production (Railway), the clean audio must be present at the path; if ephemeral disk is cleared before the `/complete` call, clone creation silently fails

**key_files:** `src/providers/elevenlabs-voice.js`, `src/routes/enrollment.js`  
**db_tables:** `voice_profiles`

---

### 11. Impersonation detection & risk gating

**user_story:** The system prevents users from attempting to clone celebrity or artist voices by detecting impersonation phrases and blocking high-risk accounts.

**expected_behavior (VERIFIED):**

- `moderation.js` defines `IMPERSONATION_PATTERNS`: `/sounds?\s+like/i`, `/in\s+the\s+style\s+of/i`, `/impersonate/i`, `/pretend\s+to\s+be/i`, `/voice\s+of/i`, `/sings?\s+like/i`, `/copy\s+(the\s+)?voice/i`, `/mimic/i`, `/imitat(e|es|ing)/i`
- Semantic patterns (`SEMANTIC_IMPERSONATION_PATTERNS`): only flagged when combined with person/artist name context
- `VIBE_ALLOWLIST` prevents false positives for generic phrases ("summer vibe", "chill vibe", etc.)
- `content-filter.js`: `moderateContent`, `moderateLyrics`, `sanitizeForPrompt`, `detectInjection`
- Risk levels (`users.risk_level`): blocked, high, medium, low
- Enrollment blocked for `blocked` and `high` risk users at session start

**status:** implemented (text-pattern layer). Whisper transcription provider exists but it was not confirmed in this pass that enrollment audio is transcribed and scanned for impersonation at the audio layer.

**gaps:**

- Impersonation detection operates on text inputs (prompts, lyrics) — no confirmed audio-layer check that enrollment recordings do not contain "sound like Taylor Swift" spoken by the user
- `IMPERSONATION_PATTERNS` are static regex; no ML-based artist-name entity extraction confirmed
- Semantic patterns require combined artist-name context but artist name detection logic (how names are identified) not verified
- No re-evaluation of existing voice profiles when a user's risk level is elevated post-enrollment

**key_files:** `src/providers/moderation.js`, `src/services/content-filter.js`  
**db_tables:** `users`

---

### 12. Re-enrollment & rate limits

**user_story:** Users can re-enroll to upgrade their voice profile quality, subject to rate limits.

**expected_behavior (VERIFIED):**

- Rate limits enforced: `enrollment_start` → 25/24h; `voice_profile_delete` → 1/60s
- Re-enrollment flow: `/complete` detects existing active profile via `SELECT id, quality_score WHERE status = 'active'`; `outcome` set to `upgraded` (new score > old) or `replaced` (new score ≤ old)
- Old profile is updated/superseded within the transaction
- No explicit "minimum cooldown between enrollments" beyond the 25/24h session budget

**status:** implemented

**gaps:**

- `POST /voice/enrollment/complete` has no rate limit of its own — a client can open a session (costs 1 of 25 daily), then POST `/complete` many times against the same `session_id`; server will re-run QC each time
- No user notification when a re-enrollment _downgrades_ quality (replaced with lower score)
- No historical record of previous voice profiles retained (old profile row is modified in-place, not archived)
- The 25/24h limit was raised from original 10/24h spec; if abuse is detected at 25, there is no adaptive tightening mechanism

**key_files:** `src/routes/enrollment.js`  
**db_tables:** `enrollment_sessions`, `voice_profiles`, `rate_limits`

---

### 13. Voice profile deletion

**user_story:** A user can delete their voice profile, removing all associated data.

**expected_behavior (VERIFIED):**

- `DELETE /voice/profile`
- Rate limit: 1 deletion / 60 s
- Fetches profile where `status != 'deleted'`
- If `elevenlabs_voice_id` present: calls `deleteVoiceClone` (ElevenLabs API) — failure is logged but does not block deletion
- Sets `voice_profiles.status = 'deleted'`; records `deletion_job_id`
- Audit entry created

**status:** implemented

**gaps:**

- Raw enrollment audio (`storage/enrollment/raw/{userId}/`) and clean audio are not deleted in the route — spec says raw recordings auto-delete after 7 days, but no cron/job implementing this was found in the enrollment domain
- `voice_provider_profiles` and `voice_provider_jobs` associated with the deleted profile: no cancellation / soft-delete confirmed in this route; orphan jobs may continue running
- `deletion_job_id` is created but a corresponding background job to purge storage files was not found

**key_files:** `src/routes/enrollment.js`, `src/providers/elevenlabs-voice.js`  
**db_tables:** `voice_profiles`, `audit_logs`

---

### 14. Voice profile read / status endpoint

**user_story:** The iOS app polls for voice profile status to know when enrollment is complete and the voice is ready.

**expected_behavior (VERIFIED):**

- `GET /voice/profile` — returns current profile with `status`, `quality_score`, `quality_tier`, `provider_profile` readiness
- Returns `pending_provider` readiness info including `job_id` for polling
- Returns `null` if no profile exists

**status:** implemented

**gaps:**

- No ETag / conditional GET support — iOS client must poll on a timer; no push/webhook to notify completion
- Response shape when `pending_provider` job has exhausted all attempts is not explicitly handled — client may poll indefinitely

**key_files:** `src/routes/enrollment.js`  
**db_tables:** `voice_profiles`, `voice_provider_profiles`, `voice_provider_jobs`

---

### 15. Memory questions endpoint

**user_story:** The system generates personalized memory questions to prime the lyric generation context during enrollment.

**expected_behavior (VERIFIED):**

- `POST /memory/questions` — generates contextual questions about the recipient
- Rate-limited (rate limit action confirmed, limit value not captured in this pass)
- Returns structured question set for the iOS UI

**status:** implemented (route exists with rate limit); implementation depth not fully audited in this pass.

**gaps:**

- Questions are generated but it is not confirmed whether answers feed back into enrollment session context or only into lyric generation
- No verified connection between memory question answers and `enrollment_sessions` schema

**key_files:** `src/routes/enrollment.js`  
**db_tables:** `rate_limits`

---

### 16. Seed-VC voice conversion (at render time, using enrolled voice)

**user_story:** During song rendering, the user's enrolled clean audio is used as the reference for zero-shot voice conversion via Seed-VC.

**expected_behavior (VERIFIED):**

- `convertVoice` in `seedvc.js`: sends `sourceAudioPath` (guide vocal) + `referenceAudioPath` (enrolled clean audio) to Gradio server (`SEED_VC_BASE_URL`)
- Parameters from quality tier: `diffusionSteps` (25 excellent → 150 minimal), `cfgRate` (0.7 → 0.3), `lengthAdjust` (1.0)
- Default timeout: 300,000 ms (5 min)
- Output saved to `storage/tracks/{userId}/{trackId}/v{n}/user_vocal.wav` (preview) or `user_vocal_full.wav`
- Input validation: track, trackVersion, sourceAudioPath, referenceAudioPath all required

**status:** implemented

**gaps:**

- Gradio server is external (`SEED_VC_BASE_URL`) — no retry logic visible in the provider for transient Gradio failures; single-attempt
- `referenceAudioPath` is the local clean audio path — in Railway ephemeral disk, this file may not survive between deploy cycles without S3 migration (spec: S3 migration is P1/pending)
- No fallback if `SEED_VC_BASE_URL` is not set (throws at runtime, not at startup)
- Sung vs spoken calibration audio selection for the reference is not confirmed — it is unclear whether the best-quality window or the full clean concatenation is used

**key_files:** `src/providers/seedvc.js`  
**db_tables:** _(none directly; uses filesystem)_

---

### 17. Whisper transcription provider

**user_story:** Audio content can be transcribed for moderation or lyric-alignment purposes.

**expected_behavior (VERIFIED):**

- `transcribeAudio` in `whisper.js`: POST to `https://api.openai.com/v1/audio/transcriptions`
- Supports: m4a, mp3, wav, webm, mp4, mpeg, mpga, oga, ogg, flac
- Returns `{ text, language, duration }`
- Timeout: 60,000 ms default
- Language auto-detected if not provided

**status:** implemented (provider only); usage within enrollment/moderation flow not confirmed in this pass — may be used by content-filter or moderation pipeline.

**gaps:**

- No confirmed wiring of Whisper into the enrollment audio moderation path
- API key sourced from env only — no startup check that key is present
- No chunking for audio > Whisper's 25 MB limit

**key_files:** `src/providers/whisper.js`  
**db_tables:** _(none directly)_

---

### 18. Consent scope management (granted_identities)

**user_story:** The system captures structured consent for voice data processing, with scopes for ElevenLabs and Suno persona creation.

**expected_behavior (VERIFIED):**

- `resolvePersonaConsentScopes` called at session start with `consent_accepted` flag
- `consent_scopes` stored on `enrollment_sessions`
- `consent_version` stored; defaults to `"1.0"` if not provided
- `granted_identities` migration (118) adds voice persona consent tracking
- `hasProviderConsent` checked before Suno persona job creation

**status:** implemented

**gaps:**

- Consent version defaulting to `"1.0"` without enforcing client sends the current version risks consent misattribution if the policy changes
- No mechanism found to re-request consent from users who enrolled under an older `consent_version` when policies change
- Consent revocation after enrollment: `granted_identities` row removal does not cancel in-flight `voice_provider_jobs`

**key_files:** `src/routes/enrollment.js`, `src/services/enrollment-session-service.js`  
**db_tables:** `enrollment_sessions`, `granted_identities`

---

## Summary gaps table

| #   | Gap                                                                                                                                                                                     | Severity |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G1  | Raw audio / clean audio deletion: no cron/job found implementing 7-day auto-purge of `storage/enrollment/`                                                                              | High     |
| G2  | ElevenLabs voice orphan risk: clone created outside DB transaction; crash between API call and DB write leaves orphaned EL voice                                                        | High     |
| G3  | `voice_provider_jobs` exhaustion: no dead-letter handler or user notification when `maxAttempts=8` exhausted; profile stays `pending_provider` forever                                  | High     |
| G4  | Local filesystem dependency for Seed-VC reference audio: Railway ephemeral disk + no S3 migration means reference audio may be unavailable at render time                               | High     |
| G5  | No audio-layer impersonation check: Whisper transcription provider exists but is not confirmed wired into enrollment audio scanning; a user could record "sound like [artist]" and pass | Medium   |
| G6  | `/complete` not rate-limited: user can POST complete repeatedly against same session, re-running QC each time                                                                           | Medium   |
| G7  | Chunk notification spoofing: `chunk_uploaded` accepts notifications without verifying the upload actually occurred                                                                      | Medium   |
| G8  | Concurrent enrollment race: no `SELECT FOR UPDATE` on voice profile upsert; simultaneous `/complete` calls could produce two active profiles                                            | Medium   |
| G9  | `pending_provider` has no timeout/expiry: profile can stay in this state indefinitely if provider job permanently fails                                                                 | Medium   |
| G10 | Suno persona consent revocation does not cancel in-flight jobs                                                                                                                          | Low      |
