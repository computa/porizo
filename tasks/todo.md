# Active Plan — Father's Day v1.5.12 path-to-submit (2026-05-20)

User: "proceed sequentially and complete all" — audit verdict NO-GO (3 blockers + 7 warnings).

## Phase 1 — Quick audit fixes (DONE — commit a99d328)

- [x] B1 — drop "1-minute" claim from v1.5.12 promotionalText + whatsNew
- [x] W1 — align privacy.html IP-hashing wording to backend reality
- [x] W4 — add AI-content disclosure footer to shared web-player + anchor in terms.html

## Phase 2 — B2 voice consent UI (IN PROGRESS)

- [x] APIClient+Enrollment.swift — `startEnrollment(consentAccepted:)` requires explicit consent
- [ ] EnrollmentFlowView.swift — `@State consentChecked = false`
- [ ] EnrollmentFlowView.swift — consent Toggle row above CTAs with terms + privacy links
- [ ] EnrollmentFlowView.swift — disable Start Recording until consentChecked
- [ ] EnrollmentFlowView.swift — pass consentChecked into apiClient.startEnrollment
- [ ] Build verify + commit

## Phase 3 — #15 pre-prompt rating sheet

- [ ] ReviewPrePromptSheet.swift (yes/no survey)
- [ ] ReviewManager: showPrePrompt notifier + suppression after "no"
- [ ] Wire NotificationCenter listener in RootView
- [ ] Commit

## Phase 4 — #16 recipient-played APNs

- [ ] Backend: APNs push in receiver_play_completed path
- [ ] iOS: PushPayloadParser.parseRecipientPlayed
- [ ] iOS: didReceiveRemoteNotification handler + NotificationCenter event
- [ ] ReviewManager: recordRecipientPlayed primary trigger
- [ ] Commit

## Phase 5 — #17 ReviewManager threshold tuning

- [ ] playsBeforeFirstPrompt → 5
- [ ] sharesBeforeFirstPrompt → 2
- [ ] Commit

## Out of scope this session (need user action)

- B3 — Apple Distribution cert install (Xcode → Settings → Accounts)
- #13/#14 — ASA campaign moves (requires ASA UI access)

---

# Per-Song Occasion Artwork System (DONE — 2026-05-16)

> Plan: `/Users/ao/.claude/plans/during-the-design-phase-resilient-pony.md`
> Status: **All 8 batches complete. 72/72 artwork tests passing. Full suite 513/513 (0 regressions).**
> Full multi-agent code review pass: 10 reviewers, 24 findings resolved (P0×3, P1×8, P2×13). One false positive dropped (CORR-001).

## Batch 1 — Foundation

- [x] Migration 109 PG (`migrations/pg/109_add_artwork_columns.sql`)
- [x] Migration 109 SQLite (`migrations/109_add_artwork_columns.sql`)
- [x] `src/storage/index.js` — `trackArtworkKey`, `trackArtworkSurfaceKey`
- [x] `src/services/artwork-prompts.js` — 15 occasions × 3 styles
- [x] `src/services/image-providers/openai-image.js` — `gpt-image-2` adapter
- [x] `src/services/image-providers/index.js` — provider registry
- [x] `src/utils/og-text-utils.js` — `detectDirection`, `localizedForPrefix`

## Batch 2 — Core service

- [x] `src/services/cover-generator.js` — `compositeArtworkWithText` with Fraunces, fitName tiers, RTL, 3 aspects
- [x] `src/services/song-artwork.js` — orchestrator + content-hash idempotency
- [x] `src/services/fonts/Fraunces-VariableFont.ttf` — embedded font (OFL, with LICENSE.txt)

## Batch 3 — Jobs + workflow

- [x] `src/jobs/artwork-job.js` — job handler with tier branching
- [x] `src/workflows/runner.js` + `src/workflows/artwork-barrier.js` + `src/routes/tracks.js` — enqueue artwork on render start, READY barrier check

## Batch 4 — Routes

- [x] `src/routes/artwork.js` + `src/server.js` — `GET /tracks/:trackId/artwork.jpg` with HMAC + share-token + owner auth
- [x] `src/routes/sharing.js` + `web-player/index.html` — prefer artwork_url, `?av=` artwork cache busting, LPLinkMetadata, dark mode chrome

## Batch 5 — Bootstrap

- [x] `scripts/build-artwork-library.mjs` — generate 45 base images

## Batch 6 — iOS

- [x] `Models/TrackModels.swift` — `artworkUrl: String?` + `artworkStyleVariant: String?`
- [x] `NowPlayingView.swift` — AsyncImage with phase-aware placeholder + 200ms cross-fade
- [x] `Controllers/PlaybackController.swift` — two-phase MPNowPlayingInfoCenter push; cleanup() cancels fetch + nils cached image; weak-self capture; URL-equality guard
- [x] `TrackPlayerFullView.swift` — wires `track.artworkUrl` → `playbackController.artworkUrl`

## Batch 7 — Tests (now at `test/` — CI runs them)

- [x] `test/fixtures/recipient-names.json`
- [x] `test/services/song-artwork.test.js` — 40 tests (style picker, content hash, idempotency, tier branching, moderation fallback, fitName tiers + boundaries, RTL detection, SVG generation, buildPrompt allowlist + PII containment, LIBRARY_NOT_BOOTSTRAPPED permanent error)
- [x] `test/jobs/artwork-job.test.js` — 23 tests (DB I/O, retry semantics, permanent-error fast-fail, tier resolver, admin_upgrade rollup, effectiveTierFromRow)
- [x] `test/workflows/artwork-barrier.test.js` — 9 tests
- [x] **72/72 artwork tests passing; full project 513/513 (0 regressions)**

## Batch 8 — Code review pass (10 reviewers, 24 findings resolved)

- [x] **P0.1** ARTWORK_HMAC_SECRET hardening — production boot refuses to start without env var
- [x] **P0.2** Move `tests/` → `test/` so CI actually runs the suite (verified: 72 tests now picked up)
- [x] **P0.3** `SQL_MARK_ARTWORK_READY` scoped to `track_version_id`, not `track_id` — preview/full no longer cross-contaminate
- [x] **P1.1** Anonymous unfurl 401 fix — only invoke `requireUserId` when Authorization header present, no more double-send 500s
- [x] **P1.2** Tier resolution via injected `subscriptionManager.getEffectiveTier` — honors expired subs + admin_upgrade
- [x] **P1.3** Path-traversal defense-in-depth — UUID-pattern regex + prefix check
- [x] **P1.4** S3 upload after composite + `ensureLocalFileFromStorage` on read — production fetches no longer 404
- [x] **P1.5** OCCASION_COLORS + formatOccasion add `mothers_day`, `friendship`, `get_well`
- [x] **P1.6** AbortController + 120s clamped timeout on OpenAI fetch — no more hung promises
- [x] **P1.8** Entitlements DB error retries instead of silent free-tier demotion
- [x] **P2.1** STYLE_LIST sourced from VALID_STYLES (single source of truth) + comment documenting order is load-bearing
- [x] **P2.3** Permanent-error fast-fail — LIBRARY_NOT_BOOTSTRAPPED skips the 65s retry chain
- [x] **P2.4** Barrier env vars clamped to safe ranges with NaN guard
- [x] **P2.5** Exponential polling backoff in the barrier
- [x] **P2.6** Error response shape uses sendError (UPPER_SNAKE, message) — matches project standard
- [x] **P2.7** `share_token` lookup matches `id` only (decoupled from HLS stream_key)
- [x] **P2.8** PlaybackController.cleanup() cancels artworkFetchTask + nils cachedArtworkImage
- [x] **P2.9** HMAC drops slice(0,16) — full 256-bit tag, base64url
- [x] **P2.10** moderationPassed accurately reflects state: true on success, false on moderation refusal, **null** on non-moderation errors
- [x] **P2.11** Backoff mutation in tests wrapped in try/finally restore helper
- [x] **P2.12** Added boundary tests for fitName (12/13/18/19/28/29) + buildPrompt validation + permanent-error contract
- [x] **P2.13** `signArtworkUrl` wired into `buildSignedArtworkUrl` on server.js — capability surface no longer dead
- [x] **maint cleanup** — removed unused exports (`trackArtworkSurfaceKey`, `FRAUNCES_FONT_PATH`, `listProviders`)
- [x] **CORR-001 false positive** dropped after empirical verification — Hebrew regex correctly excludes Arabic

## Remaining residuals (acknowledged, non-blocking)

- **adv-006 / P1.7 (deferred)** artwork-job uses `setImmediate` not a `jobs` table row — SIGTERM mid-render drops work. Durable queue is a follow-up; the current best-effort path is documented in the file header.
- **adv-005 (acknowledged)** gpt-image-2 may leak text despite "no text" prompts. Mitigation: manual human review of the 45 library images during bootstrap (see plan §Acceptance criteria). 2× re-roll budget in cost model.
- **DM-002 (acknowledged)** historical READY tracks don't have `audio_ready=true` backfilled — audit-only impact; new tracks set the flag correctly.
- **CORR-005** filename mismatch `artwork_1.91x1.jpg` vs surface key — unreachable today (1.91:1 OG composite is generated lazily; not yet wired to a caller).
- **CORR-007** 65s retry chain vs 60s barrier — attempt 3 always lands after release. Acceptable: barrier releases READY with `artwork_url=NULL`, artwork populates on the retry.

---

# Cold-email: fire ~10×/day instead of 1×/day (ACTIVE — 2026-05-15)

**Goal:** Spread the daily Resend budget (capped at 100/day, budget 90) across 10 batches/day instead of one. Drains the 4,092 backlog in ~46 days at 90/day (down from ~51 at 80/day), and respects Resend's 100/day account cap with a 10-email safety margin.

## Design

Replace the **daily** gate (`last_run_date_utc === today`) with a **time-interval** gate plus a daily upper-hour bound. Reuse the existing `last_run_at` TIMESTAMP — no counter column needed; interval naturally limits N runs/day; upper bound stops late-night UTC fires.

| Knob                                        | Default                     | mothers-day-2026 | Effect                       |
| ------------------------------------------- | --------------------------- | ---------------- | ---------------------------- |
| `fire_after_utc_hour` (existing)            | 9                           | 9                | first fire ≥ 09:00 UTC       |
| `fire_until_utc_hour` (NEW)                 | 23                          | 19               | no fires ≥ 19:00 UTC         |
| `min_minutes_between_runs` (NEW)            | 1440 (preserves old 1×/day) | 60               | next fire ≥ 60min after last |
| `per_day` (existing; means "per batch" now) | 80                          | **9**            | 9 emails per fire            |

Window 09:00–18:59 UTC × 60min spacing = **10 fires/day × 9 = 90/day** (Resend account cap 100/day; 10-email safety margin). Each batch schedules over 9×270s = 40.5 min, leaving ~20min gap before next batch. Backlog drains in ~46 days.

Defaults preserve existing 1×/day behavior for any other campaigns.

## Steps

- [ ] **1. Migration** — `migrations/109_cold_email_intraday.sql` + `migrations/pg/109_cold_email_intraday.sql`. Add `fire_until_utc_hour INT NOT NULL DEFAULT 23` and `min_minutes_between_runs INT NOT NULL DEFAULT 1440`.
- [ ] **2. Service** — `src/services/cold-email-service.js`: rename `shouldFireToday` → `shouldFireNow`, replace daily-key check with interval-elapsed check, add upper-hour bound. Replace `claimDailyFireSlot` with `claimRunSlot` (atomic UPDATE gated by `last_run_at`). Update `releaseDailyFireSlot` → `releaseRunSlot` to restore `last_run_at`.
- [ ] **3. Tests** — `src/services/cold-email-service.test.js`: new cases for interval gate + upper bound + multiple fires/day.
- [ ] **4. Admin backend** — `src/routes/admin.js` PATCH validators allow the 2 new fields with bounds.
- [ ] **5. Admin frontend** — `ColdEmailEditModal.tsx` adds the 2 fields; `ColdEmailTab.tsx` column updates.
- [ ] **6. Build admin SPA** — `cd admin && npm run build`. New bundle hash in `public/admin/`.
- [ ] **7. Commit** all of the above.
- [ ] **8. Deploy** — `railway up`.
- [ ] **9. Apply migration in prod** — `cat migrations/pg/109_cold_email_intraday.sql | railway connect postgres` + record in `schema_migrations`.
- [ ] **10. Set mothers-day-2026 values** — `UPDATE cold_email_campaigns SET fire_until_utc_hour=19, min_minutes_between_runs=60, per_day=9 WHERE id='mothers-day-2026';`.
- [ ] **11. Verify** — next 5-min poll fires; watch logs; re-poll 60min later for batch 2.

## Risks

- **Resend throughput**: 10 overlapping batches × 80 emails. Resend's own rate-limiter applies; pace inside each batch still respected at recipient timeline. If sender reputation suffers, drop to 5×/day via `min_minutes_between_runs=120`.
- **Admin "Trigger" button**: now gated by interval — clicking twice within 60min gets a skip with reason.
- **`last_run_date_utc` column**: becomes vestigial. Leaving it (safer than dropping) — admin UI may still surface it.

---

# Admin portal: forgot-password feature (COMPLETED — 2026-05-13)

## Goal

Admins who forget their password currently have no recovery path. Add a
secure "Forgot password?" flow mirroring the user-side pattern but
operating on `admin_users` / `admin_sessions` / a new `admin_password_reset_tokens` table.

## Investigation findings

- `admin_users` table exists (migration 023) with TEXT timestamps. UNIQUE email constraint.
- `admin_sessions` table — sessions revoked by DELETE (no `revoked_at` column).
- `admin-auth-service.changePassword` already wipes all admin_sessions on success. Reuse.
- `/admin/auth/change-password` exists for in-session changes (requires current pw).
- `/admin/*` SPA fallback at admin.js:3163 serves index.html → React Router handles paths.
- User-side reset (`/auth/forgot-password`, `/auth/reset-password`) is the reference impl: token hash storage, 200-always-to-prevent-enumeration, rate-limit-by-email, invalidate-all-tokens-on-success, revoke-all-sessions-on-success, security-alert-email.
- Email service: `emailService.sendPasswordResetEmail` exists for user-side; need an admin variant pointing to `/admin/reset-password` URL.
- No `clearLockout` in admin-auth-service — need to add or inline SQL.
- 8-char minimum password used in existing admin change-password route.

## Plan

### Server

- [ ] **1.** Migration 105 (parallel files for `migrations/` and `migrations/pg/`): `admin_password_reset_tokens` table — id, admin_id (FK + ON DELETE CASCADE), token_hash, expires_at, used_at, ip_address, created_at. Indexes on token_hash and (admin_id, used_at). Use TEXT timestamps to match admin_users convention.
- [ ] **2.** `src/services/admin-auth-service.js` additions:
  - `createPasswordResetToken(adminId, options)` — 32-byte URL-safe random, SHA256 hash storage, 30-min TTL
  - `verifyPasswordResetToken(rawToken)` — hash lookup, check used_at IS NULL + expires_at > now, return {adminId, tokenId}
  - `markPasswordResetTokenUsed(tokenId)`
  - `invalidateAllPasswordResetTokens(adminId)`
  - `findAdminByEmail(email)` / `findAdminById(id)` helpers
  - `clearLockout(adminId)` — zero failed_login_count, null locked_until
- [ ] **3.** `src/routes/admin.js` two new public endpoints:
  - `POST /admin/auth/forgot-password` — body {email}. Rate limit by email (3/hr) AND IP (10/hr). Always return 200 with generic message. If admin exists + email configured, create token + send email + log.
  - `POST /admin/auth/reset-password` — body {token, new_password}. Validate token, validate password ≥8 chars, changePassword (wipes sessions), mark token used, invalidate all other tokens, clearLockout, send security alert.
- [ ] **4.** `src/services/email-service.js`: `sendAdminPasswordResetEmail(email, token, expiresAt)` — clones the user template with admin subject + `/admin/reset-password?token=…` URL.

### Frontend

- [ ] **5.** `admin/src/pages/ForgotPassword.tsx` — email form, submit POST, generic success message.
- [ ] **6.** `admin/src/pages/ResetPassword.tsx` — reads `?token=` from URL, two-password form, validates match + length, submit POST, redirect to /login on success.
- [ ] **7.** `admin/src/pages/Login.tsx` — add "Forgot password?" link under password field.
- [ ] **8.** `admin/src/App.tsx` — register `/forgot-password` and `/reset-password` routes outside Layout (public).

### Adversarial review pass (BLOCKING before implement)

- [x] Email enumeration — always 200 ✓
- [x] Token reuse — used_at gate + invalidate-all-on-success ✓
- [x] Token expiry — expires_at gate ✓
- [x] Rate limit bypass — email + IP rate limits ✓
- [x] Session invalidation — changePassword already wipes admin_sessions ✓
- [x] Lockout state preservation — clearLockout after successful reset ✓
- [x] Email service down — silent 200 + server-side error log ✓
- [x] SPA routing — /admin/\* fallback handles deep links ✓
- [x] CSRF — token IS the auth credential, no extra protection needed ✓
- [x] Password complexity — 8+ chars (matches existing change-password) ✓
- [x] Migration parity — TEXT timestamps, both PG and SQLite files ✓
- [x] Cross-account isolation — separate endpoint, separate table, no overlap with user reset ✓
- [x] Concurrent reset requests — multiple tokens valid until first use ✓
- [x] Idempotency — POST not idempotent by design (token marked used after first use) ✓
- [x] Logging — never log raw token, sanitize email ✓
- [x] Default seeded admin — reset clears default-pw state, login works after ✓
- [x] HTTPS — production behind Cloudflare ✓

100% confidence: yes. No remaining unmitigated concerns.

### Post-implementation adversarial review

- [ ] Re-run the checklist after code is written, verify each mitigation actually exists in the diff
- [ ] Run tests
- [ ] Build admin frontend to confirm no compile errors

---

# Fix voice enrollment sung_calibration_unavailable false-fail (RESOLVED — 2026-05-12)

## Symptom

User completes 6/6 enrollment phrases → server returns 422 `E107_SUNG_AUDIO_REQUIRED` with reason `sung_calibration_unavailable`. Dialog: "spoken parts were clear, but the sung parts were too short or too speech-like".

## Root cause (5-layer trace)

1. **L1**: iOS shows dialog from server error.
2. **L2**: `src/routes/enrollment.js:1524-1551` hard-fails when `sunoPersonaAudio === null`.
3. **L3**: `buildSunoPersonaCalibration()` at `enrollment.js:144-208` returns null because the filter requires `entry.quality.metrics.is_singing === true`.
4. **L4**: `detectSinging()` at `audio-quality.js:98-175` is too strict (`sustainRatio > 0.15 && coeffOfVariation < 0.5`).
5. **L5 (origin)**: `is_singing` is computed on PREPROCESSED audio — VAD-trimmed at -40dB and noise-suppressed with spoken-target params (preprocessBatch called without `isSung` flag at `services/enrollment.js:198`). Sung notes lose their sustained character before the detector evaluates them. Duration is already contract-enforced at upload (commit 9edd8ae), so `is_singing` is doing redundant + unreliable defensive work.

## Fix

Replace `is_singing === true` gate with `vad_ratio > 0.2` gate in `buildSunoPersonaCalibration` filter. Trust the prompt-type + duration contract for sung selection; require only that the chunk had substantive voiced content (rejects silence).

## Plan

- [ ] **1.** Edit `src/routes/enrollment.js:150-156` — change filter predicate from `is_singing === true` to `(vad_ratio ?? 1) > 0.2`.
- [ ] **2.** Add regression test in `test/voice-enrollment.test.js` — 2 sung chunks with `is_singing: false` + `vad_ratio: 0.6` + 8s duration each → POST /complete returns 200.
- [ ] **3.** Add negative test — 2 sung chunks with `vad_ratio: 0.05` (near-silent) → still hard-fails with E107 (preserves defensive rejection).
- [ ] **4.** Run `npm test -- voice-enrollment` to confirm no regressions.
- [ ] **5.** Commit.

## Risks / contracts preserved

- Hard-fail E107 path stays for genuine silence/missing sung audio.
- `suno-persona-failure-classifier.js` classification of `sung_calibration_unavailable` → `recapture` stays correct.
- iOS recapture state machine untouched.
- `is_singing` detector itself untouched (still used for scoring at `audio-quality.js:464-465`).

---

# Install AppsFlyer iOS SDK in PorizoApp (COMPLETED — 2026-05-11)

## Goal

Add AppsFlyer attribution to Porizo iOS so paid campaign performance (Apple Search Ads, Meta Ads, TikTok Ads) lands in one unified dashboard. Existing attribution (AdServices for Apple Search Ads, FBSDK for Meta) keeps running — AppsFlyer is the cross-network aggregator on top.

## User decisions captured

- **Credentials**: User will paste Dev Key + Apple App ID
- **Events to track in v1**: sign-up, song_created, song_shared, purchase
- **Wiring**: Single pipeline — extend `AnalyticsService.shared` to dual-pipe to AppsFlyer (matches existing Firebase + Amplitude pattern)

## Plan

- [ ] **1. Add AppsFlyer SPM dependency.** Xcode UI: File → Add Package Dependencies → `https://github.com/AppsFlyerSDK/AppsFlyerFramework` (latest 6.x). Add to `PorizoApp` target. Add product `AppsFlyerLib`.
- [ ] **2. Add Info.plist keys.** `AppsFlyerDevKey = $(APPSFLYER_DEV_KEY)`, `AppsFlyerAppleAppID = $(APPSFLYER_APPLE_APP_ID)` — matches the `FacebookClientToken = $(FacebookClientToken)` pattern already used. Build settings get the real values.
- [ ] **3. Wire AppsFlyer in `AppDelegate`.** Initialize in `application(_:didFinishLaunchingWithOptions:)` alongside FBSDK + Apple AdServices. Set `waitForATTUserAuthorization(60)` so AppsFlyer waits for the ATT decision before firing the install postback. Generalize the ATT gate (currently FB-only) to also trigger for AppsFlyer.
- [ ] **4. Call `start()` on every foreground.** In the `scenePhase == .active` task, alongside `AppEvents.shared.activateApp()`.
- [ ] **5. Extend `AnalyticsService`.** Add AppsFlyer as a 4th sink alongside Firebase/Amplitude/backend. Add event-name mapping: `authCompleted → AFEventCompleteRegistration`, `createCompleted(type=song) → song_created`, `shareCompleted → song_shared`. Add new `logPurchase(amount:currency:productId:)` method that emits `AFEventPurchase` with `af_revenue` + `af_currency`.
- [ ] **6. Wire purchase event.** Find the StoreKit 2 transaction-success callback and call `AnalyticsService.shared.logPurchase(...)`.
- [ ] **7. Set `customerUserID` on auth.** `AppsFlyerLib.shared().customerUserID = userId` after sign-in so AppsFlyer events join to the same user across reinstalls. Matches the existing `AnalyticsService.identify(userId:)` call site.
- [ ] **8. Build + verify.** `xcodebuild ... build` to confirm SPM resolves. Install on test device registered in AppsFlyer dashboard. Verify install event arrives + ATT prompt appears + custom events fire.

## Risks / contracts to maintain

- **ATT prompt**: must request authorization BEFORE `start()` completes, otherwise the install postback ships with IDFA=0 and Apple Ads attribution is broken. Use `waitForATTUserAuthorization(60)`.
- **Privacy manifest**: AppsFlyer SDK ships its own `PrivacyInfo.xcprivacy`. Our app-level privacy manifest already declares audio collection — no new categories needed unless we send user properties (PII).
- **No hardcoded dev key in source**: matches existing FB pattern. Dev key in Xcode build settings, never in repo.

---

# Share-audio playback regression — fix + harden (RESOLVED — 2026-05-10)

## Context

Share player at `/play/<token>` shows "Unable to play this audio." The proxy at `/share/:id/audio` returns `200 OK` (or `206`) with **content-length: 0** while upstream R2 reports the correct file size (HEAD shows ~2.2 MB for Chioma's song). System-wide regression — every share token tested (May 5 → May 10) returns zero bytes.

**Root cause:** `Readable.fromWeb(r2Response.body)` in `serveTrackAudio` (`src/server.js:~4355` pre-fix) silently emits 0 bytes under Node 20 + Fastify 4.29 + undici. Headers set correctly, but Fastify recomputes `Content-Length` from the (empty) actual byte count.

## Plan

- [x] **1. Apply fix.** Replace `Readable.fromWeb` with `Buffer.from(await arrayBuffer())`. Add 30s fetch timeout, BYTE_MISMATCH warn log, EMPTY_BODY → 502. (`src/server.js:4312`)
- [ ] **2. Commit + deploy.** Single commit, push to `version3`, watch Railway auto-deploy.
- [ ] **3. Verify in production.** `curl --range 0-999` against `/share/Rrm8PRM3tlwV/audio` → non-zero body. Browser playback confirmed.
- [ ] **4. Contract test.** Asserts `/share/:id/audio` returns 200/206, audio content-type, body bytes > 0. The test that would have caught today's bug.
- [ ] **5. Synthetic probe.** Standalone script hits a canary share URL on prod, alerts on body=0. Document daily run.
- [ ] **6. Adversarial review.** Pressure-test buffer approach: large files, Range edge cases, concurrency memory, R2 drops, presigned-URL expiry, missing key. Document failure modes.
- [ ] **7. Capture learning.** Memory entry on byte-flow contract pattern.

## Verify

```bash
curl -s --range 0-999 https://api.porizo.co/share/Rrm8PRM3tlwV/audio | wc -c   # > 0
```

---

# ASO scaling — 72h experiment + Phase 1 launch (DONE — 2026-05-12)

## Done

- [x] **Step A**: 5 exact-match negatives added to Discovery Keywords ad group:
      `[gift song]`, `[personalized gift]`, `[birthday gift ideas]`,
      `[birthday gift]`, `[music gift]`.
- [x] **Step B**: `birthday gift ideas` bid bumped $1.80 → $3.00 (manual UI, 2026-05-09).
- [x] **72h checkpoint (2026-05-12)**: `node scripts/aso/review.mjs --days 30` ran. Verdict: MATCH_TYPE_GRADUATION on `birthday gift ideas` (50% install rate, $3.57 CPI) and `birthday gift` (33%, $4.17 CPI). Both graduated to EXACT @ $3.00 in Category US.
- [x] **Phase 1 Painkiller Probe launched** in ASA UI (`Probe US Painkiller` campaign, ID `2143835551`, $20/day, 7 ad groups, 51 broad-match keywords @ $0.75). Audit record: `marketing/appstore/aso/launches/2026-05-12-phase1-painkiller-probe-LIVE.md`.
- [x] **New keywords-field staged** for ASC 1.5.12: `music gift,personalized gift,gift song,birthday gift ideas,mother's day song,birthday gift,song gift` (100/100 chars). File: `marketing/appstore/metadata/version/1.5.12/en-US.json`. Awaiting ASC submission.
- [x] **TTR_PROBLEM negatives**: `[anniversary gift]` (325 imp / 0 taps), `[personalized gifts]` plural (11 taps / 0 installs), `[meaningful gift]` (5 taps / 0 installs) all added as exact-match negatives in Discovery.

## Queued

- [ ] **Day-7 checkpoint (2026-05-19)**: `node scripts/aso/review.mjs --days 7 --note "Phase 1 day-7"`. Evaluate per-theme demand; graduate winners to Phase 2 EXACT, drop dead themes.
- [ ] **Painkiller bid escalation (blocked on ASA write permission)**:
      `node scripts/aso/apply-painkiller-actions.mjs --execute` should raise
      the 51 active Probe keywords to $1.50 max CPT, add exact negatives for
      `[anniversary gift]`, `[personalized gifts]`, `[meaningful gift]`, and
      raise one Category exact winner to $3.00. Dry-run passed on 2026-05-15;
      execute failed with Apple Ads `403 FORBIDDEN` because the configured API
      credentials lack campaign-management write permission.
- [ ] **Audit screenshots for anniversary intent**: `anniversary gift` TTR_PROBLEM root cause is creative mismatch. Schedule a Custom Product Page variant for anniversary or update screenshot hero text before re-enabling that keyword.
- [ ] **Ship ASC 1.5.12 to App Store Review** with the new painkiller keywords-field. The metadata file is staged; user runs `asc review submit` deliberately.
      and check `birthday gift ideas`'s new stats. Watch for:
  - ✅ Impressions roughly double (was 36/30d; expect ~6-12 in next 72h
    after bid bump capturing more of available auctions)
  - ✅ Install rate stays 30%+ on a larger sample → real signal
  - ⚠️ If install rate craters or impressions don't grow, revert bid
- [ ] **Music gift TTR fix (separate skill — `porizo:screenshot-export`)**:
      Audit App Store screenshots/icon/subtitle for "music gift" search intent.
      Currently 88 imp / 0 taps over 30 days = creative mismatch. Either add
      a hero card promising "music gift" or change subtitle to land that
      promise within the first card. The Discovery negative just stops the
      bleed; the listing still doesn't convert organic "music gift" searchers.

- [ ] **Phase 1 painkiller probe launch (2026-05-12, BLOCKED on 72h checkpoint above)**:
      Upload 51 broad-match keywords across 7 themed ad groups to a new ASA
      campaign `Probe US Painkiller`, $0.75 max CPT, $30/day budget, 7-day run.
      Artifacts ready:
  - CSV: `marketing/appstore/aso/launches/2026-05-12-phase1-painkiller-probe.csv`
  - Playbook: `marketing/appstore/aso/launches/2026-05-12-phase1-painkiller-probe.md`
  - Themes: Pet Songs (8), Baby & Pregnancy (8), Apology (6), Long-Distance (5),
    Stepfamily (11), Milestone Birthdays (8), Voice-Clone Discovery (5).
  - Pre-flight: run `node scripts/aso/review.mjs --days 30` first to capture
    72h checkpoint verdict; only proceed if `birthday gift ideas` impression
    growth confirms the bid bump worked.
  - Day-7 evaluation (~2026-05-19): re-run review, recommender will flag
    MATCH_TYPE_GRADUATION winners for Phase 2 EXACT promotion.

- [ ] **Phase 2 graduation (~2026-05-19, BLOCKED on Phase 1 day-7 data)**:
      Promote Phase 1 winners (>40% TTR or >10% CR) to EXACT match at
      $2.50–$3.50 in Category campaign. Add same terms as exact-match
      negatives in Discovery to prevent split attribution (CONVENTIONS.md
      cross-campaign rule). Push remaining ~165 painkillers to Phase 3.

- [ ] **Phase 3 floor catch (~2026-05-26, BLOCKED on Phase 2)**: Add remaining
      ~165 painkillers at $0.30 BROAD in single "Harvest" ad group. Goal:
      long-tail demand discovery at minimum spend.

## Learnings (now codified in the recommender)

- **The `gift song` misdiagnosis** drove a major rewrite of the recommender.
  Original logic said "rate ≥30%, low imp → BID_UP". But `gift song` was
  already exact-match at $1.80 max bid winning at $0.05 (3% of max) —
  bidding up captures nothing because we're already winning every auction.
  Now: the recommender checks `avg_cpt / max_cpt_bid` ratio. ≥70% =
  `BID_UP`, <25% = `VOLUME_CAPPED`. Disambiguation is automatic.
- **Cross-campaign cannibalization** is now baked into every promotion
  recipe. Any keyword going to Category exact-match auto-comes with a
  recipe to add as Discovery exact-match negative. CONVENTIONS.md §7b
  has the universal rule.
- **8 distinct labels now** (was 4): BID_UP, BID_UP_OR_VOLUME_CAPPED,
  MATCH_TYPE_GRADUATION, PROTECT_AND_SCALE, VOLUME_CAPPED, TTR_PROBLEM,
  DEMOTE, RETIRE. Each maps "what to scale / hold / retire" to a concrete
  recipe.
- **Apple's bid-edit UI uses opaque shadow DOM** that resists JS-driven
  typing. When we build `scripts/aso/promote.mjs` (Phase 2 of the user-
  approved ASA write API), bid changes go via the ASA API endpoint
  `POST /api/v5/campaigns/{id}/adgroups/{aid}/targetingkeywords/{kid}`,
  not browser-harness UI clicks. Same for adding keywords / negatives.
- **`pull-asa.mjs` now captures `match_type` and `max_cpt`** per keyword
  from `metadata.matchType` / `metadata.bidAmount` in the ASA reports
  response. CSV format gained two columns. The recommender uses both
  to drive the volume-vs-competition disambiguation and the broad→exact
  graduation suggestion.

---

# ASO Keywords System — single source of truth + review loop (ACTIVE — 2026-05-09)

## Goal

Consolidate all ASO keyword work into one canonical `keywords.json`, seed it
with ~200 candidates, and stand up a review loop that ranks effectiveness from
(1) Apple Search Ads exports and (2) App Store Connect organic search-term
data, until the top 10 emerge for the live App Store `keywords` field.

## Plan

- [ ] Extract every keyword from `marketing/appstore/aso/aso-strategy.md` (Tiers 1-4)
- [ ] Design `keywords.json` schema (term, tier, status, score, asa snapshot, organic snapshot, history)
- [ ] Generate ~200 keywords (50 strategy + ~150 occasion × relationship × modifier permutations)
- [ ] Write `marketing/appstore/aso/keywords.json`
- [ ] Write `marketing/appstore/aso/snapshots/.gitkeep`
- [ ] Write `scripts/aso/rerank.mjs` (ASA CSV + ASC CSV → score → snapshot → top-10 string)
- [ ] Write `marketing/appstore/aso/review-protocol.md`
- [ ] Update `marketing/appstore/aso/aso-strategy.md` with canonical-source banner
- [ ] Verify `node scripts/aso/rerank.mjs --dry-run` exits 0

## Done definition

- `keywords.json` exists with ~200 entries and complete schema
- `rerank.mjs --dry-run` exits 0 on a fresh repo
- Real ASA CSV produces sorted JSON + dated snapshot + top-10 string
- `review-protocol.md` documents cadence and exact CLI commands
- `aso-strategy.md` references `keywords.json` as canonical

---

# Retire `billing_holds` table (ACTIVE — 2026-05-03)

**Trigger:** Code review during the credits_balance retirement (2026-05-02) found `billing_holds` is dead in production: 0 rows ever, no production INSERT path. The cancel-render and hold-expiry "refund" code is unreachable. Doing it now while context is loaded.

## Phase 1 — Server code

- [ ] `src/routes/tracks.js`: remove `billing_hold_id` from track_versions INSERT (line 441) + corresponding null param; drop the field from 4 API response objects (lines 699, 718, 778, 806); delete the cancel-render hold lookup block (lines 907-916); drop `billing_hold_refunded` from cancel response + audit metadata (lines 936, 945)
- [ ] `src/routes/admin.js:2920-2924`: delete billing_holds reassignment in user-merge transfer
- [ ] `src/services/auth-service.js:808`: delete `DELETE FROM billing_holds` in account deletion
- [ ] `src/workflows/runner.js:1760-1763`: delete `getHold` / `updateHold` prepared statements
- [ ] `src/workflows/runner.js:2080-2101`: delete `releaseHoldIfNeeded` function
- [ ] `src/workflows/runner.js:3738, 3800, 3949`: delete the 3 callers of `releaseHoldIfNeeded`
- [ ] `src/workflows/runner.js:4002-4004`: delete the capture-on-full-ready block
- [ ] `src/server.js:4200-4227`: delete the entire hold-expiry cleanup loop

## Phase 2 — Tests

- [ ] `test/ready-step-s3-ordering.test.js`: remove `withBillingHold` from `seedReadyFixture`, drop billing_hold_id from track_versions INSERT (line 65), delete the "full upload failure does not capture billing hold" test (redundant with preview test once hold isn't tracked)
- [ ] `test/render-full-billing-atomicity.test.js`: drop the 3 `billing_hold_id` assertions (lines 258, 261, 268)
- [ ] `test/database/postgres-migration.test.js:85`: remove `'billing_holds'` from expected-tables list

## Phase 3 — Migration

- [ ] Write `migrations/pg/095_drop_billing_holds.sql` — `ALTER TABLE track_versions DROP COLUMN IF EXISTS billing_hold_id; DROP TABLE IF EXISTS billing_holds CASCADE;`
- [ ] Apply to production via `cat ... | railway connect postgres`
- [ ] Record in `schema_migrations`

## Phase 4 — iOS (deliberately skipped)

- iOS still has `let billingHoldId: String?` in `TrackModels.swift:401`. Swift `Codable` optionals tolerate missing JSON keys — when the API stops returning the field, decoding silently produces `nil`. No breakage. Leave it; iOS will pick it up at next app version cleanup.

## Phase 5 — Verify

- [ ] `npm test` passes
- [ ] Production schema: `\d entitlements`, `\d track_versions`, `SELECT FROM information_schema.tables WHERE table_name='billing_holds'`
- [ ] Deploy via `railway up`
- [ ] Live `/health` returns 200 from new container

---

# Retire `credits_balance` / `credits_used_total` (SHIPPED — 2026-05-02)

**Trigger:** Forensic of user `dr9rwwd6gc@privaterelay…` showed `credits_balance = -5` while `songs_remaining = 5`. Root cause: legacy ledger drift — `subscription-manager.js` `ON CONFLICT DO UPDATE` for entitlements upsert never refills `credits_balance` on subscription grant for existing users, but `spendSong` keeps decrementing it. 49/49 free users + 2/2 paying users have negative or stale values. Field is **internal-only** (admin dashboard reads it; iOS app and public API do not).

**Goal:** Remove the orphan ledger entirely. `songs_remaining` is canonical (it's what gates renders). Drop columns, remove every read/write site.

## Phase 1 — Code removal (server)

- [ ] `subscription-manager.js:885` — remove `credits_balance = credits_balance - 1` from `spendSong` UPDATE
- [ ] `subscription-manager.js:868, 887` — remove `credits_used_total = credits_used_total + 1` from both spend paths (trial + regular)
- [ ] `subscription-manager.js:438, 464` — drop `credits_balance, credits_used_total` from `updateEntitlements` upsert columns/values + remove "backward compatibility" comment
- [ ] `subscription-manager.js:542` — drop from `activateTrial` upsert
- [ ] `subscription-manager.js:650` — drop `credits_balance = 0` from `handleExpiration` SET
- [ ] `subscription-manager.js:761, 784` — drop `credits_balance = ?` from `handleRevocation` SET (both branches) + matching params
- [ ] `subscription-manager.js:1129–1135` — drop from `adminGrantSongs` upsert
- [ ] `subscription-manager.js:1199` — drop from `adminComplimentaryUpgrade` UPDATE
- [ ] `subscription-manager.js:1542–1546` — drop from `createFreeEntitlements` INSERT
- [ ] `server.js:4210` — delete refund UPDATE (orphan refund into dead column)
- [ ] `workflows/runner.js:1764–1766` — delete `refundCredits` prepared statement + any callers
- [ ] `routes/tracks.js:916` — delete refund UPDATE (cancel-render path)
- [ ] `services/admin-service.js:146, 156` — drop `credits_used` from list query SELECT + JSDoc
- [ ] `services/admin-service.js:406–449` — strip `credits_balance` branch from `updateUserEntitlements` (validation, SET clause, INSERT, audit fields, JSDoc)

## Phase 2 — Tests

- [ ] `test/dlq-auto-reprocess.test.js:30` — drop `credits_balance` from setup INSERT
- [ ] `test/security-units-4-11-12.test.js:157, 210` — drop from setup
- [ ] `test/subscription-manager.test.js:313` — drop from setup
- [ ] `test/security-units-6-7-8.test.js:57` — drop from setup
- [ ] `test/dlq-retry-endpoint.test.js:48` — drop from setup
- [ ] `test/critical-fixes.test.js:90, 243, 327, 388, 480, 575` — drop from 6 setup INSERTs
- [ ] `test/share-embed.test.js:203` — drop from setup (also `credits_used_total`)

## Phase 3 — Migration

- [ ] Write `migrations/pg/094_drop_legacy_credits_columns.sql` — `ALTER TABLE entitlements DROP COLUMN credits_balance, DROP COLUMN credits_used_total;`
- [ ] Apply to production: `cat migrations/pg/094_*.sql | railway connect postgres`
- [ ] Record in `schema_migrations`
- [ ] Verify post-drop: `\d entitlements` shows columns gone; `SELECT COUNT(*) FROM entitlements` unchanged

## Phase 4 — Admin UI

- [ ] `admin/src/pages/Users.tsx:521` — remove `credits_balance: number` from interface
- [ ] `admin/src/pages/Users.tsx:414` — remove `credits_used` cell from list table
- [ ] `admin/src/pages/Users.tsx:590, 677` — remove from `entitlementFields` state + initialiser
- [ ] `admin/src/pages/Users.tsx:850` — remove "Credits Balance" stat card
- [ ] `admin/src/pages/Users.tsx:913–914` — remove input control (and any column-header label)

## Phase 5 — Verify

- [ ] `npm test` — green (or only pre-existing failures)
- [ ] `npm run build` (admin) — green
- [ ] `railway connect postgres` → `\d entitlements` — columns gone
- [ ] Admin dashboard loads a paid user without 500
- [ ] Render a song end-to-end on dev → confirm `songs_remaining` decrements and no SQL error

---

# Bootstrap research: download + registration funnel (ACTIVE — 2026-04-28)

**Trigger:** Apple Ads is now spec-compliant (Brand/Mother's Day/Gift Category/Discovery, $15/day total). After 7 days: 1,061 Brand impressions → 11 taps → 1 install; Gift Category 278 imp → 4 taps → 0 installs. Tap-rate is OK; install conversion and registration are the actual bottleneck.

**Goal:** Identify highest-leverage moves for download + registration. Not more ad spend until creative/funnel is fixed.

- [ ] R1 — External: Bootstrap playbooks for low-budget consumer/gift apps (case studies, growth hacks)
- [ ] R2 — External: Mobile registration funnel optimization (onboarding, sign-up reduction tactics)
- [ ] R3 — Internal: Audit current Porizo funnel (App Store page, onboarding code, registration, analytics gaps)
- [ ] Synthesize 3-5 prioritized bets with rough cost/effort/expected-impact

---

# Deferred /ce:review fixes (ACTIVE — 2026-04-25, post-707b3b2)

Goal: address the four findings deferred from `707b3b2` in dependency order — tests
first to lock behavior, then mechanical refactor, then structural refactor, then
feature work.

## Phase 1 — Test coverage (lock current behavior before refactor)

- [ ] Repair LLM exception path returns to outer attempt loop without flipping `targetedRepairTried` (test-1)
- [ ] Repair succeeds on quality but fails fidelity → outer gate still throws `LYRICS_FIDELITY_LOW` (test-2)
- [ ] repair_attempted / repair_passed / repair_failed metric strings appear in stderr (test-5)
- [ ] Preflight on story with 0 required details emits warning, not blocker (test-4)
- [ ] Preflight throw leaves story unconfirmed (test-3)
- [ ] Route layer accepts `target_content_type='song'`, surfaces 422 STORY_NEEDS_INPUT (test-6)

Commit: `Lock down preflight + repair behavior with new tests`

## Phase 2 — JSON extraction consolidation (maint-2)

- [ ] Add `extractFirstJsonObject(text)` to `src/utils/common.js`
- [ ] Replace inline regex in `parseLyricsJson` with the shared util
- [ ] Replace 7 other inline callers
- [ ] Add unit tests for the new util

Commit: `Consolidate LLM JSON extraction into shared util`

## Phase 3 — Songwriter god-module split (maint-1)

- [ ] Extract `src/writer/song-readiness.js`
- [ ] Extract `src/writer/lyric-repair.js`
- [ ] Extract `src/writer/song-contract.js`
- [ ] songwriter.js re-exports same surface
- [ ] Full test suite + iOS build sanity check

Commit: `Split songwriter.js into song-readiness, lyric-repair, song-contract modules`

## Phase 4 — Gate downstream song paths (adv-002)

- [ ] Persist `song_contract_status` on story row at confirm
- [ ] Invalidate on story mutation
- [ ] Re-check at `/story/:id/lyrics`, `/render_preview`, admin re-render
- [ ] Tests for each path

Commit: `Extend song readiness gate to render_preview, reroll, and admin re-render`

---

# Ship 1.5.7 with fixed share slide (ACTIVE — 2026-04-22)

**Context:** 1.5.6 is live on the App Store with the broken share slide. 1.5.7's version entry in ASC already has the 5 fixed iPhone screenshots staged (uploaded earlier today via `asc screenshots upload`). Need a new build (100) since Apple requires a fresh build for a new version.

- [ ] 1. Bump project.pbxproj: `MARKETING_VERSION 1.5.6 → 1.5.7` and `CURRENT_PROJECT_VERSION 99 → 100`
- [ ] 2. `xcodebuild archive` — archive path `PorizoApp/build/PorizoApp-v100-157.xcarchive`
- [ ] 3. `xcodebuild -exportArchive` with `destination=upload` → pushes IPA to App Store Connect
- [ ] 4. Poll `asc status --app 6758205028` until build 100 is VALID (5-20 min)
- [ ] 5. `asc versions attach-build --version-id 16675a98-… --build <build-100-id>`
- [ ] 6. `asc versions update --version-id … --release-type AFTER_APPROVAL`
- [ ] 7. `asc localizations update --version 16675a98-… --locale en-US --whats-new "App optimisation"` (or user's preferred copy)
- [ ] 8. `asc validate --app 6758205028 --version-id 16675a98-…` — expect 0 errors
- [ ] 9. `asc review submit --app 6758205028 --version-id 16675a98-… --build <build-100-id> --confirm`
- [ ] 10. Confirm state = WAITING_FOR_REVIEW

**Code state:** Zero app code changes since 1.5.6. Build 100 is just 99 recompiled with bumped version numbers — everything that worked on 1.5.6 will work on 1.5.7.

---

# Rebuild Slide 5 (Share) — fix "Make This Song" CTA leak ✅ DONE — 2026-04-22

**Final direction:** Recipient-POV Messages thread (direction B). Phone shows a synthesized iMessage conversation, sender POV — the user (Sarah's contact at top) just sent a coral-gradient rich link card "For Sarah / Happy Birthday 🎂 / A song made just for you / porizo.app" with blue bubble "I made you a birthday song 🎂" above it and "Delivered" below. Centered vertically for balance.

**Iteration history (3 Codex review passes):**

- V1 (09-reveal.jpg + FloatingPill): rejected — duplicate of slide 4.
- V2 (iMessage, receiver POV, "Mom" header + "For Sarah" card): rejected — recipient mismatch.
- V3 (iMessage, sender POV, "Sarah" everywhere, bottom-anchored): rejected — bottom-heavy composition.
- V4 (iMessage, sender POV, centered cluster, "I made you a birthday song"): **accepted by Codex** as "usable now, not off mark, good candidate for screenshot 5."

- [x] Build `MessagesRecipientScreen` (synthesized iMessage thread)
- [x] Sender POV + "Sarah" consistent everywhere
- [x] "I made you a birthday song 🎂" bubble
- [x] Card zoomed (820px, "Sarah" at 168pt)
- [x] "Delivered" read-receipt under card
- [x] Centered vertical composition
- [x] Copy into canonical `current/{6.1,6.3,6.5,6.9}/porizo-share.png`
- [ ] User ship decision: upload now via `asc screenshots upload` (replaces 1.5.6 on live store? or hold for next version)

---

# Submit 1.5.6 (build 99) for App Store Review ✅ DONE — 2026-04-21

Submitted via `asc` CLI. All steps completed; version is now WAITING_FOR_REVIEW with automatic release after approval.

- [x] 1. Confirm build 99 uploaded + VALID (via `asc status`)
- [x] 2. Set "What's New" = "App optimisation" (`asc localizations update --whats-new`)
- [x] 3. Attach build 99 to version 1.5.6 (`asc versions attach-build`)
- [x] 4. Run `asc validate` → 0 errors, 1 non-blocking EULA warning (same as prior approved 1.5.x versions)
- [x] 5. Set release type AFTER_APPROVAL (`asc versions update --release-type`)
- [x] 6. Dry-run confirmed, then `asc review submit --confirm`
- [x] 7. Confirmed state = WAITING_FOR_REVIEW

**Submission ID:** `4bb9578e-6666-4958-9a21-4ab85018a036`
**Next:** monitor via `asc status --app 6758205028` until IN_REVIEW → PENDING_DEVELOPER_RELEASE / APPROVED.

---

# 1.5.4 Post-Approval Fixes (ACTIVE — 2026-04-17)

**Status:** Planning — awaiting user approval before implementation.
**Context:** 1.5.4 is approved on App Store, but has two production bugs. Fix and submit as 1.5.4 build 97 (or 1.5.5 if policy change warrants bump).

## Bug 1 — "Complete your profile" re-appears on every cold launch

### Root cause (verified in code)

Three stacked issues:

1. **Server policy is too strict.** `src/services/identity-service.js:computeProfileCompleteness` (lines 394-422) requires BOTH a verified non-relay email AND a verified phone. Apple-Sign-In users with relay emails, or users who only verified one channel, are stuck at `needs_profile_completion: true` forever.
2. **Skip endpoint is dead code.** `/auth/profile/skip-completion` records a timestamp that `buildUserProfileResponse` never reads.
3. **Client dismissal is ephemeral.** `hasSkippedProfileCompletionInSession` in `RootView.swift:51` is `@State` — resets on every cold launch. Even dismissing the sheet doesn't help for tomorrow's launch.

### User's actual state (from screenshot)

- Display name: ✓
- Email `abcobimma@gmail.com`: unverified (shows "Resend verification email")
- Phone `+61406371221`: verified (green check)

Under current policy, `missing: ["verified_email"]` is technically correct — but forcing a verified-phone user to see a blocking sheet on every launch is bad UX.

### Fix plan

**Server — relax policy to "collection, not verification":**
_(User clarification: email/phone is for marketing, not identity verification. Having any non-relay email OR phone on file is enough — no verification required.)_

- [x] `src/services/identity-service.js:computeProfileCompleteness` — changed from "verified email AND phone" to "has non-relay email OR phone on file (verified or not)". Policy v1 doc comment updated.
- [x] Updated S5b tests: (a) phone on file, (b) unverified real email on file, (c) relay-only still incomplete.
- [x] Updated S8 skip test to use relay email so the scenario is still "genuinely incomplete".

**Client — persist dismissal for 7 days:**

- [ ] `RootView.swift:51` — replace `@State var hasSkippedProfileCompletionInSession: Bool` with `@AppStorage("profileCompletionSkippedAtEpoch") var profileCompletionSkippedAtEpoch: Double = 0`.
- [ ] `syncProfileCompletionContext()` (line 697) — guard on `Date().timeIntervalSince1970 - skippedAt < 7*86400`.
- [ ] Sheet dismiss handler (line 285) — write current epoch to storage.
- [ ] `onChange(authManager.isAuthenticated)` (line 306) — reset to 0 on sign-in so a freshly signed-in user isn't accidentally suppressed.
- [ ] When user successfully completes profile, clear the skip (so future policy-version bumps can re-prompt).

## Bug 2 — Update prompt appears on latest (1.5.4)

### Root cause (verified in code)

- `AppUpdatePolicy.compare` is correct numeric semver; `1.5.4 == 1.5.4` yields `.orderedSame`, so the client wouldn't prompt if both sides are truly 1.5.4.
- `normalizedVersion` trims whitespace correctly.
- **Therefore the server is returning a version > 1.5.4 for `recommended_version` or `minimum_supported_version`.** Most likely: `security_config.ios_recommended_version` or `ios_min_supported_version` was pre-staged above 1.5.4, OR `ios_auto_recommended_version=true` + App Store Connect returning a pre-release version.
- `dismissedRecommendedUpdateVersion` at `RootView.swift:33` is `@State` — even tapping "Later" doesn't survive a cold launch.

### Fix plan

**Verify DB state (needs user action — I don't have Railway access for the porizo project):**

- [ ] User runs: `echo "SELECT ios_min_supported_version, ios_recommended_version, ios_auto_recommended_version, ios_last_app_store_version, ios_update_message FROM security_config WHERE id='default';" | railway connect postgres`
- [ ] Share output so we can confirm and fix any > 1.5.4 value.

**Server — safety clamp to prevent future admin-pre-staging bug:**

- [ ] `src/services/admin-service.js:resolveIOSAppUpdatePolicy` (1147-1178) — if `ios_auto_recommended_version=true` and the App Store Connect sync returns a valid version, ignore the manually-stored `ios_recommended_version` entirely (use only the synced version). Prevents stale overrides.

**Client — persist dismissal across launches:**

- [ ] `RootView.swift:33` — replace `@State var dismissedRecommendedUpdateVersion: String?` with `@AppStorage("dismissedRecommendedUpdateVersion") var dismissedRecommendedUpdateVersion: String = ""`.
- [ ] Suppression check at `RootView.swift:941-946` — treat empty-string as "no dismissal".
- [ ] When local version reaches or exceeds the stored dismissed version, clear AppStorage.

**Client — defensive check (zero-effort safety):**

- [ ] `AppUpdatePolicy.evaluate` (line 29) — if `compare(currentVersion, recommended)` returns `.orderedDescending` OR `.orderedSame`, never prompt. Current code already does this, but add an explicit log line in DEBUG so we can diagnose from TestFlight console.

## Verification plan (before claiming done)

- [ ] **Bug 1 unit test:** `npm test` covering all three contact-verification permutations.
- [ ] **Bug 1 live check:** After deploy, query Ambrose's `/auth/profile` → `needs_profile_completion: false`.
- [ ] **Bug 1 device check:** Cold launch PorizoApp twice → no sheet either time.
- [ ] **Bug 2 DB check:** `security_config` row shows consistent values, no stale overrides.
- [ ] **Bug 2 device check:** Cold launch PorizoApp → no update prompt.
- [ ] **Regression sweep:** Tap "Later" on a simulated update prompt → cold relaunch → still suppressed.
- [ ] **Build:** Bump `CFBundleVersion` (build number) 96 → 97. Keep `CFBundleShortVersionString` at 1.5.4 (fixes only, no new features).
- [ ] **TestFlight upload:** Per verified pattern in memory (`xcodebuild archive -allowProvisioningUpdates` → `-exportArchive`).

## Open questions

1. **1.5.4 build 97 vs 1.5.5?** — These are bug fixes to an already-approved build, so build 97 is appropriate.
2. **Policy change OK?** — "At least one verified contact" is a real product decision. If you prefer keeping both required, we keep the strict server policy and lean on client-side 7-day skip instead.
3. **Can you share the `security_config` row?** — Needed to confirm which field is wrong.

---

# Pre-submission Comprehensive Review + Simplification (2026-04-15)

**Goal:** Before submitting next TestFlight build, run `/ce:review` and `/simplify` on every user flow. Fix only confirmed issues; apply only confirmed simplifications. Maintain ship-readiness.

## User Flow Inventory (5 groups, all must be covered)

1. **Auth + Onboarding entry path** — `Onboarding/`, `AuthView`, `AuthManager`, `AccountExistsView`, `PhoneAuthView`, `RootView`
2. **Voice Enrollment** — `VoiceEnrollmentView`, `AudioRecorder`, `APIClient+Enrollment`
3. **Song Creation** — `Flows/WarmCanvasFlowView`, `SongFlowCoordinator`, `StoryFlowCoordinator`, `CreateFlowAsyncService`, `CustomCreateView`
4. **Playback + Library + Sharing + Gifting** — `MySongsView`, `PlayerComponents`, `Tabs/ExploreTabView`, `SharePostcardView`, `GiftSendFlowView`, `Flows/share*`
5. **Launch Flash + Lifecycle + Settings** — `Launch/*`, `MainTabView`, `Tabs/SettingsTabView`, scene-phase handling in `RootView`

## Phases

### Phase A — Parallel REVIEW (5 agents)

- [ ] Dispatch 5 parallel `ce:review`-equivalent agents, one per flow group
- [ ] Each agent identifies CONFIRMED issues only (no speculation)
- [ ] Aggregate findings into a single severity-sorted list

### Phase B — Fix confirmed issues (sequential)

- [ ] Triage by severity (P1 ship-blocker, P2 should-fix, P3 polish)
- [ ] Apply fixes for P1 + P2 only — defer P3
- [ ] Re-build + smoke test after each fix cluster

### Phase C — Parallel SIMPLIFY (5 agents)

- [ ] Dispatch 5 parallel simplification agents on the same flow groups
- [ ] Each agent proposes simplifications that preserve all behavior
- [ ] Aggregate proposals; reject any that risk regressions

### Phase D — Apply confirmed simplifications (sequential)

- [ ] Apply low-risk consolidations + dead-code removal
- [ ] Re-build + smoke test after each simplification cluster
- [ ] Commit logically grouped changes

### Phase E — Verify + commit

- [ ] iOS Debug build succeeds
- [ ] Server tests pass
- [ ] All commits pushed
- [ ] Document findings in `tasks/e2e-testflight-2026-04-15.md` results section

---

# Implement "The Envelope" — Schedule & Send Redesign

**Branch:** `version3`
**Approved Design:** Variant A "The Envelope" from `/design-shotgun` (2026-04-10)
**Design Artifact:** `~/.gstack/projects/computa-porizo/designs/schedule-send-e2e-20260410/`
**HTML Mockup:** `variant-A-envelope.html`
**Codex Review:** Approved with refinements (2026-04-10)

## Context

Replace the current 5-step checkout-style `GiftSendFlowView` (Content → Recipient → Delivery → Review → Success) with a single-screen emotional flow that follows YC research design principles:

- One screen, one action, one CTA
- No progress dots, no step indicators, no "Loading gift wallet..."
- Internal states stay invisible — just who, when, send
- Feels like wrapping a gift, not filling out a shipping form

## Design Decisions (from YC Research + Codex Review)

1. **Emotional arc over state machine** — compress 5 backend steps to 1 user moment
2. **One dominant action per screen** — single gold CTA at bottom
3. **Sharing must be fast** — 1 screen from reveal to send
4. **Song stays emotionally dominant** — not a tiny utility row, the emotional header
5. **Delivery as collapsed toggle** — "Send Now" default, "Schedule" expands inline
6. **Recipient = delivery destination** — abstract as "who + how", not phone-only
7. **Natural-language summary above CTA** — "Sending Sarah your song by SMS on Apr 15 at 9:00 AM"
8. **Dynamic CTA** — "Send Gift" (immediate) / "Schedule Gift" (scheduled)
9. **Billing only on block** — wallet check on CTA tap, not screen load. Frame as "unlock this gift"
10. **Flat state model** — one composer, one submit. No 5-step skeleton underneath.

## Hard Rules (from Codex)

- No progress dots
- No hidden "review" screen
- No separate "success details confirmation" masquerading as closure
- No top-of-screen wallet bootstrapping states
- No forced bundle picker before user tries to send
- No step-driven view model with screen names that leak into UX copy
- Implementation collapses the old state model, does not just hide it

## Screen Hierarchy (top to bottom)

1. **Hero** — song preview card: title, occasion art, subtle playback state (waveform). Reminds user what they're sending.
2. **Recipient** — "Who's this for?" Name field, then delivery method picker (SMS / Email), then destination input. Not prematurely phone-specialized.
3. **Note** — personal message, 3-line field, warm placeholder. Visible and inviting but not dominant. ("Write something from the heart...")
4. **Timing** — collapsed by default to "Send now". Tap to expand schedule picker. Once selected, immediately shows natural-language summary.
5. **Delivery summary** — one sentence confirming recipient + method + timing. Sits directly above CTA.
6. **CTA** — single button. "Send Gift" or "Schedule Gift". No ambiguity.

## Plan

### Phase 1: Understand

- [ ] Read GiftSendFlowView.swift fully — map all state, backend calls, edge cases
- [ ] Read GiftModels.swift, APIClient+Gifts.swift — document the API contract
- [ ] Identify: wallet check, reservation, gift creation, StoreKit sync, delivery dispatch
- [ ] List every backend call that must survive the redesign

### Phase 2: Architecture

- [ ] Design flat state model for EnvelopeSendView (no Step enum, no progress tracking)
- [ ] Define: one `@State` struct for form data, one `submit()` async action
- [ ] Plan inline sub-sheets: contact method picker, date/time picker, credit resolution
- [ ] Map wallet/billing to lazy check pattern (check on submit, not on appear)

### Phase 3: Build

- [ ] Create EnvelopeSendView.swift — single-screen composer
- [ ] Implement: song hero card with playback state
- [ ] Implement: recipient section (name + delivery method + destination)
- [ ] Implement: personal note field (3-line, warm placeholder)
- [ ] Implement: timing section (collapsed "Send now" default, expandable schedule)
- [ ] Implement: natural-language delivery summary above CTA
- [ ] Implement: dynamic CTA ("Send Gift" / "Schedule Gift")
- [ ] Implement: submit action — wallet check → reserve → create gift → dispatch
- [ ] Implement: inline credit resolution sheet (only if wallet blocks send)
- [ ] Implement: success state (inline confirmation, not a new screen)

### Phase 4: Wire & Replace

- [ ] Wire EnvelopeSendView into navigation from WarmCanvasFlowView reveal
- [ ] Deprecate old GiftSendFlowView (keep file, mark deprecated, remove from nav)
- [ ] Test E2E: create song → reveal → send gift → success

### Phase 5: QA

- [ ] Visual QA against refined mockup
- [ ] Test: immediate send path
- [ ] Test: scheduled send path
- [ ] Test: wallet empty → inline credit resolution → send
- [ ] Test: email delivery path
- [ ] Test: SMS delivery path
- [ ] Verify no leaked internal states (no loading spinners, no step language)

---

# Meta Ads SDK Integration (Active — 2026-04-11)

**Trigger:** Campaign `PORIZO_INSTALLS_Women25-45_2026Q2` burned $78.30 over 30 days with zero installs. Root cause confirmed: Facebook SDK was never integrated in iOS app. Events Manager shows "Inactive — Never received event" on Porizo dataset (App ID `1984455025792561`).

**Goal:** Wire up Facebook SDK + SKAdNetwork so Meta Ads App Install campaigns can actually measure and optimize for installs.

## Phase 1: iOS SDK Wire-Up (Code)

- [x] Add `FacebookAppID`, `FacebookClientToken`, `FacebookDisplayName`, `FacebookAutoLogAppEventsEnabled`, `FacebookAdvertiserIDCollectionEnabled` to `PorizoApp/Info.plist`
- [x] Add required `fbapi`, `fbauth2`, `fb-messenger-share-api`, `fbshareextension` entries to `LSApplicationQueriesSchemes`
- [x] Add `SKAdNetworkItems` array with Meta's published ad network IDs
- [ ] Add `ApplicationDelegate.shared.application(...)` call in `AppDelegate.didFinishLaunchingWithOptions` (gated behind `#if canImport(FacebookCore)`)
- [ ] Add `AppEvents.shared.activateApp()` call on `scenePhase == .active` (gated behind `#if canImport(FacebookCore)`)

## Phase 2: Build System (User, in Xcode)

- [ ] Open Xcode → File → Add Package Dependencies → `https://github.com/facebook/facebook-ios-sdk`
- [ ] Add `FacebookCore` product to `PorizoApp` target
- [ ] Set `PORIZO_FACEBOOK_CLIENT_TOKEN` env var in .xcconfig (value from Meta App Dashboard → Settings → Advanced → Client Token)
- [ ] Build → verify no FBSDK link errors
- [ ] Archive → upload to TestFlight

## Phase 3: Meta Business Manager Setup (User, in browser)

- [ ] Meta App Dashboard: confirm App ID `1984455025792561` is set up as iOS type with correct bundle ID
- [ ] Copy Client Token from Settings → Advanced
- [ ] Events Manager → Datasets → Porizo → link to App Store app (Porizo, id6758205028)
- [ ] Events Manager → Test Events tab → install TestFlight build → verify `fb_mobile_activate_app` fires
- [ ] Confirm red warning triangle disappears from Porizo dataset (status should flip Inactive → Active)

## Phase 4: Rebuild Campaign (User, in Ads Manager)

- [ ] Delete or archive old `PORIZO_INSTALLS_Women25-45_2026Q2`
- [ ] Create new App Install campaign
- [ ] Budget: $50-100/day minimum (learning phase needs ~50 conversions/week)
- [ ] Geo: single country (Canada — lowest CPM in previous data)
- [ ] Placements: manual — Facebook Feed + Reels + Stories, Instagram Feed + Reels + Stories ONLY. **Exclude Audience Network** and Messenger.
- [ ] Targeting: broad (age 22-55, any gender) — let algorithm optimize once it has conversion signal
- [ ] Creative: use counseling videos `young-couple-reel.mp4` + `established-couple-reel.mp4` from `marketing/remotion/out/facebook/` (3-4 ad variants)
- [ ] Bid: Highest volume
- [ ] Attribution: 7-day click, 1-day view (default)

## Phase 5: Interim Traffic Campaign (Optional Stopgap)

- [ ] If app rebuild is delayed, launch the "Porizo to the rescue" Traffic campaign Meta suggested at $20/day (doesn't need SDK, counts link clicks)
- [ ] Use as bridge for max 2 weeks while SDK integration ships

## Phase 6: Verify

- [ ] After 48h of new campaign: confirm installs are being attributed in Ads Manager
- [ ] Confirm CPM is now in expected $15-30 range (tier-1 women 25-45)
- [ ] Confirm events flowing into Events Manager (not just install — session, signup, render_complete)
- [ ] Document lesson in `tasks/lessons.md`

## Artifacts

- Setup checklist: `marketing/channels/paid-social/meta-ads-setup-checklist.md` (Phase 2+3 detailed walkthrough)
- Old campaign creative: `marketing/remotion/out/facebook/` (4 video variants, rendered 2026-03-17)
- Previous ad design brief: `marketing/remotion/2026-03-17-counseling-ad-design.md`

---

# Scope expansion: All Ad Platform SDKs (Active — 2026-04-11, build 88+)

**Trigger:** User decision to focus all efforts on marketing. Meta SDK shipped in build 88 to TestFlight. Now adding remaining ad platform SDKs so all campaigns can launch from a single instrumented build.

**Status:** In progress — code-side work, user-blocked on platform credentials.

## Phase 7: TikTok Business SDK

- [x] Add `https://github.com/tiktok/tiktok-business-ios-sdk` v1.6.0 via xcodeproj gem + SPM
- [x] Add `PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN`, `PORIZO_TIKTOK_BUSINESS_APP_ID`, `PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID` keys to Info.plist
- [x] Add `TikTokBiz.isConfigured` runtime guard in PorizoAppApp.swift
- [ ] Wire `TikTokBusiness.initializeSdk(TikTokConfig(...))` call in `AppDelegate.didFinishLaunchingWithOptions`
- [ ] Get Access Token from TikTok Events Manager → Assets → Events → Web Events → API _(user action)_
- [ ] Get numeric TikTok App ID from TikTok Events Manager → App registration _(user action)_
- [ ] Replace `$(PORIZO_TIKTOK_BUSINESS_*)` placeholders in Info.plist with real values _(user action)_

## Phase 8: Apple Search Ads (AdServices.framework)

- [x] Link `AdServices.framework` as weak-linked system framework via xcodeproj gem
- [x] Add `AppleAdsAttribution.captureTokenIfAvailable()` helper in PorizoAppApp.swift
- [x] Add `Notification.Name.appleAdsAttributionTokenCaptured` for backend consumption
- [ ] Wire `AppleAdsAttribution.captureTokenIfAvailable()` in `AppDelegate.didFinishLaunchingWithOptions`
- [ ] Backend: implement endpoint to receive the token and call `https://api-adservices.apple.com/api/v1/` to resolve campaign metadata _(deferred)_
- [ ] Apple Search Ads campaign setup in https://searchads.apple.com _(user action, only if running Apple Search Ads)_

## Phase 9: Google Ads (UAC — Universal App Campaigns)

- [x] Verified Firebase Analytics is already integrated (provides Google Ads attribution for UAC)
- [x] Confirmed GoogleAdsOnDeviceConversion SDK is in Package.resolved as transitive dep (not needed for MVP)
- [ ] Add Google's SKAdNetwork IDs to Info.plist
- [ ] Link Firebase Analytics to Google Ads account in Google Ads → Tools → Linked accounts → Firebase _(user action)_
- [ ] Configure UAC campaign in Google Ads _(user action, only if running Google Ads)_

## Phase 10: Cross-Platform SKAdNetwork IDs

- [x] Meta's 30 IDs added
- [ ] Add TikTok's ~15 published ad network IDs
- [ ] Add Google's ~8 published ad network IDs
- [ ] Dedup against existing entries

## Phase 11: Multi-SDK Build Verification

- [ ] Build for simulator with all 3 new SDKs
- [ ] Launch + verify init log lines for each: `[FBSDK] Initialized`, `[TikTokBiz] Initialized` or `Skipped`, `[AppleAds] Captured` or `No token available`
- [ ] No crashes regardless of which credentials are missing
- [ ] Release config build + archive verification

## Phase 12: Docs + Rollout

- [ ] Extend `marketing/channels/paid-social/meta-ads-setup-checklist.md` with TikTok + Apple Search Ads + Google Ads sections
- [ ] Document MMP (AppsFlyer/Adjust/Singular) as future option when spend > $10K/month
- [ ] Ship new TestFlight build (89) once all SDKs are wired

---

# Funnel Analytics Wire-Up (ACTIVE — 2026-04-21)

**Context:** Paul Solt's 5-rule packaging investigation showed the funnel from install→first-song is dark between `launch_flash_shown` and `share_initiated`. Screenshot + icon work just shipped (variant-B4). Now wiring the 4 intermediate funnel hops so Amplitude/Firebase reflect real user progression.

**Key decision (recorded 2026-04-21):** Porizo skips the preview stage by design and goes straight to full render. Legacy `preview_ready` status paths in MySongsView / JobRecoveryService / BackgroundTaskRegistrar are defensive only — production tracks transition `rendering → full_ready (or "ready")`. Analytics event is named `firstSongCompleted`, not `firstPreviewReady`.

## Review & plan per task

### Task #1 — Investigate `trackRenderCompleted` payload ✅ DONE

- `trackRenderCompleted` is a NotificationCenter refresh broadcast with lossy `{trackId}` userInfo
- Real preview/full distinction lives on `Track.status` field from server: `"full_ready"`, legacy `"ready"`
- Hook point for #6 confirmed: `MySongsView.swift:209-223` `.onChange(of: tracks)`

### Task #2 — Add `firstSongCompleted` enum case ✅ DONE

- Added at `AnalyticsService.swift:20` between `createCompleted` and `shareInitiated`

### Task #3 — Emit `auth_completed` in RootView

- Hook: `RootView.swift:312` `.onChange(of: authManager.isAuthenticated)` `if isAuthenticated` branch
- Call: `AnalyticsService.shared.log(.authCompleted, properties: ["method": <provider>])`
- Need to figure out how to surface the auth method (Apple/Google/email) from AuthManager

### Task #4 — Emit `create_started` in presentCreateFlow

- Hook: `MainTabView.presentCreateFlow` (signature seen near line 358)
- Call: `AnalyticsService.shared.log(.createStarted, properties: ["type": <song/poem>, "source": <tab/suggestion>])`

### Task #5 — Emit `create_completed` on successful track creation

- Hook: `MainTabView.handleSongFlowCompletion` at line 367 (already posts `.trackRenderCompleted`)
- Call: `AnalyticsService.shared.log(.createCompleted, properties: ["trackId": trackId])`

### Task #6 — Emit `first_song_completed` on first full_ready transition

- Hook: `MySongsView.swift:218` inside the existing `justCompletedIds` loop
- Guard: `@AppStorage("firstSongCompletedEmitted") var firstSongCompletedEmitted: Bool = false`
- Trigger: first transition to `track.status == "full_ready" || track.status == "ready"`

### Task #7 — Self-review + build verification

- Full `xcodebuild` for device; confirm `** BUILD SUCCEEDED **`
- Manual: sign out, sign back in, start/complete a create flow, confirm all 4 new events appear in `[Analytics]` debug console lines
- Update tasks/lessons.md if anything surprised us

---

# App Store Screenshots — BOLD redesign (ACTIVE — 2026-04-21)

**Status:** In progress. Current screenshots fail the Paul Solt "3-second rule" — text too small, two-color split, competing accent ornaments.

**Visual target:** Cal.com App Store listing. ONE massive bold headline (1-3 words), single color, phone shows the proof.

## Current design sins (identified)

1. Headlines split two-color (dark + coral) — halves visual weight
2. `fontWeight: 700` — not heavy enough; Cal.com uses ~900 (black)
3. `fontSize: 104-112` — too small for black text on warm cream BG at thumbnail scale
4. `letterSpacing: -2` — too loose for a display font at this weight
5. Subtitles + accent bars + 2-color headlines = 4 competing focal points

## Design system shifts

- [ ] `Headline`: single color (textPrimary), weight **900**, size **180-200**, letter-spacing **-5**
- [ ] Remove `AccentBar` from slides 1-5, 7 (keep on Slide 6 if desired)
- [ ] Remove `Subtitle` from all hero slides (let phone show the detail)
- [ ] Optional eyebrow text above headline (36pt, uppercase, coral, letter-spacing +4) — Cal-style

## Per-slide headline rewrites (short, bold, scannable)

- [ ] Slide 1 (Hero): ~~"Your Moment / in a Song."~~ → **"Your moment.<br/>In a song."** (single color, 190pt)
- [ ] Slide 2 (Voice): ~~"Every Word / In Your Voice."~~ → **"In your<br/>voice."** (190pt)
- [ ] Slide 3 (Create): ~~"Songs & Poems / Made Personal."~~ → **"Made<br/>for them."** (200pt)
- [ ] Slide 4 (Poems): ~~"Every Feeling / In Perfect Words."~~ → **"Poems,<br/>too."** (200pt)
- [ ] Slide 5 (Occasion): ~~"The Gift They'll / Never Forget."~~ → **"The gift<br/>they'll keep."** (180pt)
- [ ] Slide 6 (Features): Tighten headline; keep feature rows (feature-list slide is OK to be denser)
- [ ] Slide 7 (Share): ~~"Share the Gift / They'll Treasure."~~ → **"Share it<br/>privately."** (200pt)

## Verification

- [ ] Visual preview at localhost:5173 — each headline should be readable at thumbnail scale (~180px wide)
- [ ] Export all 4 sizes via `capture.mjs`
- [ ] Compare slide 1 thumbnail with Cal.com "Bookings" slide thumbnail — weight should feel comparable

---

# iPad App Store screenshot redesign (ACTIVE — 2026-04-23)

**Status:** Planning — awaiting user direction on approach.

**Context:**

- Uploaded iPad set on ASC is pre-Warm-Canvas (`current/ipad/01-explore.png`…`05-poems.png`, 2048×2732).
- iPhone 6.9" set is live (`current/6.9/porizo-{hero,pick,tell,hear,share}.png`, 1320×2868, Cal-AI/Warm Canvas/Fraunces).
- Generator `marketing/appstore/screenshots/generator/` is Vite+React+Puppeteer. `src/Generator.tsx` hard-codes `W=1320, H=2868` and absolute-positioned floating cards tuned to phone-portrait aspect (0.46:1). iPad target 2048×2732 is 0.75:1 — 60% wider relative to height.
- Raw iPad simulator captures exist at `current/raw-ipad/*.png` (2048×2732).

**Naive `SIZES` addition with `fit: "fill"` would horizontally stretch every element by ~60% — unusable.**

## Three approaches

### A — Phone-centered, iPad-composed (RECOMMENDED for speed)

Render at 2048×2732, keep iPhone 16 Pro Max mockup as hero, use the extra width for richer side composition (secondary floating card on opposite side, larger callout pills). New `IpadSlideBase` + iPad-tuned `phoneTop`/`phoneScale` + repositioned `FloatingCard`/`FloatingPill` per slide. Effort: 2–3 hrs. Visual: iPhone-forward but intentionally laid out for tablet.

### B — Native iPad mockup (BEST long-term polish)

Draw iPad Pro 13" frame in CSS (like existing `Phone` component). Inject `current/raw-ipad/*.png` as `screenshot` prop. Redesign layouts for iPad-native feel. Effort: 1–2 days. Needs re-captures if existing raws don't match the 5 story beats.

### C — Phone PNG letterboxed (QUICK+DIRTY)

Capture at 1320×2868 as today, pad with Warm Canvas cream `#F5F0EB` to 2048×2732 via `sharp.extend({...})`. Effort: 20 min. Visual: empty side margins signal "this app doesn't think about iPad."

## Tasks (if Option A approved)

- [ ] Add `IPAD_W = 2048`, `IPAD_H = 2732` constants + `IpadSlideBase` wrapper in `src/Generator.tsx`
- [ ] Author 5 iPad slide variants (hero / pick / tell / hear / share) reusing existing phone mockup + screenshots, re-laying floating callouts into the extra horizontal space
- [ ] Add iPad viewport + capture pass in `capture.mjs` (separate `SIZES_IPAD` array, larger Puppeteer viewport)
- [ ] Run `node capture.mjs`, verify all 5 PNGs at 2048×2732 via `sips`
- [ ] Archive old `current/ipad/*` set into `screenshots/archive/ipad-pre-warmcanvas-2026-04-23/`
- [ ] Promote `exports/ipad-12.9/*.png` → `current/ipad/`
- [ ] Update `marketing/appstore/CLAUDE.md` with iPad workflow section
- [ ] Update memory: supersede `project_ipad_screenshots_deferred.md` with a "shipped" note

## Open question for user

Which approach — A, B, or C?

---

# Artwork System — Deferred Tasks Pass (2026-05-16)

> Sequential implementation of the 5 deferred items from the artwork ship.
> Plan reference: `/Users/ao/.claude/plans/during-the-design-phase-resilient-pony.md`
> Sample artwork rendered: `storage/samples/chioma-birthday/` (3 styles × gpt-image-2 high)

## Task 1 — Bump OPENAI_IMAGE_TIMEOUT_MS default to 180s — DONE

- [x] `src/services/image-providers/openai-image.js` — default 120000 → 180000

## Task 2 — Drop audio_ready column — DONE

- [x] `migrations/110_drop_audio_ready.sql` (SQLite)
- [x] `migrations/pg/110_drop_audio_ready.sql` (PG)
- [x] Deleted `markAudioReady` + `SQL_MARK_AUDIO_READY` from `artwork-barrier.js`
- [x] Removed `markAudioReady` call + import from `runner.js`
- [x] Updated `artwork-barrier.test.js`

## Task 3 — Durable jobs-table queue — DONE

- [x] `enqueueArtworkJob` INSERTs `jobs` row (`workflow_type='artwork_render'`, status='queued')
- [x] `runArtworkJob` accepts `jobId`; transitions row through running → completed / failed / queued
- [x] `recoverOrphanedArtworkJobs` scans for queued past `next_attempt_at` + stale-running and re-fires
- [x] Runner's claim query excludes `artwork_render` so the audio pipeline doesn't pull artwork rows
- [x] Runner calls `recoverOrphanedArtworkJobs` at startup + every 60s; timer cleaned up on stop()
- [x] 9 new tests in `artwork-job.test.js` covering insert, running→completed, permanent failure, orphan recovery + edge cases

## Task 4 — PG LISTEN/NOTIFY (with SQLite fallback) — DONE

- [x] Singleton listener per process via shared pool client + `EventEmitter` fan-out
- [x] `waitForArtworkReady` race-covered: initial check, LISTEN registration, deadline recheck
- [x] SQLite path keeps polling (unit-tested mock has no `isPostgres` flag)
- [x] `notifyArtworkReady` runs `SELECT pg_notify('artwork_ready', $1)` on PG, no-op on SQLite
- [x] `markArtworkReady` calls `notifyArtworkReady` on every ready=true transition
- [x] `_resetListenerForTests` helper for test isolation
- [x] 6 new tests in `artwork-barrier.test.js`: PG ready-on-entry, NOTIFY wakeup, wrong-vid ignored, deadline recheck, PG/SQLite notify no-op + error swallow

## Task 5 — Library curation script — DONE (code shipped; operational run pending)

- [x] `scripts/curate-artwork-library.mjs` — HTTP review UI on :8765, accept/reject/reason per tile
- [x] `--report-only` mode: prints summary + rejection list to stdout (CI-friendly)
- [x] Path-traversal protection via `listAllPrompts` whitelist
- [x] Persists to `storage/artwork-library/curation.json`
- [ ] Bootstrap the 45 images (operational, ~30min + ~$2.40)
- [ ] Manual curation pass

## Verification gates

- [x] All artwork tests pass (85/85 — 38 song-artwork + 32 artwork-job + 12 barrier-tests + 3 fixtures-loaded)
- [x] Full project suite passes (526/526 + 6 skipped, was 513/513 — +13 new tests, 0 regressions)
- [x] ESLint clean on all changed JS/MJS files
- [ ] Apply migration 110 to production via `cat migrations/pg/110_drop_audio_ready.sql | railway connect postgres`
- [ ] Commit
