# B — Song Creation Pipeline: Feature Audit

**Scope:** Story interview → lyrics → music plan → render → tracks (preview + full)
**Date:** 2026-06-22
**Auditor:** Claude Code (automated, read-only survey)
**Branch:** feat/binding-app-only-recipient-first

---

## Index

1. Track Creation (direct / legacy path)
2. Story Interview / Conversation (AI-guided path)
3. Story → Track Conversion
4. AI Memory / Wizard Follow-up Questions
5. Song Readiness Pre-flight Gate
6. Lyrics Generation
7. Lyrics Policy Sanitization
8. Lyrics Manual Edit & Approval
9. Music Plan Generation
10. Content Moderation Gate (R0 / workflow step)
11. Preview Render Workflow (R0-R9 / `preview_render`)
12. Full Render Workflow (F0-F10 / `full_render`)
13. Suno Instrumental Generation
14. Suno Voice Persona Creation & Enrollment
15. Guide Vocal Generation (ElevenLabs TTS)
16. Voice Conversion (Seed-VC / Gradio)
17. Stem Separation (Demucs via Replicate)
18. Whisper Transcription
19. Mix Step
20. Watermark Step
21. Artwork Generation (parallel / barrier)
22. Render Idempotency & Resumability (params_hash memoization)
23. Render Retry (manual retry endpoint)
24. Render Cancel
25. Reroll (lyrics / beat / vocals / section-only)
26. Suno Callback Handler
27. Job Status Polling
28. DLQ (Dead-Letter Queue)
29. Circuit Breaker
30. LLM Provider (generateText, fallback chain)
31. Style Registry & Provider-Style Routing
32. Share Token Creation / Play URL
33. Poem Generation (story-based)

---

### 1. Create Track (Direct / Legacy Path)

**user_story:** As a user, I want to create a song by supplying recipient name, occasion, style, and a personal message directly (without a story interview), so that I can quickly generate a song without the guided flow.

**expected_behavior (VERIFIED):**

- Endpoint: `POST /tracks`
- Auth: required (`requireUserId`)
- Body fields: `title`, `occasion`, `recipient_name`, `recipient_phone`, `recipient_channel`, `style`, `duration_target` (default 60), `voice_mode`, `voice_gender`, `message`, `relationship_type`, `years_known`, `specific_memory`, `special_phrases`, `what_makes_them_special`, `memory_answers[]`
- Moderation check (`moderationCheck`) runs on all text fields at creation time; returns 422 on block
- Voice mode validated; if personalized mode requested and no active voice provider profile → 422 `VOICE_NOT_ENROLLED` or `VOICE_PERSONA_PREPARING`
- Inserts row into `tracks` (status=`draft`), calls `upsertTrackLibraryEntry(origin:'created')`, writes `addAuditEntry(action:'track_created')`
- Returns `{ track_id, status:'draft', voice_mode, created_at }` with HTTP 201
- `story_context_json` built from optional story fields and stored on the track row

**status:** implemented — VERIFIED from `src/routes/tracks.js`

**gaps:**

- No schema validation library (Zod/Joi); field coercion is ad-hoc (`body.title || null`)
- `duration_target` not range-validated beyond JavaScript default
- No deduplication guard on same-user duplicate tracks with identical content
- `memory_answers` accepted but not validated for content/length

**key_files:** `src/routes/tracks.js`, `src/providers/moderation.js`, `src/services/voice-provider-profile-service.js`

**db_tables:** `tracks`, `track_library_entries`, `audit_logs`

---

### 2. Story Interview / Conversation (AI-Guided Path)

**user_story:** As a user, I want to have a guided conversation where the AI asks me questions about the recipient and a memory, progressively building up story context for the song, so that my song feels emotionally specific.

**expected_behavior (VERIFIED):**

- Endpoints registered by `registerStoryRoutes` in `src/routes/story.js`
- `POST /stories` — start new story session: creates DB session, accepts `recipient_name`, `occasion`, `initial_prompt`; calls `writer.startStory()`; returns `story_id`, first question
- `POST /stories/:id` — continue story: accepts `answer`; calls `writer.continueStory()`; runs Labov gap analysis (`computeLabovGapAnalysis`), fact extraction, anti-repetition question targeting; returns next question or `complete:true` + `ready_for_confirmation`
- State machine: `conversation[]` array persisted per session; `turn_count` incremented
- Readiness scoring: Labov weighted score; `can_proceed_anyway` flag lets user skip when score is borderline
- `questionsAsked` tracked for anti-repetition
- Debug endpoints (dev/test only): `GET /debug/story/:id/state`, `POST /debug/story/simulate`, `POST /debug/story/full-round`, `GET /debug/story/:id/transcript`

**status:** implemented — VERIFIED from `src/routes/story.js`, `src/writer/v3/`, `src/writer/index.js`

**gaps:**

- No rate limit on `POST /stories` story creation (unlimited sessions per user)
- No rate limit on `POST /stories/:id` answer endpoint
- Debug endpoints guarded by `NODE_ENV` check but no additional auth; if `NODE_ENV` leaks to production these expose full LLM pipeline
- Story sessions are not garbage-collected; no TTL or cleanup job found
- `writer.startStory` / `writer.continueStory` make LLM calls with no timeout enforcement at the route level (relies on LLM provider's own timeout)

**key_files:** `src/routes/story.js`, `src/writer/index.js`, `src/writer/v3/`, `src/writer/v3/quality.js`

**db_tables:** `stories` (inferred; session state persisted by `writer.getStoryState`)

---

### 3. Story → Track Conversion

**user_story:** As a user, I want to confirm my story and convert it into a track ready for rendering, so that I can proceed to song generation.

**expected_behavior (VERIFIED):**

- Endpoint: `POST /stories/:id/to-track`
- Auth: required
- Body: optional `style`, `gift_reservation_id`, `voice_gender`, `recipient_phone`, `recipient_channel`
- Fetches story context from writer; computes `composedTitle`, builds `storyContext` object via `buildTrackStoryContextPayload()`
- Validates gift funding reservation if `gift_reservation_id` provided
- Validates voice mode / persona readiness (same preflight as direct create)
- Inserts into `tracks` (status=`draft`), inserts first `track_versions` row (`version_num=1`, status=`draft`, render_type=`preview`, `params_json`, `params_hash`)
- If gift-funded: removes track from library entry (recipient picks it up via share), otherwise `upsertTrackLibraryEntry(origin:'created')`
- Writes `addAuditEntry(action:'story_to_track')`
- Returns `{ track_id, version_id, version_num:1, voice_mode }`

**status:** implemented — VERIFIED from `src/routes/story.js` (lines ~1400-1580 area)

**gaps:**

- `params_hash` computed at version creation; if story context changes after this call there is no re-hash path
- No check that story was in `complete` or `can_proceed_anyway` state before conversion (any story session can be converted regardless of readiness score)
- Gift reservation validated but race condition possible: two concurrent calls with same reservation could both pass `validateGiftFunding` before either commits

**key_files:** `src/routes/story.js`, `src/writer/story-context-serialization.js`

**db_tables:** `tracks`, `track_versions`, `track_library_entries`, `audit_logs`

---

### 4. AI Memory / Wizard Follow-up Questions

**user_story:** As a user filling in the direct track creation form, I want the app to generate contextual follow-up questions based on my memory description, so that I provide richer context for lyric generation.

**expected_behavior (VERIFIED):**

- Service: `src/services/memory-questions.js` — `generateMemoryQuestions({ memory, occasion, recipientName })`
- Sanitizes all inputs with `sanitizeForPrompt` before LLM call
- Calls `generateText()` (LLM provider) with a structured prompt targeting 3 question types: EMOTION, SENSORY, RESOLUTION
- Returns 2-3 questions with placeholders as JSON
- Used by `POST /tracks` when `memory_answers[]` are stored

**status:** implemented — service exists and is wired, VERIFIED from `src/services/memory-questions.js`

**gaps:**

- No endpoint-level rate limit on calls to this service (relies on parent route's general limit)
- No caching: same memory+occasion can trigger duplicate LLM calls
- Error from LLM is unhandled at service boundary (throws raw); caller must catch
- No validation that the JSON output actually contains the expected question array shape before returning

**key_files:** `src/services/memory-questions.js`, `src/services/llm-provider.js`

**db_tables:** none (stateless service)

---

### 5. Song Readiness Pre-flight Gate

**user_story:** As the system, I want to assess whether a story has enough detail to produce good lyrics before entering the render pipeline, so that we avoid generating low-quality songs from thin context.

**expected_behavior (VERIFIED):**

- Module: `src/writer/song-readiness.js` — `assessSongReadiness(rawContext)`
- Deterministic (no LLM call); validates: presence of story text, required detail ledger size, prompt budget hard-cap check via `buildSongwriterPrompt`, song contract validity via `validateSongContract`
- Returns `{ ready, status, blockers[], warnings[], follow_up_question, suggestions[] }`
- `blockers`: `missing_story`, `missing_required_story_detail`, `too_many_required_details`, `prompt_budget_hard_cap`
- `warnings`: `high_required_detail_pressure`, `no_required_detail_ledger`, `song_contract_repair_needed`
- Follow-up question auto-generated from first blocker when not ready
- Called by story-to-track route before emitting the track version

**status:** implemented — VERIFIED from `src/writer/song-readiness.js`

**gaps:**

- `assessSongReadiness` result is informational; the to-track endpoint does NOT block conversion on `ready:false` — a caller can proceed with blockers present (only `can_proceed_anyway` is advisory)
- `validateSongContract` triggers `repairSongMapWithProfile` internally; if repair fails silently the warning is emitted but generation still proceeds
- No structured observability: readiness result not stored anywhere for post-hoc analysis

**key_files:** `src/writer/song-readiness.js`, `src/writer/songwriter.js`

**db_tables:** none (pure computation)

---

### 6. Lyrics Generation

**user_story:** As the render pipeline, I want to generate song lyrics from the confirmed story context, so that the songwriter produces personalized, story-grounded lyrics.

**expected_behavior (VERIFIED):**

- Entry point: `generateLyrics()` in `src/providers/lyrics.js`; also called from `src/workflows/runner.js` (`lyrics` step)
- Context built by `buildLyricsContext(track)` in `src/writer/lyrics-context.js` — single source of truth for all fields reaching `generateLyrics`
- Core engine: `src/writer/songwriter.js` — `generateLyricsWithContext()`
  - Up to `SELF_CORRECTION_MAX=3` attempts; each attempt: LLM call → `assessQuality()` (min score 75) → `assessFidelity()` (min score 35/50) → if below threshold, targeted repair
  - Sectioned generation: generates verse1, pre, chorus, verse2, bridge independently when `song_map` contract available; reuses passing sections across repair attempts
  - `validateAndRepairLyrics()` enforces syllable constraints (3-15 per line), recipient name inclusion
  - Lyrics policy sanitizer (`sanitizeLyrics()`) applied after generation to clean policy violations
  - Final output stored as `lyrics_json` in `track_versions`, `lyrics_status` set to `generated`
- Quality gates: `QUALITY_MIN_SCORE=75`, `FIDELITY_MIN_SCORE=35`
- Prompt budget: `LYRICS_LLM_MAX_OUTPUT_TOKENS=3000`, repair at 60% (`≥1500`)
- Story context fields: narrative (up to 12000 chars), facts (up to 40), beats (up to 20), retained details (up to 80), song_map, motifs, atoms, primitives, elements, completed_story_package

**status:** implemented — VERIFIED from `src/writer/songwriter.js`, `src/writer/lyrics-context.js`, `src/providers/lyrics.js`

**gaps:**

- After `SELF_CORRECTION_MAX` attempts, the best-available draft is emitted even if both quality and fidelity are below threshold — no hard failure, just a warning log
- Sectioned generation sequential (verse1→pre→chorus→verse2→bridge): a failure in any section throws and the whole lyrics step fails; no partial-section recovery
- `assessQuality` and `assessFidelity` are local heuristics (not LLM-graded); may miss nuanced failures
- LLM provider timeout (`CONFIG.timeoutMs=30000`) can fire mid-generation; the step will fail and retry from scratch, losing partial output
- No deduplication: if a job is retried, `lyrics_json` is re-generated rather than reused from the memoized field (the memo check is `field: 'lyrics_json'` — only skips the step if `lyrics_json` is already non-null, which is correct but only if the first generation succeeded)

**key_files:** `src/writer/songwriter.js`, `src/providers/lyrics.js`, `src/writer/lyrics-context.js`, `src/writer/story-context-serialization.js`

**db_tables:** `track_versions` (lyrics_json, lyrics_status, lyrics_updated_at)

---

### 7. Lyrics Policy Sanitization

**user_story:** As the platform, I want to automatically sanitize generated lyrics for policy violations (explicit language, provider-blocked terms) before they reach music generation, so that Suno rejects are minimised and platform policy is enforced.

**expected_behavior (VERIFIED):**

- Module: `src/services/lyrics-policy-sanitizer.js` — `sanitizeLyrics(lyrics, recipientName, profile)`
- Iterates all lyrics lines (title, anchor_line, sections[].lines) via `iterateLyricsLines()`
- Per line: checks `hard_block_terms` list, `context_allowlist` exceptions, applies `replacementForViolation()` (case-insensitive substitution)
- Returns `{ lyrics, changed, changes }` — always returns lyrics even if unchanged
- Applied inside songwriter after each generation attempt before quality scoring

**status:** implemented — VERIFIED from `src/services/lyrics-policy-sanitizer.js`

**gaps:**

- Sanitizer operates on hardcoded term lists; no LLM-based policy check for nuanced violations
- `context_allowlist` exceptions are static; a term allowed in one context may slip through in another
- No audit trail: sanitized violations not logged to `audit_logs`
- Sanitizer not applied to `review_edit` (manual lyric edits by user) — users can re-introduce blocked terms manually

**key_files:** `src/services/lyrics-policy-sanitizer.js`

**db_tables:** none

---

### 8. Lyrics Manual Edit & Approval

**user_story:** As a user, I want to read, edit, and approve the generated lyrics before full audio rendering begins, so that I can correct errors and ensure the song reflects my story.

**expected_behavior (VERIFIED):**

- `GET /tracks/:id/versions/:version/lyrics` — returns current `lyrics_json`, `lyrics_status`, approval state
- `PUT /tracks/:id/versions/:version/lyrics` — user-edits lyrics (`review_edit`): updates `lyrics_json`, sets `lyrics_status='review_edit'`, stores edit provenance in `provenance_json`
- `POST /tracks/:id/versions/:version/lyrics/approve` — approves lyrics: validates `lyrics_json` not null, runs moderation check on extracted lyrics text (via `moderationCheck`), also runs `validateGeneratedLyrics`; if passes sets `lyrics_status='approved'`, `lyrics_approved_at`; rate-limited (20/hour)
- Full render (`POST /tracks/:id/versions/:version/render_full`) blocks if `lyrics_status !== 'approved'`

**status:** implemented — VERIFIED from `src/routes/tracks.js`

**gaps:**

- Lyrics edit (`PUT`) does NOT re-run policy sanitizer; user can introduce policy violations that pass through to Suno
- Lyrics edit does NOT re-run Labov fidelity check; a user could radically alter lyrics to remove story references
- No version history for lyrics edits; each edit overwrites `lyrics_json` (provenance_json has a timeline but no full diff)
- `moderation_check` at approval time uses the same regex-based local filter — LLM-based second-pass not applied

**key_files:** `src/routes/tracks.js`

**db_tables:** `track_versions` (lyrics_json, lyrics_status, lyrics_updated_at, lyrics_approved_at, provenance_json)

---

### 9. Music Plan Generation

**user_story:** As the render pipeline, I want to generate a music plan (style, BPM, arrangement notes, section structure) from the track metadata and lyrics, so that instrumental generation receives rich, style-consistent instructions.

**expected_behavior (VERIFIED):**

- Step `music_plan` in both PREVIEW_STEPS and FULL_STEPS
- Calls LLM (`generateText`) to produce structured JSON: style profile, BPM, rhythmic_signature, arrangement_notes, section guidance
- `buildCompactStyleFields()` in `src/providers/music.js` resolves the requested style against `style-registry.js` — maps to `genre_core`, `rhythmic_signature`, `arrangement_notes`, `suno.support` level (weak/medium/strong)
- Result stored as `music_plan_json` in `track_versions`
- Memoized: if `music_plan_json` already set on the version, step is skipped
- For weak/medium-support genres, `rhythmic_signature` injected into Suno style field to anchor the groove

**status:** implemented — VERIFIED from `src/workflows/runner.js`, `src/providers/music.js`, `src/providers/style-registry.js`

**gaps:**

- Music plan is generated by LLM but stored without validation schema; malformed JSON could propagate to Suno
- No fallback if music plan LLM call times out; job fails with retry
- Style registry is a static map; new styles not in the registry fall back to generic defaults silently

**key_files:** `src/workflows/runner.js`, `src/providers/music.js`, `src/providers/style-registry.js`, `src/providers/provider-style-routing.js`

**db_tables:** `track_versions` (music_plan_json)

---

### 10. Content Moderation Gate (Workflow Step)

**user_story:** As the platform, I want every render job to pass a content moderation check before any expensive API calls are made, so that policy violations are caught early and user risk scores are updated.

**expected_behavior (VERIFIED):**

- Step `moderation` is the first step in both `PREVIEW_STEPS` and `FULL_STEPS`
- `moderationCheck(input)` in `src/providers/moderation.js`: checks all text fields (title, recipient_name, message, occasion, relationship_type, specific_memory, special_phrases, lyrics) for:
  - Impersonation patterns (voice-cloning prevention): `/sounds? like/i`, `/voice of/i`, etc.
  - Leet-speak / diacritics evasion via `normalizeText()`
  - Platform policy violations
- `validateGeneratedLyrics(lyrics)` also run post-lyrics-generation
- On block: `track_versions.moderation_status='blocked'`, `track.status='failed'`, `users.risk_level='high'`, `audit_logs` entry for `moderation_blocked`
- `step_data.status_override='blocked'` propagates the block through the runner
- Memoized: if `moderation_status='passed'` already set, step is skipped on resume

**status:** implemented — VERIFIED from `src/workflows/runner.js`, `src/providers/moderation.js`

**gaps:**

- Moderation is regex/keyword-based only; no LLM second-pass for nuanced or obfuscated violations
- User `risk_level` set to `high` on first block with no appeal path in code
- Moderation check at creation time (`POST /tracks`) is redundant with workflow step — creates a window where a track could be created without triggering the workflow-level block if creation check passes but an edited field doesn't
- `validateGeneratedLyrics` implementation not verified in detail; unclear if it adds coverage beyond `moderationCheck`

**key_files:** `src/providers/moderation.js`, `src/services/content-filter.js`, `src/workflows/runner.js`

**db_tables:** `track_versions` (moderation_status, moderation_reason), `tracks` (status), `users` (risk_level), `audit_logs`

---

### 11. Preview Render Workflow (preview_render)

**user_story:** As a user, I want to trigger a preview render that produces a short (15-25s chorus) song file quickly, so that I can hear the song and decide whether to confirm a full render.

**expected_behavior (VERIFIED):**

- Endpoint: `POST /tracks/:id/versions/:version/render_preview`
- Auth required; voice persona preflight (`preflightUserVoiceReadiness`) checks personalized mode prerequisites
- Rate limit: `render_preview_burst` (10/60s), daily limit enforced via entitlements
- Billing: `subscriptionManager.spendSongInTransaction()` atomically deducts 1 song credit before job insert; on failure → 402
- Transaction inserts `jobs` row (workflow_type=`preview_render`, status=`queued`, step=`queued`, max_attempts=3), updates `track_versions.preview_job_id`, sets `tracks.status='rendering'`
- `ALREADY_RENDERING` guard: if active job exists, returns existing `job_id` with 202 instead of creating duplicate
- Artwork job kicked in parallel (fire-and-forget) via `kickArtworkJob()`
- Steps (PREVIEW_STEPS): `moderation → lyrics → music_plan → instrumental → guide_vocal → voice_convert → mix → watermark → ready`
- Runner (`src/workflows/runner.js`) polls DB for `queued` jobs; dispatches steps sequentially; heartbeats `last_heartbeat_at`
- On `ready`: sets `track_versions.status='ready'`, `tracks.status='ready'`, creates share token, generates share URL, returns `preview.m4a` path

**status:** implemented — VERIFIED from `src/routes/tracks.js`, `src/workflows/runner.js`

**gaps:**

- No transaction-level lock on `render_preview` start: the ALREADY_RENDERING check (`findActiveJobForVersion`) and the job INSERT are not in the same DB transaction; concurrent requests could both pass the check
- `spendSongInTransaction` uses SQLite's `WHERE balance>0` atomic guard (correct) but the transaction wraps only the billing + job insert — if the job insert fails after billing deduction, credit is lost (no compensating rollback observed)
- No p95 SLA monitoring in code; p95 < 90s target is aspirational with no alerting
- `max_attempts=3` is hardcoded; no per-step retry differentiation

**key_files:** `src/routes/tracks.js`, `src/workflows/runner.js`, `src/workflows/render-contract.js`

**db_tables:** `jobs`, `track_versions`, `tracks`, `entitlements`, `audit_logs`, `share_tokens`

---

### 12. Full Render Workflow (full_render)

**user_story:** As a user, after approving the preview and lyrics, I want to trigger a full render that produces a complete (45-90s) song, so that I can share a finished song with the recipient.

**expected_behavior (VERIFIED):**

- Endpoint: `POST /tracks/:id/versions/:version/render_full`
- Guards: `PREVIEW_ONLY` feature flag → 403; `moderation_status='blocked'` → 403; `lyrics_status !== 'approved'` → 409
- Updates `stream_base_url` on version before job create
- Steps (FULL_STEPS): `moderation → lyrics → music_plan → instrumental_full → guide_vocal_full → voice_convert_sections → mix → watermark → ready`
- `voice_convert_sections`: section-by-section voice conversion for quality control
- No separate billing step visible at the route level for full render (billing appears to happen at preview render; full render reuses the same version)
- On `ready`: outputs `full.m4a`

**status:** implemented — VERIFIED from `src/routes/tracks.js` (render_full handler), `src/workflows/runner.js` (FULL_STEPS)

**gaps:**

- `billing_holds` table was dropped (migration 095) — the full render has NO credit reservation/hold mechanism; if a user exhausts credits between preview approval and full render start, the render will proceed anyway (no billing guard at render_full time found)
- `instrumental_full` and `guide_vocal_full` excluded from STEP_MEMO_FIELDS (they share DB columns with preview); if full render resumes after partial completion, these steps re-run entirely (no local file check)
- No explicit check that the preview was actually completed before full render is triggered (only lyrics approval is gated)

**key_files:** `src/routes/tracks.js`, `src/workflows/runner.js`

**db_tables:** `jobs`, `track_versions`, `tracks`, `entitlements`

---

### 13. Suno Instrumental Generation

**user_story:** As the render pipeline, I want to generate a music instrumental via the Suno API, so that the song has a professionally produced backing track matching the style and music plan.

**expected_behavior (VERIFIED):**

- Provider: `src/providers/suno.js`
- Builds Suno API payload via `buildSunoPayload()`: style field = rich genre descriptors (up to 120 chars); prompt field = lyrics only (no STYLE GUIDE prefix)
- BPM from music plan injected into style field when available
- `rhythmic_signature` appended for weak/medium-support genres
- Vocal character descriptor injected when `voice_gender` + `styleDef.vocal_character` available
- `[no producer tag]` appended to style prompt
- Optional Suno persona routing: if `sunoPersona` provided and active, uses persona ID for personalized generation
- Polls Suno task status until complete; returns audio URL
- Step: `instrumental` (preview) / `instrumental_full` (full render)

**status:** implemented — VERIFIED from `src/providers/suno.js`

**gaps:**

- Suno API via `sunoapi.org` (third-party proxy) — if sunoapi.org changes its API or rate-limits, the provider has no fallback
- Style field truncated to 120 chars by default; important descriptors may be cut
- No retry with degraded style prompt if Suno rejects due to style field content
- Polling timeout: if Suno takes > `PROVIDER_TIMEOUT_MS`, the step fails with no partial result saved
- Audio ID extraction (`extractSunoAudioId`) handles provisional success states in persona flow but not in instrumental flow — provisional status from Suno during non-persona generation may cause incorrect failure

**key_files:** `src/providers/suno.js`, `src/providers/music.js`

**db_tables:** `track_versions` (instrumental_url)

---

### 14. Suno Voice Persona Creation & Enrollment

**user_story:** As the platform, I want to create a Suno voice persona from a user's enrolled voice so that personalized songs sound like the user's voice via Suno's native persona feature.

**expected_behavior (VERIFIED):**

- Service: `src/services/suno-voice-persona-service.js`
- Provider profile state machine: `pending → upload_submitted → cover_submitted → persona_submitted → active` (or `failed` / `manual_cleanup_required`)
- Steps: upload voice audio (`upload_submitted`), generate cover music (`cover_submitted`), create persona from cover (`persona_submitted`), poll for `active`
- Each transition persists to `voice_provider_profiles` with optimistic locking (`WHERE status IN (...)`)
- Mid-poll cancellation: `shouldAbort` async predicate checked before each poll iteration (H10 fix)
- Failure classification: `src/services/suno-persona-failure-classifier.js` classifies errors into categories: `cancelled`, `auth`, `rate_limit`, `timeout`, `source_audio_retryable`, `policy`, `unknown`
- Consent gate: `hasPersonaConsentScope()` checks user has granted persona consent before using the persona
- `PERSONALIZED_VOICE_MODES` set defined in `render-contract.js` (single source of truth)

**status:** implemented — VERIFIED from `src/services/suno-voice-persona-service.js`, `src/providers/suno-persona.js`

**gaps:**

- Suno persona creation requires a real voice-enrolled user with a valid audio sample; enrollment + persona creation is multi-step async with many failure points
- `source_audio_retryable` category allows retry with new audio ID, but rejected audio IDs are collected in a Set — if all audio IDs are exhausted, the service has no recovery path besides re-enrollment
- Callback URL (`SUNO_CALLBACK_URL`) is currently a no-op stub (see Feature 26); state transitions rely entirely on polling, not push notifications
- `model` for persona stamped at enroll time from `suno_voice_persona_model` feature flag; a model change after enrollment requires re-enrollment

**key_files:** `src/services/suno-voice-persona-service.js`, `src/providers/suno-persona.js`, `src/services/suno-persona-failure-classifier.js`, `src/services/voice-provider-profile-service.js`

**db_tables:** `voice_provider_profiles`, `voice_provider_jobs`

---

### 15. Guide Vocal Generation (ElevenLabs TTS)

**user_story:** As the render pipeline, I want to generate a guide vocal (sung TTS) from the lyrics using ElevenLabs, so that there is a human-like vocal reference for voice conversion.

**expected_behavior (VERIFIED):**

- Provider: `src/providers/elevenlabs.js`
- Step: `guide_vocal` (preview) / `guide_vocal_full` (full render)
- Takes lyrics text and style metadata; calls ElevenLabs API; returns audio file path
- Saved as `guide_vocal.mp3` (preview) or `guide_vocal_full.mp3` (full) — INTERNAL ONLY, never exposed to users
- `guide_vocal_url` stored in `track_versions` for internal pipeline reference
- Circuit breaker wraps ElevenLabs calls

**status:** implemented — VERIFIED from `src/workflows/runner.js`, `src/providers/elevenlabs.js`

**gaps:**

- ElevenLabs is the sole TTS provider; no fallback TTS if ElevenLabs is unavailable (circuit breaker parks the job but can't substitute a different provider)
- Guide vocal file is local-filesystem only (no S3 in MVP); a deploy/restart wipes it, making resume impossible for this step without re-downloading from `guide_vocal_url` (if it was uploaded) — but `guide_vocal_url` stores the CDN URL only if uploaded, which depends on S3 being configured

**key_files:** `src/providers/elevenlabs.js`, `src/workflows/runner.js`

**db_tables:** `track_versions` (guide_vocal_url, guide_access_token)

---

### 16. Voice Conversion (Seed-VC / Gradio)

**user_story:** As the render pipeline, I want to convert the guide vocal to sound like the user's enrolled voice using Seed-VC, so that the final song has the user's voice.

**expected_behavior (VERIFIED):**

- Provider: `src/providers/seedvc.js` — `convertVoice()`
- Step: `voice_convert` (preview) / `voice_convert_sections` (full — section-by-section)
- Parameters: `diffusionSteps` (default 25), `lengthAdjust` (default 1.0), `cfgRate` (default 0.7)
- External Gradio API at `SEED_VC_BASE_URL`; sends source audio (guide vocal) + reference audio (enrolled voice) as multipart
- Timeout: 300000ms (5 min) default
- Provider (`src/providers/voice.js`): `convertVoiceForTrack()` — downloads guide vocal if only URL available, checks local file existence; calls `seedvc.convertVoice()`
- Adaptive params: reference audio quality check triggers error if too low; logs adaptive param description
- For full render: section-by-section loop, each section individually converted

**status:** implemented — VERIFIED from `src/providers/seedvc.js`, `src/providers/voice.js`

**gaps:**

- `similarity_strength` param mentioned in CLAUDE.md retry strategy (reduce on retry) is NOT implemented in current `seedvc.js` — the spec says "reduce similarity_strength on retry" but the provider has no such adaptive retry logic; all retries use same params
- No fallback voice conversion provider; if Gradio server is down the step fails permanently after max retries
- `SEED_VC_BASE_URL` must be configured; if unset the step will throw at call time with no preflight warning
- Guide vocal path resolution tries `.mp3` then `.wav`; if neither exists and `inputUrl` is null, throws `E302_VOICE_ERROR` — no recovery
- Section-by-section conversion is sequential; a single section failure aborts the full render

**key_files:** `src/providers/seedvc.js`, `src/providers/voice.js`

**db_tables:** `track_versions` (voice_conversion_url)

---

### 17. Stem Separation (Demucs via Replicate)

**user_story:** As the render pipeline, I want to separate vocals from instrumentals in an audio file using Demucs, so that voice conversion can be applied cleanly to isolated vocals before remixing.

**expected_behavior (VERIFIED):**

- Provider: `src/providers/demucs.js` — `separateStems()`
- Uses Replicate API with model `cjwbw/demucs:25a173108c...`; default model `htdemucs_ft`, shifts=3
- Returns `{ vocals: string, instrumental: string }` file paths
- Timeout: 300000ms

**status:** implemented — VERIFIED from `src/providers/demucs.js`

**gaps:**

- Demucs via Replicate is a paid API call; no cost guard or per-user cap on demucs calls beyond the overall render rate limit
- Pinned to a specific Replicate model hash (`25a173108c...`); if Replicate deprecates this version, the step fails silently until the hash is updated
- No local filesystem cache: if step retries, the full Replicate job re-runs (not idempotent at provider level)
- Unclear whether demucs is actually invoked in the current render pipeline or only available as a utility — not referenced in PREVIEW_STEPS / FULL_STEPS by name in the runner

**key_files:** `src/providers/demucs.js`

**db_tables:** none (intermediate local files)

---

### 18. Whisper Transcription

**user_story:** As the pipeline, I want to transcribe audio files to text using OpenAI Whisper, so that lyric alignment or QC checks can be performed on generated audio.

**expected_behavior (VERIFIED):**

- Provider: `src/providers/whisper.js`
- Calls OpenAI Whisper API (`/v1/audio/transcriptions`); `verbose_json` response format
- Returns `{ text, language, duration }`
- Error codes: `E401_WHISPER_ERROR` for auth/rate/bad-request errors

**status:** implemented — VERIFIED from `src/providers/whisper.js`

**gaps:**

- Not referenced in PREVIEW_STEPS or FULL_STEPS — Whisper is available as a provider but it is unclear if it is invoked in any current automated workflow
- `OPENAI_API_KEY` required; if unset the step will fail at call time
- No fallback transcription provider

**key_files:** `src/providers/whisper.js`

**db_tables:** none

---

### 19. Mix Step

**user_story:** As the render pipeline, I want to mix the voice-converted audio with the original instrumental track using FFmpeg, so that the final output has balanced levels and proper stereo field.

**expected_behavior (VERIFIED):**

- Step: `mix` (both PREVIEW_STEPS and FULL_STEPS)
- Outputs `mix.wav`; also produces `preview.m4a` or `full.m4a` as the encoded deliverable
- Tracked in runner's file retention policy: `mix: ["mix.wav", "preview.m4a", "full.m4a"]`
- NOT memoized (`mix`, `watermark`, `ready` explicitly excluded from STEP_MEMO_FIELDS — "file processing / quality gate")

**status:** implemented — VERIFIED from `src/workflows/runner.js`

**gaps:**

- Mix step not memoized: any retry re-runs the FFmpeg mix even if output files already exist
- Mix output (`mix.wav`) is a local temp file; deploy/restart between mix and watermark steps loses it
- No mix quality validation (e.g., silence detection, clipping check) before proceeding to watermark

**key_files:** `src/workflows/runner.js`

**db_tables:** `track_versions` (status)

---

### 20. Watermark Step

**user_story:** As the platform, I want to embed a metadata watermark in every rendered audio output for compliance and IP tracking, so that all outputs are traceable to their source track version.

**expected_behavior (VERIFIED):**

- Step: `watermark` (both PREVIEW_STEPS and FULL_STEPS)
- Inputs: `watermarked.wav` from mix step; outputs final `preview.m4a` or `full.m4a`
- File retention: `watermark: ["watermarked.wav", "preview.m4a", "full.m4a"]`
- NOT memoized (same rationale as mix)
- Inaudible audio watermark is marked TODO in CLAUDE.md; current implementation embeds metadata only

**status:** partial — metadata watermark implemented; inaudible audio watermark is explicitly TODO per CLAUDE.md

**gaps:**

- Inaudible audio watermark not implemented (TODO); compliance risk if audio is extracted and metadata stripped
- Watermark step not memoized; same file-loss risk as mix on restart
- No verification that watermark was successfully embedded before marking step complete

**key_files:** `src/workflows/runner.js`

**db_tables:** `track_versions` (status)

---

### 21. Artwork Generation (Parallel / Barrier)

**user_story:** As the platform, I want to generate occasion-specific artwork (cover image) for each track in parallel with the audio render, so that the share page has a visual alongside the audio.

**expected_behavior (VERIFIED):**

- `enqueueArtworkJob(trackId, trackVersionId, userId)` in `src/jobs/artwork-job.js`
- Kicked fire-and-forget from `render_preview` endpoint after job insert: `kickArtworkJob().catch(warn)`
- Defense-in-depth rate limit: `artwork_regen` (30/3600)
- `src/workflows/artwork-barrier.js`: the `ready` step in the runner waits for artwork completion before transitioning to `ready` (barrier pattern)
- If artwork job fails or times out, the barrier logs a warning and proceeds (non-fatal)

**status:** implemented — VERIFIED from `src/routes/tracks.js`, `src/workflows/artwork-barrier.js`, `src/jobs/artwork-job.js`

**gaps:**

- Artwork failure is non-fatal (logged warning, barrier proceeds); the share page may have no artwork
- Artwork job is not tracked in the `jobs` table with the same schema as render jobs — no user-visible status for artwork progress
- `MAX_CIRCUIT_PARKS=20` applies to render jobs; artwork job failures have no equivalent park limit

**key_files:** `src/jobs/artwork-job.js`, `src/workflows/artwork-barrier.js`, `src/routes/tracks.js`

**db_tables:** `track_versions`, `tracks`

---

### 22. Render Idempotency & Resumability (params_hash memoization)

**user_story:** As the render pipeline, I want each workflow step to check whether it already completed before re-running, so that job retries and resumes are cost-efficient and don't duplicate expensive API calls.

**expected_behavior (VERIFIED):**

- `STEP_MEMO_FIELDS` in `src/workflows/runner.js` maps step names to their trackVersion output field
- Before dispatching a step, runner checks: if the memo field is set (non-null) — and for `moderation`, if value is `'passed'` — the step is skipped
- File-based memos: `instrumental` checks both DB field (`instrumental_url`) AND local file (`inst_preview.mp3`); `guide_vocal` similarly
- `params_hash` (SHA-256 of `params_json`) stored at version creation; used as a cache key concept but NOT checked as a pre-condition on individual step re-runs — it's informational
- Steps excluded from memoization (run on every retry): `instrumental_full`, `guide_vocal_full` (share columns with preview), `voice_convert`, `voice_convert_sections` (own fs.existsSync), `mix`, `watermark`, `ready`

**status:** partial — memoization implemented for moderation, lyrics, music_plan, instrumental, guide_vocal; excluded for mix/watermark/ready and full-render audio steps

**gaps:**

- `voice_convert` and `voice_convert_sections` rely on `fs.existsSync` at the handler level — if local files are wiped (deploy), voice conversion re-runs even if output was previously uploaded
- `mix` and `watermark` have no memoization at all; re-run on every retry regardless of file existence
- `params_hash` is computed at version creation and not re-verified at render time; if track metadata drifts (e.g., a title edit) the hash no longer matches but render proceeds with stale params
- No idempotency key enforcement at the Suno API call level; duplicate tasks can be created if the job is retried quickly

**key_files:** `src/workflows/runner.js`, `src/workflows/render-contract.js`

**db_tables:** `track_versions` (params_json, params_hash, lyrics_json, music_plan_json, moderation_status, instrumental_url, guide_vocal_url)

---

### 23. Render Retry (Manual Retry Endpoint)

**user_story:** As a user, I want to retry a failed render without starting from scratch, so that transient provider failures don't require me to re-create the track.

**expected_behavior (VERIFIED):**

- Endpoint: `POST /tracks/:id/versions/:version/retry`
- Finds the failed job for the version and workflow type; calls `retryFailedJob()`
- `retryFailedJob` re-queues the existing job (resets status to `queued`, increments attempts) if `attempts < max_attempts`
- If `result.blocked` (moderation block detected) → 404 `NO_FAILED_JOB` (backward-compatible)
- `result.conflict` (TOCTOU — job status changed between check and update) → 409
- Rate-limited: `render_preview_burst` (10/60s)
- Voice persona preflight re-checked before retry

**status:** implemented — VERIFIED from `src/routes/tracks.js`

**gaps:**

- Retry reuses the same `max_attempts=3` counter; after 3 attempts the job can no longer be retried via this endpoint (must go through DLQ reprocess or manual intervention)
- No user-facing indication of which step failed and why beyond `error_code` / `error_message` on the job
- `blocked` result returns 404 (`NO_FAILED_JOB`) for backward compatibility — misleading error code

**key_files:** `src/routes/tracks.js`, `src/workflows/runner.js`

**db_tables:** `jobs`, `track_versions`

---

### 24. Render Cancel

**user_story:** As a user, I want to cancel an in-progress render, so that I can start over or make changes without waiting for a long job to fail.

**expected_behavior (VERIFIED):**

- Endpoint: `POST /tracks/:id/versions/:version/cancel`
- Finds active job (`queued` or `running`) for the version (preview or full)
- DB transaction: updates `jobs.status='cancelled'`, `error_code='USER_CANCELLED'`; updates `track_versions.status='cancelled'`; resets `tracks.status='draft'`
- TOCTOU guard: if job completed between the find and the update (`cancelResult.changes===0`), aborts with 409
- Writes `addAuditEntry(action:'render_cancelled')`
- Returns `{ cancelled: true, job_id }`

**status:** implemented — VERIFIED from `src/routes/tracks.js`

**gaps:**

- Cancel sets DB status to `cancelled` but does NOT send a signal to the runner process currently executing the step; if the runner is mid-API-call (e.g., waiting on Suno), the API call completes regardless — the cancel only takes effect at the next step transition
- No refund of credits on cancel (billing was already spent at render start; `billing_holds` table was dropped)

**key_files:** `src/routes/tracks.js`

**db_tables:** `jobs`, `track_versions`, `tracks`, `audit_logs`

---

### 25. Reroll (Lyrics / Beat / Vocals / Section-only)

**user_story:** As a user, I want to request a new version of my song with variations (new lyrics, different beat, re-sung vocals, or a single section re-done), so that I can iterate toward the song I want.

**expected_behavior (VERIFIED):**

- Endpoint: `POST /tracks/:id/versions/:version/reroll`
- Body: `type` field (not fully detailed from grep alone — endpoint exists at line 1483 of tracks.js)
- Creates a new `track_versions` row (increments `version_num` via `incrementTrackVersion`)
- Inserts new `jobs` row for the appropriate workflow type
- Runner supports `reroll_requested` flag in step_data at the `ready` step; routes to `instrumental` (preview) or `instrumental_full` (full) for beat reroll
- Rate limit: 10 rerolls per track per hour (per CLAUDE.md spec)

**status:** partial — endpoint exists and is wired; the full reroll type dispatch (lyrics-only, beat, vocals, section-only) requires further code reading to fully verify each path

**gaps:**

- Lyrics-only reroll should reuse the existing instrumental (cheap path), but this optimisation is not confirmed implemented vs. re-running the full pipeline
- Section-only reroll (re-render single section): mentioned in CLAUDE.md but no `section_name` parameter found in the reroll grep output
- Vocals reroll with reduced `similarity_strength` on retry — this adaptive param is not implemented in `seedvc.js` (see Feature 16)
- Entitlement cost of reroll not verified; it's unclear whether rerolls deduct additional song credits

**key_files:** `src/routes/tracks.js`, `src/workflows/runner.js`

**db_tables:** `jobs`, `track_versions`, `tracks`

---

### 26. Suno Callback Handler

**user_story:** As the platform, I want to receive async status callbacks from the Suno API for voice persona tasks, so that we don't rely solely on polling and can react faster to completion events.

**expected_behavior (VERIFIED):**

- Endpoint: `POST /internal/suno-callback` registered by `registerInternalSunoCallbackRoutes`
- HMAC authentication: checks `X-Suno-Signature` header (HMAC-SHA256 of raw body) OR `?token=<secret>` query param
- When `SUNO_CALLBACK_HMAC_SECRET` is unset → 503 (fail-secure)
- Current implementation is a **no-op stub**: logs the callback (redacted) but does NOT mutate any DB state
- Explicit safety comment: token-only path is unsafe for state mutation (tokens appear in access logs); HMAC-header path required before promoting to state mutation

**status:** partial — endpoint exists and is authenticated but is a deliberate no-op stub; voice persona state transitions rely entirely on polling

**gaps:**

- Callback does not drive state transitions; persona creation latency is bounded by polling interval, not push notification
- If `SUNO_CALLBACK_HMAC_SECRET` env var is not set in production, every callback returns 503 silently (this is intentional but needs operational awareness)
- Transition to stateful callback (as documented in the code comment) requires both auth design completion and TOCTOU-safe DB write design

**key_files:** `src/routes/internal-suno-callback.js`

**db_tables:** none (currently)

---

### 27. Job Status Polling

**user_story:** As a client, I want to poll the status of a render job and receive progress percentage, current step, and output URLs when complete, so that I can show real-time progress to the user.

**expected_behavior (VERIFIED):**

- Endpoint: `GET /jobs/:id` (inferred from route references; `poll_url: /jobs/${jobId}` returned by render endpoints)
- `jobs` table fields available for polling: `status`, `step`, `progress_pct`, `error_code`, `error_message`, `last_heartbeat_at`, `step_data`
- Runner updates `last_heartbeat_at` during long steps; clients can detect stuck jobs if heartbeat goes stale
- `202` responses from render start/retry return `{ job_id, poll_url, estimated_completion_sec:90 }`

**status:** implemented (inferred) — poll_url pattern confirmed; full handler not read

**gaps:**

- Heartbeat staleness detection is not enforced server-side; no auto-recovery if runner crashes mid-step and heartbeat stops
- No SSE / WebSocket push; clients must poll — chattiness for 90s render
- `estimated_completion_sec` is hardcoded to 90; not dynamic

**key_files:** `src/routes/` (jobs route file not directly read), `src/workflows/runner.js`

**db_tables:** `jobs`

---

### 28. Dead-Letter Queue (DLQ)

**user_story:** As an operator, I want failed jobs that exceed max retries to be captured in a dead-letter queue with context, so that I can inspect, reprocess, or purge them without losing failure information.

**expected_behavior (VERIFIED):**

- Service: `src/workflows/dlq.js` — `createDLQService(db)`
- `moveToDeadLetter({ jobId, reason })`: fetches job, inserts into `dead_letter_queue` table
- `listDeadLetters({ unprocessedOnly })`: lists DLQ entries with associated job
- `reprocess({ jobId, fromStep })`: creates a new job from the failed one, starting from a specified step; marks DLQ entry as reprocessed
- `MAX_CIRCUIT_PARKS=20`: runner parks a job (delays retry) up to 20 times before moving to DLQ (~10 min at 30s cooldown)
- DLQ entries include original step_data and error context

**status:** implemented — VERIFIED from `src/workflows/dlq.js`

**gaps:**

- DLQ uses PostgreSQL (`db.query` with `$1` params) while main runner uses SQLite-compatible (`db.prepare` with `?` params) — potential mismatch if run in SQLite test/dev environment
- No admin API endpoint to list/reprocess DLQ entries; management is code-only
- `purge()` function not verified in detail; if it deletes without archiving, forensic data is lost permanently
- No alerting/notification when a job enters DLQ

**key_files:** `src/workflows/dlq.js`

**db_tables:** `dead_letter_queue` (separate table, schema not fully verified in migrations)

---

### 29. Circuit Breaker

**user_story:** As the render pipeline, I want circuit breakers around external provider calls, so that a failing provider doesn't cascade into all concurrent jobs waiting on timeouts.

**expected_behavior (VERIFIED):**

- Class: `CircuitBreaker` in `src/workflows/circuit-breaker.js`
- States: `closed` (normal) → `open` (failure threshold exceeded) → `half-open` (cooldown elapsed, probe) → `closed` (probe success) or `open` (probe failure)
- `failureThreshold`: N failures opens circuit; `cooldownMs`: time before half-open
- `canExecute(provider)`: returns false if open; `recordSuccess` / `recordFailure` update state
- `execute(provider, fn)`: wrapped execution with auto record
- `CircuitOpenError` thrown when circuit is open
- Wraps ElevenLabs and Replicate provider calls

**status:** implemented — VERIFIED from `src/workflows/circuit-breaker.js`

**gaps:**

- Circuit breaker state is **in-memory only** (class instance per process); a Node.js restart resets all circuit state, potentially re-hammering a failing provider on restart
- No DB-backed circuit state sharing across multiple runner instances (if horizontally scaled)
- `failureThreshold` and `cooldownMs` values hardcoded at instantiation; no runtime tuning
- No metrics export; circuit open/close events not surfaced to monitoring

**key_files:** `src/workflows/circuit-breaker.js`

**db_tables:** none

---

### 30. LLM Provider (generateText / Fallback Chain)

**user_story:** As any LLM-consuming service (songwriter, music plan, memory questions, artwork), I want a unified text generation interface with automatic provider fallback, so that LLM failures don't block the pipeline.

**expected_behavior (VERIFIED):**

- Module: `src/services/llm-provider.js` — `generateText(options)`
- Primary: Gemini (`gemini-3-flash-preview`; env-overridable via `GEMINI_MODEL_LYRICS` / `GEMINI_MODEL_SIMPLE`)
- Fallback chain: Anthropic (`claude-sonnet-4-20250514` for lyrics, `claude-3-haiku-20240307` for simple) → OpenAI (`gpt-4o`)
- `taskType`: `'lyrics'` | `'simple'` — selects model tier
- Config: `maxInputTokens:6000`, `maxOutputTokens:2000`, `timeoutMs:30000`, `maxRetries:2`, `retryDelayMs:1000`
- Gemini uses `responseMimeType:'application/json'` for structured output when specified
- `isAvailable(provider)` checks API key presence

**status:** implemented — VERIFIED from `src/services/llm-provider.js`

**gaps:**

- Gemini model name `"gemini-3-flash-preview"` — this model name is non-standard; may be a placeholder or internal alias that could silently fail if the API rejects it
- `maxOutputTokens:2000` is the CONFIG default but songwriter overrides to `LYRICS_LLM_MAX_OUTPUT_TOKENS=3000`; inconsistency if other callers rely on default
- Fallback chain is sequential (Gemini → Anthropic → OpenAI); all three failing throws; no user-facing signal of degraded quality when fallback is used
- No cost tracking per call; high-volume rerolls could generate unexpected LLM spend

**key_files:** `src/services/llm-provider.js`

**db_tables:** none

---

### 31. Style Registry & Provider-Style Routing

**user_story:** As the pipeline, I want a centralized style registry that maps user-selected style keys to provider-specific prompts, BPM ranges, and quality tier, so that style guidance is consistent and not duplicated across providers.

**expected_behavior (VERIFIED):**

- `src/providers/style-registry.js`: static map of style keys → `{ genre_core, rhythmic_signature, arrangement_notes, bpmRange, suno: { support, ... }, vocal_character }`
- `src/providers/provider-style-routing.js`: `getStylePrompt(style, provider, overrides)` → compact style string for provider payload
- `suno.support` levels: `strong` / `medium` / `weak`; weak/medium get `rhythmic_signature` injected
- Style prompt max length: 120 chars for Suno style field

**status:** implemented — VERIFIED from `src/providers/style-registry.js`, `src/providers/provider-style-routing.js`

**gaps:**

- Static registry; adding a new style requires a code deploy
- No fallback for unknown styles beyond a generic default; user-facing error for unknown style key not verified
- `suno.support` levels not exposed to users; a "weak support" style may produce consistently poor results without explanation

**key_files:** `src/providers/style-registry.js`, `src/providers/provider-style-routing.js`

**db_tables:** none

---

### 32. Share Token Creation / Play URL

**user_story:** As a user, I want to share my completed song via a unique URL that recipients can open to listen and claim the song to their library, so that I can gift songs to others.

**expected_behavior (VERIFIED):**

- `createOrGetShareToken()` in `src/services/share-service.js`
- Called at `ready` step completion and from `POST /tracks/:id/share`
- Tokens have `expires_at=9999-12-31` (lifetime); `share_type='lifetime'`
- `buildPlayShareUrl(tokenId, opts)` constructs the play URL
- `ensureShareMp4()` ensures the audio file is accessible for the share
- Share tokens stored in `share_tokens` table; one per track (UNIQUE INDEX on `track_id`)
- `og_variant` on track controls OG image variant for social sharing

**status:** implemented — VERIFIED from `src/routes/tracks.js`, `src/services/share-service.js` (referenced)

**gaps:**

- Share token uniqueness index (`ON share_tokens (track_id)`) means only one share link per track; if the token is lost or corrupted there is no re-issue path without DB intervention
- OG cache-busting via `socialCacheToken: Date.now()` appended to URL; this may cause CDN cache misses on every share re-generation

**key_files:** `src/services/share-service.js`, `src/routes/tracks.js`

**db_tables:** `share_tokens`, `share_access_log`

---

### 33. Poem Generation (Story-Based)

**user_story:** As a user who completed a story interview, I want to generate a poem instead of a song, so that I have an alternative deliverable from the same story context.

**expected_behavior (VERIFIED):**

- Endpoint: `POST /stories/:id/poem` in `src/routes/story.js`
- Accepts `tone`, `style`, `gift_reservation_id`
- Idempotency: if gift reservation already has a `poem` content type, returns existing poem without re-generating
- Validates gift funding reservation; validates voice mode / enrollment if relevant
- Calls poem generation service (inferred from `poems` table in schema)
- Removes poem from library (for gift flow); returns `{ poem: { id, verses[], ... }, provider, model }`

**status:** implemented (partial verification) — endpoint exists and is wired; poem generation service not directly read; `poems` table listed as MISSING in CLAUDE.md but present in route code suggesting it exists

**gaps:**

- CLAUDE.md marks `poems` table as a TODO missing table — contradicts the route code that queries it; migration status unclear
- No rate limit on poem generation endpoint found in route code excerpt
- Poem content not run through the same lyrics policy sanitizer (poem may contain content the songwriter would have sanitized)

**key_files:** `src/routes/story.js`

**db_tables:** `poems` (status uncertain — CLAUDE.md lists as missing)

---

## Summary Table

| #   | Feature                           | Status                                     |
| --- | --------------------------------- | ------------------------------------------ |
| 1   | Create Track (direct)             | implemented                                |
| 2   | Story Interview / Conversation    | implemented                                |
| 3   | Story → Track Conversion          | implemented                                |
| 4   | AI Memory / Wizard Questions      | implemented                                |
| 5   | Song Readiness Pre-flight         | implemented                                |
| 6   | Lyrics Generation                 | implemented                                |
| 7   | Lyrics Policy Sanitization        | implemented                                |
| 8   | Lyrics Manual Edit & Approval     | implemented                                |
| 9   | Music Plan Generation             | implemented                                |
| 10  | Content Moderation Gate           | implemented                                |
| 11  | Preview Render Workflow           | implemented                                |
| 12  | Full Render Workflow              | implemented                                |
| 13  | Suno Instrumental Generation      | implemented                                |
| 14  | Suno Voice Persona Creation       | implemented                                |
| 15  | Guide Vocal (ElevenLabs TTS)      | implemented                                |
| 16  | Voice Conversion (Seed-VC)        | implemented                                |
| 17  | Stem Separation (Demucs)          | implemented (pipeline integration unclear) |
| 18  | Whisper Transcription             | implemented (pipeline integration unclear) |
| 19  | Mix Step                          | implemented                                |
| 20  | Watermark Step                    | partial (audio watermark TODO)             |
| 21  | Artwork Generation                | implemented                                |
| 22  | Render Idempotency / Resumability | partial                                    |
| 23  | Render Retry                      | implemented                                |
| 24  | Render Cancel                     | implemented                                |
| 25  | Reroll                            | partial                                    |
| 26  | Suno Callback Handler             | partial (no-op stub)                       |
| 27  | Job Status Polling                | implemented (inferred)                     |
| 28  | Dead-Letter Queue                 | implemented                                |
| 29  | Circuit Breaker                   | implemented                                |
| 30  | LLM Provider / Fallback           | implemented                                |
| 31  | Style Registry & Routing          | implemented                                |
| 32  | Share Token / Play URL            | implemented                                |
| 33  | Poem Generation                   | partial                                    |

---

## Top Robustness Gaps

1. **No credit guard at full render**: `billing_holds` was dropped (migration 095) and no credit deduction occurs at `render_full` time — a user with zero credits can trigger a full render if they exhausted credits after a preview was completed.

2. **Preview render start has a TOCTOU race**: the ALREADY_RENDERING check (`findActiveJobForVersion`) and the job INSERT are not in the same DB transaction; concurrent requests from the same user can both pass the guard and create duplicate render jobs plus double-spend credits.

3. **Circuit breaker is in-memory only**: a Node.js restart resets all circuit state; a repeatedly-failing provider (ElevenLabs, Seed-VC Gradio) will be re-hammered on every deploy, with no persistence or cross-instance sharing of open/closed state.

4. **Voice conversion has no adaptive retry**: the CLAUDE.md spec says "reduce similarity_strength on retry" for Seed-VC, but `seedvc.js` does not implement this; every retry uses identical params, making retry of transient quality failures no better than the original attempt.

5. **Local-filesystem dependency breaks resumability**: mix, watermark, guide-vocal, and voice-convert steps write to local disk; a deploy or crash between these steps wipes intermediate files, and only a subset of steps have memoization that can skip re-work — mix and watermark have none, forcing full re-execution from at least the mix step on any resume after a restart.
