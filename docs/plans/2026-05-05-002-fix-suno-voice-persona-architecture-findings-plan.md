---
title: "fix: Suno voice persona architecture review findings (P0–P2)"
type: fix
status: active
date: 2026-05-05
deepened: 2026-05-05
origin: docs/plans/2026-05-05-suno-voice-persona-integration-execplan.md
---

# fix: Suno voice persona architecture review findings (P0–P2)

## Summary

Surgical remediation of 17 architecture-review findings (OO-001..007, CA-001..005, AD-001..005) on Codex's Suno voice persona implementation. Three priority phases: **P0 unblocks production safety** (audio shape capture, typed extractor, callback URL + auth, broken consent gate, cross-domain SQL, frozen contract); **P1 hardens correctness before wider rollout** (sanitize utility, guard/refresh separation, feature flag caching, COVER_SUBMITTED status, vocal-window wiring); **P2 cleans up structure conditionally on R2 PASS** (status enum, pipeline constants, lock SQL placement, FK migration, exports, repository split). Feature flag stays OFF throughout; production re-probe is gated on **all P0 commits AND vendor-confirmation that the persona path is supported**.

---

## Problem Frame

A live production probe of the Suno voice persona path failed for `abcobimma@gmail.com` with "Music does not exist" on candidate 1 and "create persona error" on candidate 2. Three independent architecture reviewers (OO Design, Clean Architecture, API Design) returned `CHANGES_REQUESTED` and converged on 17 findings. **Adversarial review challenged the original premise that `httpbin.org` callback was the root cause** — "Music does not exist" points at audio-id extraction (`collectObjects` graph traversal returning a non-canonical id), not callback validation. This plan therefore promotes the typed extractor (U6) to P0 alongside the callback fix (U1) and adds an instrumented probe (U16) to capture the real response shape before either is finalized. A latent consent-gate bug (`hasSunoPersonaConsent("1.0")` always returns false on the enrollment fallback path) is fixed via U2 + a new `consent_scopes` column (U17). Cross-domain SQL inside the persona service is moved to a single named enrollment-domain function applied at all three existing call sites (U3). The render-contract fallback is gated at job creation (U4) so persona renders cannot start without a frozen profile id.

---

## Findings Coverage Map

All 17 architecture-review findings are addressed below. Two findings are explicitly deferred under "Deferred to Follow-Up Work."

| ID     | Severity   | Topic                                          | Unit     | Notes                                          |
| ------ | ---------- | ---------------------------------------------- | -------- | ---------------------------------------------- |
| OO-001 | CRITICAL   | sanitize duplication across modules            | U5       | also fixes 1000-char cap asymmetry             |
| OO-002 | CRITICAL   | assertProviderJobStillAllowed cost             | U7       | guard/refresh split, 5s freshness budget       |
| OO-003 | CRITICAL   | callBackUrl httpbin hardcode                   | U1 + U18 | U18 adds the receiving endpoint with HMAC auth |
| OO-004 | WARNING    | two state machines in one file                 | U15      | conditional on R2 PASS                         |
| OO-005 | WARNING    | vocalStart/vocalEnd dead inputs                | U14      | rewritten — they're defaulted, not dead        |
| OO-006 | WARNING    | collectObjects opaque traversal                | U6 + U16 | U16 captures real shape via probe              |
| OO-007 | SUGGESTION | over-exported helpers                          | U13      | reduce to facade + step functions              |
| CA-001 | CRITICAL   | cross-domain enrollment_sessions SQL           | U3       | migrate ALL THREE call sites in this PR        |
| CA-002 | CRITICAL   | feature flag reads per render                  | U8       | fold into getRuntimeMusicRoutingConfig         |
| CA-003 | WARNING    | resolveRenderContract fallback incomplete      | U4       | fail at job create with 422 API                |
| CA-004 | WARNING    | lock SQL inline in runner.js                   | U11      | conditional on R2 PASS                         |
| CA-005 | SUGGESTION | missing FK on voice_profile_id                 | U12      | conditional + orphan-row cleanup gate          |
| AD-001 | CRITICAL   | suno-persona.js over-exports                   | U13      | conditional on R2 PASS                         |
| AD-002 | CRITICAL   | hasSunoPersonaConsent latent bug               | U2 + U17 | U17 adds consent_scopes column + backfill      |
| AD-003 | WARNING    | markProviderProfileCoverSubmitted wrong status | U9       | promoted to P1 (correctness, not cleanup)      |
| AD-004 | WARNING    | only one pipeline constant                     | U10      | conditional on R2 PASS                         |
| AD-005 | WARNING    | E302\_ namespace spans two domains             | DEFERRED | requires iOS error-handler audit               |

---

## Requirements

- R1. **All four P0 commits (U1, U2, U3, U4) AND P0 prerequisites (U16, U17, U18, U6) land before any new production probe of the Suno persona path.** Partial P0 is not acceptable. Feature flag (`suno_voice_persona_enabled`) remains OFF throughout this plan.
- R2. **Re-probe acceptance**: a controlled re-probe against SunoAPI (sandbox or production with one known-test user) verifies upload-cover → audio resolution → generate-persona returns a usable `personaId` without "create persona error" or "Music does not exist". **Probe procedure**: re-run `tools/suno-persona-probe.js` (preserved from origin execplan T0.2) with `SUNO_CALLBACK_URL` set, capture the raw upload-cover response body to `test/fixtures/suno-upload-cover-response.json` (redacted), assert against U6's typed extractor.
- R2.1. **Vendor-fit confirmation**: production enable additionally requires written confirmation from sunoapi.org/Suno partner support that personas created from user-uploaded vocal audio are first-class and reusable across renders. R2 alone (clean code path) is necessary but not sufficient for production enable.
- R3. The consent gate accepts the actual stored format — `voice_provider_profiles.consent_scope` (scope-string format) — without conflating with `enrollment_sessions.consent_version` (semver format). New `enrollment_sessions.consent_scopes` column provides the canonical session-level consent signal.
- R4. **All three** existing `UPDATE enrollment_sessions SET access_token = NULL` sites (`auth-service.js:856`, `routes/enrollment.js:1108`, `suno-voice-persona-service.js`) call a single named `revokeEnrollmentSessionToken(db, sessionId)` exported from `src/services/enrollment-session-service.js`.
- R5. Renders that hit the Suno persona pipeline cannot start without a frozen `voice_provider_profile_id` — failure happens at API track-create time as HTTP 422, not mid-render. Existing in-flight queued jobs without the profile id are explicitly drained (failed) on first deploy.
- R6. `npm test` passes (full suite); `npm run lint` clean; no new test relies on `httpbin.org` or other public inspection endpoints.
- R7. Each P0–P1 unit ships as its own reversible commit, EXCEPT P0 commits ship via a single PR (atomically) so partial-P0-then-flip-flag is impossible.
- R8. Provider error messages remain redaction-safe across both modules with consistent 1000-char cap (no token, URL, or persona/audio/task ID leakage in logs).
- R9. **P2 units (U10, U11, U12, U13, U15) are conditional on R2 + R2.1 PASS.** If R2 fails, halt P2; reopen vendor-fit decision.

**Origin:** This plan supersedes `docs/plans/2026-05-05-suno-voice-persona-integration-execplan.md` for hardening the implementation that already landed.

---

## Scope Boundaries

- Not enabling the feature in production; flag stays OFF until R1 + R2 + R2.1 met.
- Not introducing a new voice provider beyond Suno; OO-004's "two state machines" is structural cleanup of the existing Suno-only path.
- Not redesigning the upload-cover→generate-persona API contract with SunoAPI; pinning the response shape via fixture capture is in scope, contract negotiation is not.
- Not changing iOS error-handling. U4 routes structural failure to HTTP 422 from the API route specifically to avoid the iOS `RenderController.swift:888` catch-all that returns `("infra_terminal", "retry")` for unknown E302\_ codes.

### Considered Alternatives (and why this plan chose remediation)

- **Switch to Kits AI / self-hosted Seed-VC**: rejected for now because (a) Seed-VC already covers the non-persona path; persona is the differentiated experience that requires Suno's specific API; (b) provider-swap cost is high but not infinite (existing `provider-reviewer.md` shape suggests a multi-provider abstraction is already in the codebase) — this plan does not pre-commit to it but acknowledges as the exit path if R2.1 fails.
- **Replace Codex's implementation wholesale with SunoAPI's first-party SDK**: rejected because no first-party SDK exists for the wrapper at sunoapi.org. Direct sunoapi.com usage is a separate plan with its own integration cost.
- **Remove persona path entirely**: rejected because "song in your own voice" is the marquee differentiator. Conditional gating (R9) covers the case where this becomes the right call.

### Deferred to Follow-Up Work

- **AD-005 — E302\_ error namespace split**: defer to a separate plan once iOS error handlers are audited. Note: this plan's U4 sidesteps the issue by using HTTP 422 from the API route rather than a job-failure code.
- **`MANUAL_RECOVERY_REQUIRED` vs `MANUAL_CLEANUP_REQUIRED` rename**: cosmetic; defer.
- **Suno persona model selection upgrade** (try second candidate when first fails): out of scope for hardening; product decision.
- **Migrating `routes/enrollment.js:1108` and `auth-service.js:856` to `revokeEnrollmentSessionToken`**: this plan migrates ALL THREE in U3 (per R4). NOT deferred.
- **User-facing fallback messaging when persona render fails**: belongs in iOS UX plan, not this code plan.
- **Token TTL tightening for enrollment access_token**: surfaced by Security F2 (token-in-URL flows to SunoAPI). U3 mentions but full TTL/single-use redesign is a separate auth-service plan.

---

## Context & Research

### Relevant Code and Patterns

- `src/providers/suno-persona.js` — provider for upload-cover + generate-persona; 409 lines, 12 exports. `callBackUrl` default at line 160; `collectObjects` at lines 68–87; `extractSunoAudioId` at 89–107; `buildGeneratePersonaPayload` at 258–283 (defaults vocalStart=0/vocalEnd=30, validates 10–30s).
- `src/services/suno-voice-persona-service.js` — `runSunoVoicePersonaJob`; 391 lines. `hasSunoPersonaConsent` at 27–50; `assertProviderJobStillAllowed` at 113–130; consent fallback bug at line 108 (`providerProfile.consent_scope || session?.consent_version`); enrollment_sessions writes at 257, 365, 377; read at 117/168.
- `src/services/voice-provider-profile-service.js` — DB ops for both profile and job state machines; 460 lines, 17 exports. STATUS enum at 4–12; `sanitizeProviderError` at 31; `markProviderProfileCoverSubmitted` at 131–153 (writes wrong `STATUS.UPLOAD_SUBMITTED` at line 145).
- `src/workflows/render-contract.js` — 293 lines; `SUNO_VOICE_PERSONA_PIPELINE` is the only named pipeline constant; `resolveRenderContract` fallback at 94–97 produces incomplete contract for persona pipeline.
- `src/workflows/runner.js` — `getRuntimeMusicRoutingConfig` at 1205 (called 3× at 1269/1290/3410); `resolveSunoPersonaForRender` at 1622–1655; voice provider job lane at 4195–4335; lock SQL at 4209–4237.
- `src/providers/suno.js` — `normalizeSunoPersona` at 42–65; second `callBackUrl: "https://httpbin.org/post"` at line 343.
- `src/providers/music.js` — `renderWithProvider` accepts `sunoPersona` parameter; passes through to `generateMusicWithSuno`.
- `src/config.js` — pattern at 66–70 for env-var-with-fallback (`SUNO_API_KEY`, `SUNO_FILE_UPLOAD_BASE_URL`, `SUNO_MODEL`); export bundle at 208–211.
- `src/routes/enrollment.js:921` — writes `consentScope: REQUIRED_CONSENT_SCOPE` at profile creation; this is why the bug only fires when `consent_scope IS NULL` AND falls back to session.consent_version.
- `src/routes/enrollment.js:1108` and `src/services/auth-service.js:856` — existing `UPDATE enrollment_sessions SET access_token = NULL` patterns (R4 unifies all three).
- `migrations/pg/097_voice_provider_profiles.sql` and `migrations/097_voice_provider_profiles.sql` — both currently untracked. Edit-in-place safe.
- `PorizoApp/PorizoApp/Controllers/RenderController.swift:888` — catch-all for unknown E302\_ errors returns `("infra_terminal", "retry")`. R5's HTTP 422 path bypasses this entirely.

### Institutional Learnings

- Production claims-verification rule (`~/.claude/rules/porizo-feedback_verify_production_claims.md`): never claim a production fix works until verified with a live signal. Drives R2.
- Duplicate Function Rule (`CLAUDE.md`): when 2+ implementations exist with different behavior, trace consumers and consolidate. Drives R4 (token revocation unified across all three sites in U3, not just one).
- Database migration safety (`~/.claude/CLAUDE.md`): compare schemas before applying. Migrations 097 (untracked, edit in place), 098 (new for `consent_scopes` column).

### External References

- SunoAPI persona docs: `https://docs.sunoapi.org/suno-api/generate-persona` — upload-cover task ID flow.
- SunoAPI file retention: uploaded files deleted after 3 days; generated files retained for 15 days. Probe biometric data falls under this; documented in U16.

---

## Key Technical Decisions

- **Promote U6 (typed extractor) to P0; add U16 (instrumented probe) as pre-work.** Adversarial review surfaced that "Music does not exist" is far more likely caused by garbage `audioId` extraction than by `httpbin.org` callback. Deploying U1 alone and re-probing risks burning a probe cycle on a known-buggy extractor.
- **Edit migration 097 in place; add migration 098 for `consent_scopes` column.** Migration 097 is untracked; Railway re-runs migrations on boot via `runMigrations()`, so the edited 097 must be re-runnable (use `IF NOT EXISTS` and a DO block for FK addition). 098 is new and additive. SQLite test DB rebuild is documented; in-memory DB rebuilds per-test, so no migration replay risk.
- **Commit U2 to schema option (a): new `consent_scopes` column on `enrollment_sessions`.** Option (b) (treat `consent_version >= "1.0"` as Suno consent) would be fail-open — conflates enrollment-version with third-party-processing-scope. New column is the only correct path.
- **Add U17: backfill `enrollment_sessions.consent_scopes` from `voice_provider_profiles.consent_scope` for existing rows.** Without this, U2's fix flips already-consented users into "no consent" state at next render.
- **Fold persona feature flags into existing `getRuntimeMusicRoutingConfig` cache.** Already 3× call sites; additive change.
- **Extract `revokeEnrollmentSessionToken` into new `src/services/enrollment-session-service.js` AND migrate all three call sites in U3.** Per R4 and the Duplicate Function Rule. Auth-service is already 800+ lines; new file is the right home.
- **U4 routes structural failure to HTTP 422 from the API track-create route**, not as a job-failure E302* code. Avoids the iOS `RenderController.swift:888` catch-all that returns `retry` for unknown E302* codes (which would be wrong UX for an unrecoverable structural error).
- **U7 freshness budget = 5 seconds.** Defense-in-depth weighted toward catching cancellation. 30s would silently mask cancellations during the persona job's lock-window.
- **U6 fixture capture comes BEFORE typed extractor implementation.** U16 instruments the probe to capture the real response body; U6 builds the typed extractor against that fixture. `_legacyCollectFirstAudioId` removed entirely in U6 (no fallback) — failures throw with clear messaging.
- **U14 rewritten**: vocalStart/vocalEnd are NOT dead inputs (defaults to 0/30 with 10–30s validation in `buildGeneratePersonaPayload`). Real fix is server-side derivation of a sensible window from enrollment audio metadata, then explicit propagation through job step_data. Update payload builder to support omission only as a future-proofing.
- **U18 callback endpoint requires HMAC signature verification.** SUNO_CALLBACK_URL on a predictable path (`/internal/suno/callback`) is otherwise an unauthenticated write surface.
- **U15 (repo split) ships LAST and is conditional on R2 + R2.1.** Per R9: if vendor-fit fails, U15 is wasted work.

---

## Open Questions

### Resolved During Planning

- **Migration 097 strategy?** Edit in place (untracked, no environment has the unmodified version applied to keep around). Use `IF NOT EXISTS` everywhere + DO block for FK on re-apply.
- **U2 schema choice?** Option (a) committed: new `consent_scopes` column on enrollment_sessions, populated by enrollment-completion route, backfilled from existing `voice_provider_profiles.consent_scope`.
- **Should `vocalStart`/`vocalEnd` be wired through?** Yes, but they're not "dead" today (defaults exist). Real fix in U14 is to populate from server-side derivation in the enrollment route's `prepare_persona` step_data.
- **Single error point or two for U4?** Single. Validate at API track-create time → HTTP 422. The defense-in-depth check in `resolveSunoPersonaForRender` stays as a paranoia guard but should never fire.
- **U7 freshness budget value?** 5 seconds.
- **`_legacyCollectFirstAudioId` retained as fallback in U6?** No. Adversarial review correctly noted this preserves the bug. After U16 captures the real shape, U6's typed extractor is authoritative; failures throw `E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN` with the redacted response shape logged.

### Deferred to Implementation

- Final fixture content for `test/fixtures/suno-upload-cover-response.json` — depends on U16's probe.
- Exact split point for U15 between profile and job repositories — implementer decides based on import graph after U9 lands.
- HMAC algorithm + header name for U18 callback auth — likely `X-Suno-Signature` with HMAC-SHA256 over body, but coordinate with sunoapi.org docs.

---

## Implementation Units

### Phase 0 — Pre-work (must land before P0 fixes)

- U16. **Instrumented probe: capture Suno upload-cover response shape**

**Goal:** Eliminate the U6/R2 circular dependency by capturing a confirmed-successful upload-cover response body to a redacted fixture, before U6's typed extractor is finalized.

**Requirements:** R2

**Dependencies:** None — runs against the existing (buggy) code path.

**Files:**

- Modify: `tools/suno-persona-probe.js` (add response-body capture; redact tokens/URLs/IDs before write)
- Create: `test/fixtures/suno-upload-cover-response.json` (committed, redacted)
- Create: `test/fixtures/README.md` (document fixture provenance: which probe run, when, redaction rules)

**Approach:**

- Run the probe against SunoAPI sandbox (or production with `abcobimma@gmail.com` test data) using the **existing buggy** `collectObjects` but with raw-body logging enabled.
- Redact: Bearer tokens, full URLs (replace with `[REDACTED_URL]`), persona/audio/task IDs (replace with `task_REDACTED_<short-hash>` to preserve referential structure for the test).
- Write to `test/fixtures/suno-upload-cover-response.json`. Commit.
- Probe biometric data: confirm SunoAPI 3-day retention applies; do not re-upload after fixture capture.

**Execution note:** Probe runs against a real SunoAPI account; coordinate with operator. This is a one-shot data gathering, not a recurring test.

**Test scenarios:**

- Test expectation: none (this unit produces a fixture artifact, not behavior-bearing code).

**Verification:**

- Fixture file exists, parses as valid JSON, contains the expected top-level fields per SunoAPI docs.
- No raw token, URL, or unredacted ID in the file (`grep -E "Bearer|https?://" test/fixtures/` returns 0 matches in committed redacted file).

---

- U17. **Add `enrollment_sessions.consent_scopes` column + backfill**

**Goal:** Provide the canonical session-level consent-scope signal that U2's `enrollmentSessionHasPersonaConsent` reads. Backfill prevents already-consented users from breaking at next render.

**Requirements:** R3

**Dependencies:** None

**Files:**

- Create: `migrations/pg/098_enrollment_sessions_consent_scopes.sql`
- Create: `migrations/098_enrollment_sessions_consent_scopes.sql` (SQLite parity for tests)
- Modify: `src/routes/enrollment.js` (write `consent_scopes` at session creation; populate during `/enrollment/.../complete` from the persona-onboarding consent grant)
- Test: `test/voice-enrollment.test.js` (assert column populated; assert backfill correctness)

**Approach:**

- Migration 098 PG: `ALTER TABLE enrollment_sessions ADD COLUMN IF NOT EXISTS consent_scopes TEXT;` followed by backfill: `UPDATE enrollment_sessions es SET consent_scopes = (SELECT consent_scope FROM voice_provider_profiles vpp WHERE vpp.user_id = es.user_id AND vpp.consent_scope IS NOT NULL ORDER BY vpp.created_at DESC LIMIT 1) WHERE consent_scopes IS NULL;`
- SQLite mirror: same `ALTER TABLE ADD COLUMN` + backfill SELECT.
- Routes update: at session-completion time, write the same scope string that `voice_provider_profiles.consent_scope` carries (`REQUIRED_CONSENT_SCOPE`).
- Pre-merge audit query (manual): `SELECT COUNT(*) FROM voice_provider_profiles WHERE consent_scope IS NULL` — flag operator if non-zero (these rows need manual remediation).

**Execution note:** Run migration locally via `npm run db:reset && npm run db:up`; verify backfill against seeded fixtures.

**Patterns to follow:** Existing migration shape under `migrations/pg/`; existing column-add migrations.

**Test scenarios:**

- Happy path: fresh apply creates column; backfill copies the most-recent consent_scope per user.
- Edge case: re-apply on existing column is a no-op (`IF NOT EXISTS`).
- Edge case: user with no `voice_provider_profiles` row leaves `consent_scopes = NULL`.
- Edge case: user with only `consent_scope = NULL` profiles leaves `consent_scopes = NULL` (won't break, U2 handles null).
- Integration: enrollment-completion route writes the scope string after this migration applies.

**Verification:**

- `\d enrollment_sessions` shows the new column.
- Spot-check: a sampled row with prior persona consent shows non-null `consent_scopes` value.
- `npm test` passes.

---

- U18. **Stub `/internal/suno/callback` endpoint with HMAC signature verification**

**Goal:** Provide a real receiving endpoint for `SUNO_CALLBACK_URL` so U1 doesn't introduce a stub-routes-to-nowhere config; reject unauthenticated POSTs to avoid an unauthenticated write surface.

**Requirements:** R1, R6

**Dependencies:** None

**Files:**

- Create: `src/routes/internal-suno-callback.js`
- Modify: `src/server.js` (register route)
- Modify: `src/config.js` (add `SUNO_CALLBACK_HMAC_SECRET` env var)
- Test: `test/routes/internal-suno-callback.test.js` (assert reject without sig, accept with valid sig, no state change)

**Approach:**

- Route accepts POST `/internal/suno/callback`.
- Verify `X-Suno-Signature` header against HMAC-SHA256 of body using `SUNO_CALLBACK_HMAC_SECRET`.
- On valid sig: log a redacted event, return 200. **Do NOT mutate any state** in this stub. (Future: hook to `voice_provider_jobs` for async result delivery — out of scope here.)
- On invalid/missing sig: 401 + log redacted attempt for monitoring.

**Execution note:** Coordinate HMAC algorithm + header name with sunoapi.org docs/support before merge. If sunoapi.org provides no signing mechanism, fall back to allow-listing their IP range AND requiring a pre-shared secret in a query param (less ideal).

**Patterns to follow:** Existing internal route shape under `src/routes/`.

**Test scenarios:**

- Happy path: POST with valid HMAC sig returns 200, no state change.
- Error path: POST without sig returns 401.
- Error path: POST with wrong-secret sig returns 401.
- Edge case: empty body with valid (empty-body) sig returns 200.
- Integration: log line is redacted (no token, no URL, no persona/audio/task IDs).

**Verification:**

- New tests pass.
- Manual curl with valid sig returns 200; invalid sig returns 401.

---

### Phase 1 — P0: Production safety (must land atomically before R2 probe)

- U1. **Replace `httpbin.org` callback default with config-driven endpoint pointing to U18**

**Goal:** Stop POSTing Suno callback metadata to a public inspection service; require explicit configuration of an endpoint we control.

**Requirements:** R1, R6, R8

**Dependencies:** U18 (the receiving endpoint must exist).

**Files:**

- Modify: `src/config.js` (add `SUNO_CALLBACK_URL` with no default; add to required-when-feature-on validation)
- Modify: `src/providers/suno-persona.js` (line 160; `buildUploadCoverPayload` reads from config; throws when persona feature on AND missing)
- Modify: `src/providers/suno.js` (line 343; same)
- Test: `test/suno-persona-provider.test.js` (assert payload, error-on-missing)
- Test: `test/suno-provider.test.js` (same for `buildSunoPayload`)

**Approach:**

- Add `SUNO_CALLBACK_URL` to `src/config.js` with no default.
- Both `buildUploadCoverPayload` and the suno.js call site read from config.
- When `suno_voice_persona_enabled` is on AND `SUNO_CALLBACK_URL` is unset, throw at the first persona-job tick (NOT at boot — booting must succeed for non-persona paths even with feature off).
- Verify all test fixtures have `suno_voice_persona_enabled = false` so the throw never fires unrelated tests; document in `test/README.md` if missing.

**Execution note:** Test-first.

**Test scenarios:**

- Happy path: `buildUploadCoverPayload({uploadUrl, ...})` with config set returns payload using configured URL.
- Edge case: explicit `callBackUrl` argument overrides config (preserves test override).
- Error path: feature ON + config unset → throws including "SUNO_CALLBACK_URL".
- Error path: feature OFF + config unset → boots normally, payload builder not called.
- Integration: `buildSunoPayload` in suno.js reads same config (no second source of truth).

**Verification:**

- `grep -rn "httpbin" src/` returns 0 results outside test files.
- All P0 tests pass with feature flag OFF in fixtures.
- `npm test` full suite passes.

---

- U2. **Fix `hasSunoPersonaConsent` — split into two honest functions**

**Goal:** Eliminate the silent-deny bug where falling back to `session.consent_version = "1.0"` makes the consent gate always return false on the enrollment path.

**Requirements:** R1, R3, R6

**Dependencies:** U17 (provides the `consent_scopes` column that `enrollmentSessionHasPersonaConsent` reads).

**Files:**

- Modify: `src/services/suno-voice-persona-service.js` (lines 25–50, 108; replace `hasSunoPersonaConsent` with two functions; update all callers)
- Modify: `src/workflows/runner.js` (line 1643; uses scope-from-profile path)
- Test: `test/suno-voice-persona-service.test.js`
- Test: `test/voice-enrollment.test.js`

**Approach:**

- `hasPersonaConsentScope(consentScope: string)` — accepts JSON array, JSON object with `.scopes`, or delimited string. Used by `runner.js:1643` reading from `voice_provider_profiles.consent_scope`.
- `enrollmentSessionHasPersonaConsent(session)` — reads `session.consent_scopes` (the new column from U17), parses as scope-string. Returns false when null/empty.
- The current line 108 fallback chain `providerProfile.consent_scope || session?.consent_version` is replaced with `hasPersonaConsentScope(providerProfile.consent_scope) || enrollmentSessionHasPersonaConsent(session)`.
- Remove original `hasSunoPersonaConsent` export.

**Execution note:** Test-first. The latent bug means there are no tests covering the failing case — write the failing test first.

**Test scenarios:**

- Happy path: `hasPersonaConsentScope("voice_suno_persona_v1")` returns true.
- Happy path: `hasPersonaConsentScope('["voice_suno_persona_v1","other"]')` returns true.
- Happy path: `hasPersonaConsentScope('{"scopes":["voice_suno_persona_v1"]}')` returns true.
- Edge case: `hasPersonaConsentScope("1.0")` returns false (this is a version, not a scope).
- Edge case: `hasPersonaConsentScope(null)` and `("")` return false.
- Happy path: `enrollmentSessionHasPersonaConsent({consent_scopes: "voice_suno_persona_v1"})` returns true.
- Edge case: `enrollmentSessionHasPersonaConsent({consent_version: "1.0", consent_scopes: null})` returns false (no silent pass).
- Integration: line 108 fallback now uses both functions and both check the right field.

**Verification:**

- `grep -n "hasSunoPersonaConsent" src/` returns 0 matches.
- `grep -n "consent_version" src/services/suno-voice-persona-service.js` returns 0 matches.
- `npm test -- suno-voice-persona-service voice-enrollment` passes.

---

- U3. **Move ALL THREE `enrollment_sessions` token revocation sites into one named function**

**Goal:** Eliminate cross-domain SQL inside the persona service; consolidate three drift-prone implementations into one. Per R4 and the Duplicate Function Rule.

**Requirements:** R1, R4, R8

**Dependencies:** None

**Files:**

- Create: `src/services/enrollment-session-service.js` (export `getEnrollmentSession`, `revokeEnrollmentSessionToken`)
- Modify: `src/services/suno-voice-persona-service.js` (lines 117, 168, 257, 365, 377; replace inline SQL with imports)
- Modify: `src/services/auth-service.js` (line 856; replace inline SQL with import)
- Modify: `src/routes/enrollment.js` (line 1108; replace inline SQL with import)
- Test: `test/services/enrollment-session-service.test.js` (new)
- Test: `test/suno-voice-persona-service.test.js`, `test/auth-service.test.js`, `test/voice-enrollment.test.js` (regression assertions)

**Approach:**

- New `enrollment-session-service.js` exports `getEnrollmentSession(db, sessionId)` (returns id, access_token, consent_version, consent_scopes) and `revokeEnrollmentSessionToken(db, sessionId)`.
- Persona service: replace 4 inline SQL sites; no raw `enrollment_sessions` SQL remains in persona service.
- auth-service.js:856: was `WHERE user_id = ?` (revokes all sessions for user); add a sibling `revokeAllEnrollmentSessionTokensForUser(db, userId)` if needed, or migrate the call site to iterate sessions explicitly. Do NOT silently change semantics.
- routes/enrollment.js:1108: same — preserve original `WHERE user_id = ?` semantics if applicable.
- Add structured log emission inside `revokeEnrollmentSessionToken` (audit trail per Security F2 sub-concern).
- Acknowledge in code comments: `enrollment_sessions.access_token` is transmitted to SunoAPI in the upload-cover URL before this revocation runs (U3's revocation is post-use cleanup, not pre-use protection). Tightening to single-use tokens is tracked under "Deferred to Follow-Up Work."

**Execution note:** Behavior-preserving extraction. Existing tests must continue to pass.

**Test scenarios:**

- Happy path: `revokeEnrollmentSessionToken(db, "sess_123")` runs the UPDATE.
- Happy path: `revokeAllEnrollmentSessionTokensForUser(db, "user_x")` revokes all of user_x's sessions.
- Edge case: non-existent session ID — completes without error (UPDATE affects 0 rows).
- Integration: persona service's failure paths still revoke on permanent error.
- Integration: auth-service.js logout path still revokes (regression test).
- Integration: routes/enrollment.js completion path still revokes (regression test).
- Audit: each call emits a structured log entry with `{ event: "enrollment_session_token_revoked", session_id_redacted: "sess_xxx" }`.

**Verification:**

- `grep -rn "UPDATE enrollment_sessions" src/services/ src/routes/ src/workflows/` returns 0 matches outside `enrollment-session-service.js`.
- `npm test` full suite passes.

---

- U4. **Enforce frozen render contract at API track-create time; HTTP 422 instead of mid-render failure**

**Goal:** Persona renders cannot start without a frozen `voice_provider_profile_id`; failure is surfaced to the API caller as HTTP 422 (validation error), not as a mid-render job failure that flows through iOS's E302\_ catch-all as `("infra_terminal", "retry")`.

**Requirements:** R1, R5, R6

**Dependencies:** None

**Files:**

- Modify: `src/routes/tracks.js` (track-create handler — reject voice_mode=persona requests when user has no active profile with HTTP 422)
- Modify: `src/workflows/render-contract.js` (lines 94–97; fallback `buildRenderContract` rejects persona pipeline if `voiceProviderProfileId` not provided)
- Modify: `src/workflows/runner.js` (music_plan step ~lines 2290–2334 keeps existing `resolveSunoPersonaForRender` defense-in-depth check; should never fire after this unit)
- Test: `test/render-endpoints.test.js` (assert API returns 422)
- Test: `test/workflows/render-contract.test.js` (assert fallback throws)

**Approach:**

- API route: before queuing, check `voice_mode === "persona"` AND user has an active `voice_provider_profiles` row with `provider_profile_id IS NOT NULL`. If missing, return:
  ```
  HTTP 422 Unprocessable Entity
  { "error": "PERSONA_PROFILE_NOT_READY", "message": "Voice persona is not ready yet. Complete enrollment and persona preparation first." }
  ```
- Pre-deploy queue cleanup: write a one-shot script `tools/cleanup-orphan-persona-jobs.js` that finds existing `jobs` rows with `workflow_type='render'` AND status in `('queued','running')` AND track_versions.music_plan_json.render_contract.pipeline = `suno_voice_persona_complete_audio` AND voice_provider_profile_id IS NULL, and marks them `failed` with `last_error = "E302_SUNO_PERSONA_PROFILE_MISSING_AT_FREEZE: pre-existing job at deploy-time"`. Run before merging U4.
- The existing `resolveSunoPersonaForRender` check at `runner.js:1628` stays as paranoia guard but should never fire after this unit.

**Execution note:** Test-first. Construct the failing API request before writing the validator.

**Test scenarios:**

- Happy path: track-create with voice_mode=persona AND active profile → 200, render queued.
- Error path: track-create with voice_mode=persona AND no active profile → 422 with code `PERSONA_PROFILE_NOT_READY`.
- Error path: track-create with voice_mode=persona AND profile exists but `provider_profile_id IS NULL` → 422.
- Happy path: voice_mode=guide_tts (non-persona) without persona profile → 200 (orthogonal path).
- Integration: `resolveRenderContract` fallback throws when called with persona pipeline + missing id.
- Integration: existing in-flight queued jobs for persona pipeline are drained by the cleanup script (run-once).
- Covers R5: a render that gets past API-create with persona pipeline always has non-null `voice_provider_profile_id`.

**Verification:**

- New tests pass.
- iOS does NOT receive a job-failure callback for missing profile; instead, the API call returns 422 synchronously, which iOS already handles (form validation pattern).
- Cleanup script run on staging shows the expected count of cleaned jobs (audit log shows N affected).

---

- U6. **Typed extractor for Suno upload-cover response (using U16 fixture)**

**Goal:** Replace the opaque `collectObjects` graph traversal with a typed, fixture-backed extractor. Remove `_legacyCollectFirstAudioId` entirely — failures throw with diagnostic info.

**Requirements:** R1, R2, R6, R8

**Dependencies:** U16 (fixture file must exist).

**Files:**

- Modify: `src/providers/suno-persona.js` (lines 68–107; replace `collectObjects` + `extractSunoAudioId` with typed `extractAudioIdFromUploadCoverResponse`)
- Test: `test/suno-persona-provider.test.js` (use U16 fixture; assert direct extraction; assert no fallback exists)

**Approach:**

- Define `extractAudioIdFromUploadCoverResponse(response)` with explicit field-path walk based on the captured fixture (e.g., `response.data?.response?.audioId` or whatever U16 reveals).
- On unrecognized shape: throw `E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN` with redacted response shape (top-level keys only, no values) logged.
- Delete `collectObjects` and `_legacyCollectFirstAudioId` entirely. Per Open Question resolution: no fallback, fail-fast.
- Update tests to use the U16 fixture as the canonical happy-path response.

**Execution note:** Cannot start until U16 commits the fixture.

**Test scenarios:**

- Happy path: U16 fixture parses → returns the expected audioId.
- Edge case: response with empty/missing `data` field → throws `E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN` with shape log.
- Error path: malformed JSON (already failed at parse, not extractor's concern).
- Integration: `submitUploadCoverTask` → `pollUploadCoverForAudio` → extractor end-to-end with mocked fixture.

**Verification:**

- `grep -n "collectObjects\|_legacyCollectFirstAudioId" src/providers/suno-persona.js` returns 0 matches.
- New tests pass.
- During R2 probe re-run, typed extractor matches; no shape-unknown errors logged.

---

### Phase 2 — P1: Hardening before wider rollout

- U5. **Extract `provider-sanitize` utility; normalize 1000-char cap across all callers**

**Goal:** Single source of redaction; eliminate the cap asymmetry where `sanitizeProviderError` (voice-provider-profile-service.js:31) caps at 1000 chars but `sanitizeProviderMessage` (suno-persona.js:45) does not.

**Requirements:** R6, R8

**Dependencies:** None

**Files:**

- Create: `src/utils/provider-sanitize.js` (export `sanitizeProviderError(error)` with regex patterns + 1000-char cap)
- Modify: `src/providers/suno-persona.js` (replace `sanitizeProviderMessage` with import; remove from exports)
- Modify: `src/services/voice-provider-profile-service.js` (replace local `sanitizeProviderError` with import; remove from exports)
- Test: `test/utils/provider-sanitize.test.js` (assert each pattern + cap)

**Approach:**

- Move the function to `src/utils/provider-sanitize.js` with full pattern set AND `.slice(0, 1000)` at the end.
- Both modules import; remove local copies.
- The cap is now applied uniformly — fixes Security F5.

**Execution note:** Pure refactor; tests must pass identically before and after.

**Test scenarios:**

- Happy path: each redaction pattern (Bearer, URL, persona/audio/task IDs) asserted.
- Edge case: 1500-char input returns ≤ 1000 chars (regression on `sanitizeProviderMessage` missing cap).
- Edge case: null/undefined inputs return `"unknown_error"`.
- Integration: importing from both consumer modules produces identical output for identical input.

**Verification:**

- `grep -n "function sanitizeProviderError\|function sanitizeProviderMessage" src/` returns 1 result (in `src/utils/provider-sanitize.js`).
- `grep -n "\.slice(0, 1000)" src/utils/provider-sanitize.js` returns 1 result.
- `npm test` full suite passes.

---

- U7. **Separate guard from refresh in `assertProviderJobStillAllowed`; 5s freshness budget**

**Goal:** Reduce ~15 DB round trips per persona job to 3–4 by separating "is this job still allowed" from "fetch fresh state for me to continue with."

**Requirements:** R6

**Dependencies:** None

**Files:**

- Modify: `src/services/suno-voice-persona-service.js` (lines 113–130; split into `assertProviderJobStillAllowed` (uses cached state) and `refreshProviderJobState` (fetches))
- Test: `test/suno-voice-persona-service.test.js` (assert call count via DB-spy)

**Approach:**

- Introduce 5-second freshness budget (security-leaning: catches cancellations within 5s window; not 30s which would silently mask).
- Refresh fires automatically after every external API call (~30s latency anyway, so the refresh cost is small relative).
- Guards between local steps use cached state.
- Net: 5+ guard calls × 3 DB reads (15) → ~3 refreshes × 3 DB reads (9) + cheap in-memory checks.

**Test scenarios:**

- Happy path: 5 sequential guards within 5s window issue 1 DB read total (initial fetch).
- Happy path: refresh after a 30-second external call issues 3 fresh reads.
- Edge case: cancellation between two guards within 5s — detected at next refresh after external call (acceptable lag per security model).
- Edge case: cancellation between two guards across 5s boundary — detected at next guard (forces re-fetch since cache is stale).
- Integration: full happy path job execution issues ≤ 12 DB reads against `voice_provider_jobs` + `voice_provider_profiles` + `enrollment_sessions` (down from ~15).

**Verification:**

- New tests assert DB-spy call counts.
- `npm test -- suno-voice-persona-service` passes.

---

- U8. **Fold persona feature flags into `getRuntimeMusicRoutingConfig` cache**

**Goal:** Eliminate two synchronous DB reads per render tick for persona feature flags.

**Requirements:** R6

**Dependencies:** None

**Files:**

- Modify: `src/workflows/runner.js` (line 1205 adds `personaModel` and `audioWeight` to config blob; line 1622–1655 reads from passed-in config)
- Test: `test/workflows/personalized-highway.test.js`

**Approach:**

- Extend cached blob with `suno_voice_persona_persona_model` (default `"voice_persona"`) and `suno_voice_persona_audio_weight` (default 0.85).
- Pass `runtimeConfig` into `resolveSunoPersonaForRender` from the caller.
- Existing 3 call sites unchanged (additive).

**Test scenarios:**

- Happy path: config blob contains both persona fields with defaults.
- Happy path: setting `suno_voice_persona_audio_weight = 0.6` reads 0.6 from cache.
- Edge case: `resolveSunoPersonaForRender` works when called without explicit runtimeConfig (back-compat).
- Integration: render path issues 1 routing-config DB read, not 3.

**Verification:**

- `grep -n "getFeatureFlag.*persona" src/workflows/runner.js` returns 0 results in hot path.
- `npm test -- personalized-highway` passes.

---

- U9. **Add `COVER_SUBMITTED` status; fix `markProviderProfileCoverSubmitted`** (promoted from P2 to P1)

**Goal:** Distinguish file-upload submission from cover-generation submission in the profile state machine. **Promoted to P1 because this is a correctness bug (wrong status persisted), not structural cleanup.**

**Requirements:** R6

**Dependencies:** None

**Files:**

- Modify: `src/services/voice-provider-profile-service.js` (lines 4–12 STATUS enum; line 145 uses new status)
- Test: `test/voice-provider-profile-service.test.js`

**Approach:**

- Add `COVER_SUBMITTED: "cover_submitted"` to STATUS.
- Update `markProviderProfileCoverSubmitted` to write `STATUS.COVER_SUBMITTED`.
- Pre-merge: `grep -rn "status === ['\"]upload_submitted['\"]\|status: ['\"]upload_submitted['\"]" test/` to find tests asserting the old (buggy) behavior; update them to assert new state machine.
- No production rows at risk (feature OFF). Local dev rows: documented; no backfill required since feature was never on in prod.

**Test scenarios:**

- Happy path: `markProviderProfileCoverSubmitted` stores `"cover_submitted"`.
- Edge case: state machine `pending` → `upload_submitted` → `cover_submitted` → `persona_submitted` → `active` exercised end-to-end.
- Integration: persona service correctly transitions through cover_submitted state.
- Regression: any test fixture asserting `status = "upload_submitted"` after cover submission is updated.

**Verification:**

- `grep -rn "upload_submitted" src/` shows only file-upload-stage consumers (≤ 2 sites).
- `npm test` full suite passes.

---

- U14. **Server-side derive `vocalStart`/`vocalEnd` for persona generation; populate via job step_data** (promoted from P2 to P1)

**Goal:** The audio-window parameters affect persona quality. Currently they're DEFAULTED (vocalStart=0, vocalEnd=30 in `buildGeneratePersonaPayload:258-283`), not dead. Real fix: server-side derive a sensible vocal window from enrollment audio metadata, then populate `step_data` so the values flow through `runSunoVoicePersonaJob` to `generatePersona`. **Promoted to P1 because the R2 probe needs accurate audio-window parameters to produce a meaningful quality signal.**

**Requirements:** R6, R2

**Dependencies:** None

**Files:**

- Modify: `src/routes/enrollment.js` (`prepare_persona` step_data population — add `vocal_start`, `vocal_end` fields derived from enrollment audio; default to skip-first-5s, take-next-20s if metadata unavailable)
- Modify: `src/services/suno-voice-persona-service.js` (line 297 region; thread vocalStart/vocalEnd from step_data → generatePersona)
- Modify: `src/providers/suno-persona.js` (`buildGeneratePersonaPayload`; verify defaults still kick in when fields absent — current behavior is correct)
- Test: `test/voice-enrollment.test.js` (assert step_data populated)
- Test: `test/suno-voice-persona-service.test.js` (assert values reach payload)

**Approach:**

- Enrollment route's persona-job creation: read `voice_profiles.duration_seconds` (or equivalent metadata); compute `vocal_start = min(5, duration*0.1)`, `vocal_end = vocal_start + min(20, duration - vocal_start)`. Validate result is within Suno's [10s, 30s] range; clamp if needed.
- Persona service: read from step_data, pass through.
- `buildGeneratePersonaPayload` already accepts these and validates [10s, 30s] duration; no payload-builder change needed.
- Validation at enrollment route (not at payload build): if computed window is invalid, fall back to default 0/30 and log a warning.

**Execution note:** Test-first.

**Test scenarios:**

- Happy path: 60-second enrollment → step_data has `vocal_start=5, vocal_end=25`; payload reflects.
- Edge case: 12-second enrollment → step_data has `vocal_start=1.2, vocal_end=11.2`; clamped to ensure ≥10s duration.
- Edge case: enrollment metadata missing → step_data has defaults `vocal_start=0, vocal_end=30`; warning logged.
- Error path: invalid range survives validation but `buildGeneratePersonaPayload` throws — test asserts the right error code.
- Integration: full job execution with realistic audio window improves persona quality (subjective; not auto-tested but logged for R2 review).

**Verification:**

- New tests pass.
- During R2 probe: confirm SunoAPI receives the values via request-body capture in U16.

---

### Phase 3 — P2: Structural cleanup (CONDITIONAL on R2 + R2.1 PASS per R9)

> **Gate:** If R2 (clean code path) or R2.1 (vendor confirmation) fails, halt P2 work; reopen vendor-fit decision per "Considered Alternatives." P2 is Suno-specific and would be sunk on a pivot.

- U10. **Export all 4 pipeline constants; rename opaque values**

**Goal:** All four pipeline values are named module-level constants; consumers reference constants, not bare strings.

**Requirements:** R6

**Dependencies:** R2 + R2.1 PASS.

**Files:**

- Modify: `src/workflows/render-contract.js` (define and export all 4)
- Modify: `src/workflows/runner.js`, `src/providers/music.js` (import constants)
- Test: `test/workflows/render-contract.test.js`

**Approach:**

- Define and export:
  - `GUIDE_TTS_PIPELINE = "guide_tts_and_voice_convert"`
  - `PROVIDER_FULL_TRACK_PIPELINE = "provider_complete_audio"`
  - `SUNO_VOICE_PERSONA_PIPELINE = "suno_voice_persona_complete_audio"` (already exists)
  - `PROVIDER_PERSONALIZED_CONVERT_PIPELINE = "provider_audio_personalized_convert"`
- Migrate consumers to import constants. **Do NOT change wire values** (`render_contract.pipeline` on existing tracks).
- Verify with grep: no bare-string pipeline references outside render-contract.js and tests.

**Test scenarios:**

- Happy path: importing each constant returns the expected wire value.
- Edge case: existing track with `render_contract.pipeline = "provider_complete_audio"` resolves correctly.
- Integration: full render pipeline test still passes after rename.

**Verification:**

- `grep -rn "\"provider_complete_audio\"\|\"provider_audio_personalized_convert\"\|\"guide_tts_and_voice_convert\"" src/ | grep -v render-contract.js | grep -v test/` returns 0 results.

---

- U11. **Move voice-provider lock SQL into the job repository**

**Goal:** Lock-management SQL lives alongside the data layer it operates on, not inline in `runner.js`.

**Requirements:** R6

**Dependencies:** R2 + R2.1 PASS.

**Files:**

- Modify: `src/services/voice-provider-profile-service.js` (add `acquireVoiceProviderLock`, `releaseVoiceProviderLock`, `heartbeatVoiceProviderLock` exports)
- Modify: `src/workflows/runner.js` (lines 4209–4237; replace inline SQL with imported functions)
- Test: `test/voice-provider-profile-service.test.js`

**Approach:** Move three functions verbatim from runner.js to the service file; export and import.

**Test scenarios:**

- Happy path: acquire → heartbeat → release. Re-acquire by another runner fails.
- Edge case: stale lock acquirable by new runner.
- Integration: existing runner-lane tests pass with imported functions.

**Verification:** `grep -n "INSERT INTO voice_provider_locks" src/workflows/runner.js` returns 0 results.

---

- U12. **Add FK constraint with pre-migration orphan-row cleanup gate**

**Goal:** Schema-level cascade safety against orphaned profiles. Pre-migration check prevents service crash on FK addition against orphaned data.

**Requirements:** R6

**Dependencies:** R2 + R2.1 PASS.

**Files:**

- Modify: `migrations/pg/097_voice_provider_profiles.sql` (in place — currently untracked; add FK)
- Modify: `migrations/097_voice_provider_profiles.sql` (SQLite parity — inline `REFERENCES`)
- Create: `tools/check-orphan-voice-provider-profiles.sql` (audit script)

**Approach:**

- Pre-migration audit: `SELECT COUNT(*) FROM voice_provider_profiles vpp LEFT JOIN voice_profiles vp ON vp.id = vpp.voice_profile_id WHERE vp.id IS NULL`. If non-zero, halt and resolve manually (delete orphans or restore voice_profiles rows). Document this as a Run-Once-Before-Merge step.
- PG migration: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vpp_voice_profile') THEN ALTER TABLE voice_provider_profiles ADD CONSTRAINT fk_vpp_voice_profile FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id); END IF; END $$;`
- SQLite mirror: SQLite doesn't support `ALTER TABLE ADD CONSTRAINT` for FKs. Since 097 is untracked and test DBs are in-memory (rebuild per test), edit the SQLite migration in-place to add `REFERENCES voice_profiles(id)` inline at CREATE TABLE time. Document that any persisted SQLite dev DB must be reset.

**Test scenarios:**

- Happy path: fresh apply creates table with FK (PG and SQLite).
- Happy path: re-apply on existing PG table without FK adds the FK via DO block.
- Edge case: re-apply on table with FK already present is a no-op.
- Edge case: insert with non-existent voice_profile_id fails with FK violation.
- Pre-merge audit: orphan-row count is 0 across all environments.

**Verification:**

- Apply migration locally: `npm run db:reset && npm run db:up`. Verify FK exists via `\d voice_provider_profiles`.
- Run `tools/check-orphan-voice-provider-profiles.sql` against staging via `railway connect postgres` before merge.

---

- U13. **Reduce `suno-persona.js` exports from 12 to 5**

**Goal:** Public surface is the orchestration facade + step functions consumed by `suno-voice-persona-service.js`. Internals not exported.

**Requirements:** R6

**Dependencies:** R2 + R2.1 PASS, U5, U6, U9.

**Files:**

- Modify: `src/providers/suno-persona.js` (lines 396–409; reduce exports)
- Modify: `test/suno-persona-provider.test.js` (any test importing internals must move to facade tests)

**Approach:**

- Public exports (5): `createPersonaFromSourceUrl`, `submitUploadCoverTask`, `pollUploadCoverForAudio`, `generatePersona`, `uploadFileUrl`.
- Drop: `DEFAULT_UPLOAD_BASE_URL`, `buildGeneratePersonaPayload`, `buildUploadCoverPayload`, `extractAudioIdFromUploadCoverResponse` (was `extractSunoAudioId`), `normalizeAudioWeight`, `redactedId`, `sanitizeProviderMessage` (already gone after U5).
- Note: U6 replaces `extractSunoAudioId` with `extractAudioIdFromUploadCoverResponse`; both versions are internal-only after U13. Final count: exactly 5.

**Test scenarios:**

- Verification: `Object.keys(require('./src/providers/suno-persona'))` length is exactly 5.
- Each remaining export exercised by at least one test through the facade.

**Verification:** `npm test -- suno-persona-provider` passes after test migration.

---

- U15. **Split `voice-provider-profile-service.js` into profile + job repositories**

**Goal:** Two state machines, two files. Reduce 460-line file with 17 exports.

**Requirements:** R6 (addresses OO-004)

**Dependencies:** R2 + R2.1 PASS, U5, U9, U11, U13. **Defer if any earlier P0/P1 unit slips** (not just earlier P2).

**Files:**

- Create: `src/services/voice-provider-profile-repository.js`
- Create: `src/services/voice-provider-job-repository.js`
- Delete: `src/services/voice-provider-profile-service.js`
- Modify: All importers — `src/services/suno-voice-persona-service.js`, `src/workflows/runner.js`, `src/routes/enrollment.js`, possibly `src/routes/tracks.js`.
- Test: split or describe-block-rename `test/voice-provider-profile-service.test.js`.

**Approach:**

- Profile-repository: profile creation, status transitions (pending → upload_submitted → cover_submitted → persona_submitted → active / failed / cancelled / deleted), reads.
- Job-repository: job creation, status transitions, locks (from U11), step transitions, retry counters.
- Splitting STATUS: keep one file owning the enum if values overlap (likely the profile repository); job repository imports.

**Execution note:** Pure refactor. Tests must pass before AND after with no semantic change.

**Test scenarios:**

- All existing tests re-run against split with import paths updated. No new behavioral tests.
- Integration: persona service end-to-end test passes.

**Verification:**

- `npm test` full suite passes.
- Each new file < 300 lines.

---

## System-Wide Impact

- **Interaction graph:** P0 fixes touch the API track-create route, render-contract resolution, music-plan freeze step, persona-job lane, and enrollment-session token revocation. Cross-cutting on the persona pipeline only — no impact on `guide_tts_and_voice_convert` or `provider_complete_audio` paths.
- **Error propagation:** U4 routes structural failure to HTTP 422 from the API, sidestepping the iOS catch-all. New error code `E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN` (U6) only fires inside the runner if the typed extractor encounters an unrecognized shape — should be caught during R2 probe before any user impact.
- **State lifecycle risks:** U9 introduces a new state value; migration is documentation-only since `status` is TEXT. Pre-merge grep confirms no test asserts the old buggy value as expected. U17 backfills `consent_scopes` for existing rows.
- **API surface parity:** Track-create returns a new HTTP 422 in U4. iOS already handles 422 from other endpoints (form validation pattern); no iOS code change required.
- **Integration coverage:** R2 (live re-probe) is the integration verification for U1–U6. Plan execution does not include the probe itself — that's an operator step after P0 lands. The plan ensures the code is correct AND captures the response shape (U16) AND drains in-flight queued jobs (U4).
- **Unchanged invariants:** Existing `guide_tts_and_voice_convert` and `provider_complete_audio` pipelines unchanged. Voice enrollment flow unchanged except for additive `consent_scopes` column. Existing render-contract freeze for non-persona pipelines unchanged. Billing-hold flow unchanged. iOS error handling unchanged.

---

## Risks & Dependencies

| Risk                                                                                   | Mitigation                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1 introduces required config; production deploys without it.                          | Required only when feature flag ON (flag stays OFF). U18 ensures the receiving endpoint exists before flag flip.                                        |
| U2 reveals other call sites passing version strings expecting scope semantics.         | Static-search before merge; adjust call sites in same PR. Listed in test scenarios.                                                                     |
| U3 migration breaks if existing call sites had subtle differences.                     | All three migrate atomically in U3; regression tests assert semantic preservation per call site.                                                        |
| U4 leaves in-flight queued jobs stuck.                                                 | `tools/cleanup-orphan-persona-jobs.js` run-once script drains them at deploy.                                                                           |
| U6 typed extractor wrong if U16 fixture is stale or atypical.                          | Throws `E302_SUNO_PERSONA_AUDIO_SHAPE_UNKNOWN` with shape log. Re-run U16 if needed. No silent fallback to garbage extraction.                          |
| U12 FK can fail on orphaned rows.                                                      | Pre-merge orphan-count audit query; halt and remediate manually if non-zero.                                                                            |
| U14 server-derived window too aggressive on short enrollments.                         | Validation at enrollment route clamps to [10s, 30s]; falls back to default with warning if unclamped fails.                                             |
| U15 lands while P0/P1 fixes are mid-rollout, causing merge conflicts.                  | Sequence U15 last; conditional on R2 + R2.1 PASS per R9.                                                                                                |
| Production probe re-attempts before all P0 verified.                                   | R7 amended: P0 ships as a single PR atomically — partial-then-flip is impossible at the commit level. R1 enforces full P0 + R2 + R2.1 before flag flip. |
| sunoapi.org behavior changes between U16 capture and R2 probe.                         | Capture timestamp + version recorded in `test/fixtures/README.md`. Re-run U16 if `npm test` fails on shape mismatch.                                    |
| U17 backfill picks wrong scope for users with multiple `voice_provider_profiles` rows. | Backfill ORDER BY created_at DESC LIMIT 1 — most recent wins. Correct per intent (latest consent supersedes).                                           |
| U18 callback endpoint receives unsigned/spoofed POSTs.                                 | Public SunoAPI docs do not document a provider signature header, so production uses a high-entropy callback URL token; optional HMAC header support remains additive. Stub does NOT mutate state. |
| Vendor-fit (R2.1) fails after P0 ships.                                                | P1 partially salvageable (U5, U7, U8 are generic). P2 (U9, U10, U11, U12, U13, U15) halted per R9. Plan documents exit path.                            |
| Token-in-URL biometric exposure to SunoAPI logs (Security F2).                         | Acknowledged in U3; tightening to single-use tokens deferred to follow-up auth-service plan. R3 ensures revocation post-use.                            |

---

## Documentation / Operational Notes

- **PR descriptions** for each unit must reference the architecture review finding ID (per Findings Coverage Map above).
- **P0 atomic PR**: U1, U2, U3, U4, U6, U16, U17, U18 ship as a single PR. U5–U14 ship per-unit. U10–U15 conditional on R2 + R2.1.
- **Pre-merge gates for P0 PR**:
  - [x] `npm test` passes; `npm run lint` clean.
  - [x] U16 fixture committed from live probe.
  - [x] U17 backfill applied by migration runner during Railway cleanup gate.
  - [x] U18 endpoint covered locally with valid query-token auth and invalid auth rejection. Public SunoAPI docs do not document HMAC headers; `X-Suno-Signature` remains optional future-compatible support only.
  - [x] `tools/cleanup-orphan-persona-jobs.js --apply` ran against the linked Railway database using `DATABASE_PUBLIC_URL`; scanned 0 in-flight render jobs and changed no rows. Railway project currently exposes only `production`, not a separate `staging` environment.
  - [x] `SUNO_CALLBACK_URL` and `SUNO_CALLBACK_HMAC_SECRET` set in Railway and verified by key presence/secret length. Callback URL uses `?token=[redacted]`.
  - [ ] R2.1 vendor confirmation remains required before any flag flip.
- **R2 probe procedure**:
  1. Deploy P0 PR to staging.
  2. Run `tools/suno-persona-probe.js` against test user; capture raw response to `test/fixtures/suno-upload-cover-response.json` (verify against U16 capture — should match).
  3. Verify generate-persona returns valid `personaId`; verify next render uses persona without "Music does not exist".
  4. If R2 PASSES, request R2.1 confirmation from sunoapi.org/Suno support; document in `tasks/lessons.md`.
  5. Only after R2 + R2.1 PASS: schedule P2 conditional units.
- **Lessons file**: updated with the callback-auth finding: do not invent webhook signatures for vendors that only document callback URLs.
- **Memory file update**: note `SUNO_CALLBACK_URL`, `SUNO_CALLBACK_HMAC_SECRET` as required configs; callback URL token is the production auth path unless SunoAPI confirms a signed-header contract.

---

## Sources & References

- **Origin execplan:** `docs/plans/2026-05-05-suno-voice-persona-integration-execplan.md`
- **Architecture review** (in-session, 2026-05-05): three reviewers (OO Design, Clean Architecture, API Design); 17 findings (OO-001..007, CA-001..005, AD-001..005); verdict CHANGES_REQUESTED.
- **Document review** (in-session, 2026-05-05): six reviewers (coherence, feasibility, adversarial, security-lens, scope-guardian, product-lens). Findings synthesized into this plan revision (deepened: 2026-05-05).
- **Production probe failure**: user `abcobimma@gmail.com`, 2026-05-05. "Music does not exist" / "create persona error". Root cause re-evaluated to audio-id extraction (not callback URL) per adversarial review.
- **Suno API docs**: https://docs.sunoapi.org/suno-api/generate-persona
- Related code: `src/providers/suno-persona.js`, `src/services/suno-voice-persona-service.js`, `src/services/voice-provider-profile-service.js`, `src/workflows/render-contract.js`, `src/workflows/runner.js`, `src/routes/enrollment.js`, `src/services/auth-service.js`, `src/routes/tracks.js`, `PorizoApp/PorizoApp/Controllers/RenderController.swift`.
- Project rules: `~/.claude/rules/porizo-feedback_verify_production_claims.md`, `~/.claude/rules/porizo-feedback_consolidation_over_safety.md`, `CLAUDE.md` Duplicate Function Rule.
