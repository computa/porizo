# SongCreation P2/P3 Robustness Gap Verification

Date: 2026-06-22  
Auditor: Claude (rigorous code-read pass, ~95% FP baseline corrected)  
Scope: 23 claimed gaps across B1–B33 (SongCreation domain, P2+P3 priority)

---

## Verdict Summary

| ID   | Gap                                                                | Verdict        | Reason                                                                                                     |
| ---- | ------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------- |
| B1   | No schema validation (Zod/Joi) on POST /tracks                     | FALSE_POSITIVE | Ad-hoc coercion is present; `duration_target` validated at DB level; not a robustness bug                  |
| B2   | No rate limit on `POST /stories` / `POST /stories/:id`             | **REAL**       | Zero `rateLimit` matches in story.js; endpoints fully unguarded                                            |
| B2-b | Story sessions never garbage-collected                             | **REAL**       | cleanup.js only deletes enrollment_sessions; no story_sessions TTL/DELETE anywhere in jobs/                |
| B2-c | Debug story endpoints lack NODE_ENV guard                          | BY_DESIGN      | Routes are admin-auth-gated (debug_user_id impersonation requires admin_id); not open                      |
| B4   | generateMemoryQuestions: no JSON shape validation                  | FALSE_POSITIVE | `parseQuestionsResponse()` validates + falls back to `getDefaultQuestions()`; validated in code            |
| B5   | assessSongReadiness advisory — caller can proceed with blockers    | BY_DESIGN      | `can_proceed_anyway` is an explicit user-skip design; intended                                             |
| B6   | Lyrics: best-available draft emitted below quality threshold       | BY_DESIGN      | Intentional graceful degradation to hit >95% preview completion rate target                                |
| B7   | Policy sanitizer not applied to `review_edit` (manual lyric edits) | **REAL**       | grep for `review_edit\|sanitiz` in tracks.js: zero hits; PUT handler saves raw user input                  |
| B8   | Lyrics approve endpoint — no re-sanitize before approval           | FALSE_POSITIVE | Approve only flips `lyrics_status`; not a separate injection surface                                       |
| B9   | Music plan LLM output stored without structural validation         | **REAL**       | No `validate`/`schema`/`parseMusicPlan` in music.js; malformed JSON propagates to Suno                     |
| B10  | Moderation circuit breaker in-memory only                          | BY_DESIGN      | Known tradeoff; single-process runner; documented                                                          |
| B13  | Suno payload style-field truncation at 120 chars silent            | FALSE_POSITIVE | `.slice(0, maxLen)` is explicit and logged in buildSunoStyleField                                          |
| B14  | Suno persona `failed` state has no auto-retry path                 | FALSE_POSITIVE | Failure classifier + DLQ reprocess covers this; `manual_cleanup_required` is intentional for unrecoverable |
| B17  | Demucs: no retry on timeout; job fails                             | FALSE_POSITIVE | Runner max_attempts=3 with backoff covers this at job level                                                |
| B18  | Whisper: no retry on rate-limit                                    | FALSE_POSITIVE | Same job-level retry as B17                                                                                |
| B19  | Mix step: restart between mix and watermark loses local file       | FALSE_POSITIVE | runner.js line 4792–4813 explicitly resets step to `mix` on restart when mix.wav absent                    |
| B21  | Artwork job fire-and-forget; failure undetected                    | FALSE_POSITIVE | artwork-barrier.js ready-step waits for completion; failure surfaces there                                 |
| B23  | Retry endpoint TOCTOU                                              | FALSE_POSITIVE | Documented + handled with `result.conflict` branch                                                         |
| B24  | Cancel TOCTOU                                                      | FALSE_POSITIVE | `cancelResult.changes===0` guard handles race                                                              |
| B27  | Heartbeat staleness not auto-recovered server-side                 | FALSE_POSITIVE | runner.js line 2162–2178: `recoverStaleJobs` queries `COALESCE(last_heartbeat_at,...) < cutoff` and resets |
| B28  | DLQ MAX_CIRCUIT_PARKS not enforced                                 | FALSE_POSITIVE | constant is defined and checked in dlq.js                                                                  |
| B30  | Gemini model name `gemini-3-flash-preview` non-standard            | **REAL**       | Not a GA Gemini model ID; silent fallback to Anthropic on every call if API rejects it                     |
| B31  | Style registry static; unknown style silent default                | FALSE_POSITIVE | Generic default is acceptable product behaviour; not a robustness bug                                      |
| B32  | Share token creation at ready step                                 | FALSE_POSITIVE | createOrGetShareToken is idempotent by design                                                              |
| B33  | Poem endpoint idempotency                                          | FALSE_POSITIVE | Verified: returns existing poem if gift_reservation already has poem content type                          |

---

## Confirmed-Real Gaps

| ID   | Verified Issue (file:evidence)                                                                                                                                                                                          | Minimal Fix                                                                                                                             | Severity |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| B2   | `src/routes/story.js` — zero `rateLimit` config on `POST /stories` and `POST /stories/:id`; unlimited LLM calls per user                                                                                                | Add `config: { rateLimit: { max: 5, timeWindow: '1h' } }` on both handlers                                                              | LOW      |
| B2-b | `src/jobs/cleanup.js` — only cleans `enrollment_sessions`; `story_sessions` rows accumulate forever                                                                                                                     | Add DELETE in cleanup.js: `WHERE created_at < NOW()-30d AND status != 'completed'`                                                      | LOW      |
| B7   | `src/routes/tracks.js` — PUT lyrics handler (`review_edit`) has no `sanitizeLyrics()` call; users can reintroduce hard-blocked terms                                                                                    | Call `sanitizeLyrics(body.lyrics, ...)` before saving `lyrics_json` in the PUT handler                                                  | MEDIUM   |
| B9   | `src/providers/music.js` — LLM-generated music plan written to `music_plan_json` without structural validation; malformed plan propagates silently to Suno                                                              | Add `validateMusicPlan(parsed)` (check `style`, `bpm`, `rhythmic_signature` present); throw `E_MUSIC_PLAN_INVALID` to trigger job retry | LOW      |
| B30  | `src/services/llm-provider.js:34-35` — `MODELS.gemini.lyrics/simple` both hardcoded to `"gemini-3-flash-preview"`, not a known GA model name; if Google rejects it every call silently falls back to costlier Anthropic | Verify against Google AI SDK; update default to `"gemini-2.0-flash"` (or correct ID); `GEMINI_MODEL` env var already overrides          | MEDIUM   |
