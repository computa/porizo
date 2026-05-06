# Verification: SUGGESTIONS (S1-S24)

| ID  | Status    | Evidence/Gap                                                                                                                                       |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | NOT_FIXED | `test/critical-fixes.test.js:629-642` still tests `JSON.parse` (built-in), not the SUT `parseJson`. Tautology unchanged.                           |
| S2  | NOT_FIXED | `:225-231` only checks `config.DEFAULT_AI_VOICE_MODE === "custom_model_v1"`; no end-to-end conversion call exercising config.                      |
| S3  | PARTIAL   | Test still races on `Promise.all`; asserts uniqueness only on successful results. Failed/duplicate results not asserted.                           |
| S4  | NOT_FIXED | Rate-limit test still relies on hitting endpoint without LLM key; 429s mixed with 503s.                                                            |
| S5  | PARTIAL   | Test name says "does not mutate state" but only asserts response body; no DB/job-store assertion. Stub has no DB so claim is structurally true.    |
| S6  | FIXED     | Tests at lines 171-191 (empty/non-hex) and 193-212 (correct length wrong bytes).                                                                   |
| S7  | NOT_FIXED | Asserts only `status='queued'` and `attempts=1`; no assertion on `last_error`, error metadata, or step preservation.                               |
| S8  | NOT_FIXED | Test verifies persona job row inserted with correct step_data; never invokes `runSunoVoicePersonaJob`.                                             |
| S9  | PARTIAL   | Asserts persona_id, source_task_id, source_audio_id, completed status, access_token nulled; misses activated_at and side-effects on voice_profile. |
| S10 | NOT_FIXED | No assertion that gift_reservations status moves from 'reserved' to 'consumed'.                                                                    |
| S11 | PARTIAL   | Test isolates by creating fresh `app` with `DEFAULT_VOICE_MODE: "ai_voice"`; no negative cross-config check.                                       |
| S12 | NOT_FIXED | `:240-242` still `if (process.env.SUNO_PERSONA_PROBE_VERIFIED !== "true") return;` — silent skip.                                                  |
| S13 | NOT_FIXED | Mocks all 4 SDK methods end-to-end; no integration assertions on intermediate state changes.                                                       |
| S14 | PARTIAL   | Added 1000-char cap and Error-instance test, but no edge cases for nested IDs, mixed-case bearer, or multiple URLs.                                |
| S15 | FIXED     | `provider TEXT NOT NULL CHECK (provider IN ('suno','seedvc','replicate'))` at line 5.                                                              |
| S16 | FIXED     | `expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes')` at line 73.                                                               |
| S17 | NOT_FIXED | All CHECK/UNIQUE constraints still inline-anonymous.                                                                                               |
| S18 | FIXED     | Doc comment (lines 151-165) now placed directly above `extractSunoAudioId` at line 166.                                                            |
| S19 | NOT_FIXED | No DB CHECK for legal status transitions; only enum CHECK exists.                                                                                  |
| S20 | FIXED     | `docs/api/internal-callbacks.md` lines 7-9 document the no-mutation contract and required hardening.                                               |
| S21 | FIXED     | `personaVocalWindow` computed once at `enrollment.js:1403-1405`; no duplicate.                                                                     |
| S22 | FIXED     | Sitemap lastmod (already shipped pre-review).                                                                                                      |
| S23 | FIXED     | `consentGranted`, `promptSetId`, `recordingSettings` removed from EnrollmentFlowView.swift.                                                        |
| S24 | NOT_FIXED | Body still uses single `switch currentStep` inline at lines 67-83; not extracted into separate View structs.                                       |

**Tally:** 8 FIXED · 5 PARTIAL · 11 NOT_FIXED
