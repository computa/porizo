# Magic-link legacy-account recovery (2026-07-13) — SERVER FIX DONE 2026-07-14

**Bug:** Owner of an Apple+phone account requests a magic link for the same (unverified) email → server throws `LEGACY_ACCOUNT_RECOVERY_REQUIRED` (409) → iOS flashes Sign-in-with-Apple and strands the user. Verified in prod logs (txn `a6005367…`) + DB (`user_2bc191587da2551881aab8ba`: apple+phone providers, email contact `verified_at=NULL`).

**Design evolution:** the original "auto-merge when safe" guard (email not an auth provider) was found CRITICALLY vulnerable by security review — attacker plants victim's email as an unverified contact on their own account, victim's magic-link click signs them into the attacker's account. Even the reviewer's "email-only shell" fix (1) left a residual hole (email-shell attacker plants a SECOND email as unverified contact — `createOrUpdateContact` doesn't constrain which emails an account may hold). Final airtight predicate shipped:

> **Auto-adopt iff every active auth factor on the matched account is an email provider whose subject == this exact magic email (or the account has zero auth factors).** Anything else → 409 recover-via-other-factor.

### Shipped (all verified 2026-07-14)

- [x] `identity-repository.js`: `listActiveAuthProvidersForUser` now returns `provider_user_id` too (sole caller = the new guard).
- [x] `auth.js consumeMagicTransaction`: replaced `emailIsAuthProvider` guard with `isSafeEmailShell` predicate; 409 details use the account's actual providers.
- [x] Fixed latent `ReferenceError`: the adopt branch called bare `verifyContact` (never imported) → the "shipped" auto-adopt could NEVER have succeeded (always crashed → 400). Now `identityService.verifyContact`. Silver lining: the takeover hole was likely never exploitable in prod — the crash masked it.
- [x] Prod audit query (read-only, via `railway connect postgres`): 75 provider-backed accounts, exactly 1 email-only account (internal `re***@porizo.co` test account, 0 tracks) → **no stranded population**. All 9 foreign unverified email contacts sit on provider-backed (recoverable) accounts.
- [x] Adversarial tests added (`test/magic-login-api.test.js`): planted-second-email attack → 409 + contact stays unverified; true email-shell own-email login → adopts + verifies; zero-provider legacy contact account → adopts. Existing apple-provider 409 test still green.
- [x] Full suite: 3235 tests, 3212 pass, 0 fail, 23 pre-existing skips.

### Outcome for the affected user (Apple+phone, unverified email)

409 → recovery screen → sign in with Apple/phone once (U2 flow works) → email gets verified → every future magic login is seamless. This is security-correct: until verified, that account is structurally indistinguishable from an attacker's.

### Deployed 2026-07-14

- [x] Committed `b81df270` (auth.js + identity-repository.js + tests + task files; scope-verified, no unrelated files).
- [x] Pushed → Railway auto-deploy `48236365` **SUCCESS**, `meta.commitHash = b81df270` (verified via deployment JSON — prod serves the fix).
- [x] No migration needed: change is schema-free; magic-login migrations 124–128 confirmed already applied in prod `schema_migrations` pre-deploy.
- [x] Server booted clean (03:42 +08, listening; OneSignal tag-sync 404s are pre-existing noise). Live probe: `POST /auth/magic/exchange` garbage → 400 `INVALID_MAGIC_LOGIN` ✓.
- [x] Owner's live test on build 150 FAILED (tap did nothing) → traced: click never reached the server; iOS universal link opened the app and build 150's state race dropped the flow (scene-active refresh clobbers the pending state → collapses to email entry, zero network).
- [x] iOS fix shipped (2026-07-14): terminal-state guard (`isTerminalMagicState`, nonisolated) in `performMagicLoginStatusRefresh`; CheckEmailView reuses predicate. 17/17 AuthManagerTests (incl. new regression tests; stale expiry test corrected to recovery-grace semantics).
- [x] Build **1.5.27 (151)** archived + uploaded to TestFlight (manual-signing ExportOptions-manual.plist + ASC API key; `-allowProvisioningUpdates`/automatic signing does NOT work for export — use the manual plist). AppsFlyer dSYM warning benign. Scoped GO audit: `docs/appstore/appstore-review-2026-07-14.md`.
- [x] Pushed `6d6df506`/`7374fbff`/`605fbc75`/`ae076dbc` → origin/main (TestFlight ↔ git lockstep per the build-150 lesson). Also shipped in 151: review-prompt policy refactor (pre-prompt sheet removed).
- [x] **Build 151 live test PASSED** (2026-07-14 04:45, prod logs): tap → `/auth/magic/exchange` → **409 LEGACY_ACCOUNT_RECOVERY_REQUIRED** (42ms) → recovery screen rendered correctly (screenshot) → Apple sign-in → 200s, session issued, recovered. The race fix works: the tap now reaches the server (build 150 sent zero).
- [x] Removed "Continue with phone" from the recovery screen for Apple-backed accounts (`AuthView.swift`): phone now shows ONLY for legacy phone-only accounts (3 exist in prod — verified — removing outright would strand them). New users register email-only; phone/Apple are not signup methods. Also fixed `.contains(where:)`→`.allSatisfy` so "contact support" no longer shows alongside a working Apple button.

### Build 153 (2026-07-14) — two more races fixed from the build-152 on-device test

Traced via prod logs (only 1 exchange despite 2 taps; `/auth/social` 200 then `/app/config` re-init flash):

- [x] **First tap dropped** (`handleMagicLoginURL`): an in-flight status poll could short-circuit the handler before `/auth/magic/exchange`. Poll is now drained but never short-circuits — link secret is authoritative, every tap exchanges. → "tap twice" gone.
- [x] **Email screen flash** (`AuthView`): fell back to email-entry whenever `loginPresentation` nil, incl. the post-recovery `.auth`→`.main` frame. Added `isMagicFlowResolving` → progress placeholder instead of the email field during opening/exchanging/recovery/success.
- [x] AuthManagerTests green; builds clean; audit GO; **build 153 uploaded + pushed** (`36704fcc`).

### FINAL human check on build 153

Request magic link → **first** tap should sign in (no second tap) → recovery screen shows Apple only (no phone, no email-field flash) → recover → done.

### Known follow-up (separate, lower priority)

- [ ] **Post-recovery 401 burst ("struggled"):** after Apple recovery, the app fires authed data fetches BEFORE the new access token is installed → ~12× 401, then APIClient auth-retry replays → 200. Self-heals but visible jank (did NOT recur on build 152 — intermittent, token-timing dependent). Fix: gate the initial post-auth data load behind the token swap. Client-only; server correct throughout.
- [ ] **Test-harness gap:** `AuthManagerTests` has no mock-API injection, so `handleMagicLoginURL`'s exchange path (the two-tap fix) is covered only by build + manual test, not a unit test. Add a mock APIClient harness if this area churns again.

### iOS — recovery screen holds stably (fallback path)

- [ ] Fix the presentation race: `.legacyRecovery` must NOT clear `pendingMagicLoginPresentation`; concurrent triggers (`onOpenURL`, scene-phase `.active` refresh, `CheckEmailView.task` poller) must not clobber it to `.wrongDeviceOrPlatform`/nil.
- [ ] `CheckEmailView` renders the recovery actions inline (Apple/phone buttons) OR `AuthView.legacyRecoveryActions` stays mounted — no flash to email-entry.
- [ ] Verify on simulator: legacy-recovery state holds; Apple button runs SIWA → same account → signed in.

### Ship

- [ ] Backend: push to origin/main → Railway auto-deploy → verify route/behavior against prod.
- [ ] iOS: bump build, archive, upload to TestFlight, release to internal testers.
- [ ] On-device verification by user (the whole point).

---

# App Store Demand And Attention (2026-07-11) — ACTIVE

**Tracked ExecPlan:** `docs/plans/2026-07-11-app-store-demand-and-attention-execplan.md`

- [x] Live-state and keyword audit completed.
- [ ] Restore App Store acquisition analytics. (`Porizo Reports` can read but no ongoing request exists; an Admin must create it once.)
- [x] Repair review acquisition and recipient-play push delivery through OneSignal.
- [x] Ship evergreen keywords and live regional localizations to editable 1.5.27.
- [ ] Complete CPP assignment, routing, and measurement. (Live manifest/audit complete; conversion analytics blocked by role.)
- [ ] Implement the bounded recipient App Clip. (Code, shared scheme, AASA, and simulator builds complete; parent-linked App Clip ID must be registered in Apple’s web portal, then physical invocation remains.)
- [ ] Ship seasonal event/nomination operations and resolve zero App Tags. (AU Father’s Day event is waiting for review; nomination drafted; tags remain Apple-controlled.)
- [x] Complete full code validation and retrospective; external production evidence remains in the ExecPlan.

---

# Marketing Factory Streamlining (2026-07-10) — COMPLETE

**Goal:** Consolidate scattered marketing efforts into 6 clear pipelines + production loops. Doc → pressure-test → adversarial review → execute archival cleanup. Full plan: `~/.claude/plans/we-have-made-a-generic-squirrel.md`.

- [x] Explore inventory (marketing/ assets, scripts/docs/backend, skills/agents) — 3 parallel agents
- [x] Design 6-pipeline architecture (Plan agent)
- [x] B1 ASO pressure test — `rank-track.mjs` runs live (US birthday-song-gift #1, AU #1, NZ weak) ✓
- [x] B2 Meta ads — `scripts/ads/run.mjs` full run OK (recommend-only); **Meta MCP WORKS** (acct 29474028) — contradicts old "MCP can't OAuth" memory ✓
- [x] B3 Video — Remotion bundles + renders still (Ad-FathersDay-Product-Vertical, 2.9MB) ✓; real comp IDs differ from design names
- [x] B4 TikTok pipeline — modules load standalone, argparse wired, stdlib+ffmpeg only ✓ (unblocks tiktok-trial archival)
- [x] B5 Blog ingestion investigation — DB-authored backend confirmed; tracked production publisher already implements create/review/repair/publish and has focused tests. No production article was published as part of this safe review.
- [x] B6 Housekeeping — pressure test originally found 3 launchd agents; the follow-up review found none of the three loaded. Most archive payloads are local-only; only non-personal email artifacts and the manifest remain tracked.
- [x] A Authored `docs/marketing/PIPELINES.md` (6 pipelines + 3 loops + build-status/credential/skip-impact tables)
- [x] C Adversarial review (3 critics: CMO, solo-ops, premortem) — all findings folded in
- [x] D Created tracked marketing router (`.agents/skills/marketing/SKILL.md`) plus a tracked, non-duplicating Claude compatibility shim.
- [x] E Cleanup executed — archived 5 dead dirs (~509 MB) to `marketing/archive/2026-07-consolidation/` + manifest; heavy/generated payloads and recipient data are explicitly local-only.

**Adversarial-review corrections applied to the doc:**

- Added **Pipeline 1 (recipient conversion / viral loop)** as TOP priority — the diagnosed failure had no pipeline.
- **Meta ads → DORMANT** (5× CPI on non-converting funnel); **TikTok ads folded into it** (not standalone).
- Reordered around distribution (ASO/blog/social ahead of paid); added Reddit/App Store editorial/creator-seeding bets.
- **90-min Monday block was fiction** → 15-min minimum-week floor + graceful degradation + skip-impact table.
- Build-status + credential-recovery tables; Friday status as the forcing function; staleness tripwire.

**Cleanup review corrected the original gate (the ENOENT lesson):** literal grep missed the dynamically assembled `marketing/emails/` runtime path, so the moved nurture templates were restored and covered by a focused route test. The reviewed keep set also includes `marketing/email/` (admin route + audio-probe logs), `ads-analytics/` (analyzer output), `product demo`/`audio hooks`/`campaigns` (tiktok-pipeline input pools), and `gtm/` (gtm-daily skill data). The follow-up `launchctl list` showed no matching Porizo agents loaded.

**Committed for review:** `673166cb`. Follow-up review removed personal recipient data from tracking, made the router portable, reconciled pipeline numbering/order, and corrected the already-built blog publishing path. Because the recipient CSV entered the unpushed commit, that commit must be amended or otherwise rewritten before push; a later deletion commit would not remove the data from history.

**Key corrections found during pressure tests:**

1. Meta MCP is live in-session → demote `meta` CLI to fallback (update memory note).
2. Two legacy plists were retirement candidates during the pressure test; neither corresponding agent was loaded at follow-up.
3. Real Remotion comp IDs: `Ad-FathersDay-Product-Vertical`, `Ad-DriveHome-V5`, `Video3-ThatSummer-V3` (not the design's assumed names).
4. Cleanup is mostly untracked local clutter — the git commit will be tiny.

---

# Android → iOS parity (pure-native Kotlin) — superseded the Skip spike

**Status:** the Android app is now **pure-native Kotlin + Jetpack Compose** (no Skip).
The earlier Skip-Fuse spike (`Sources/PorizoSkipSpike/`, `swift test`, the U1–U18 "Skip
gotcha" log) was retired; those artifacts were removed from disk on 2026-07-04. The full
historical Skip progress log lives in git history (commit `1efa6747`) if ever needed.

**Where the current work lives:**

- App source: `.worktrees/refactor-android/PorizoAndroid/Android/` (native modules `core:*` + `feature:*`).
- Native parity plan: `docs/plans/2026-07-05-001-feat-android-native-ios-parity-plan.md`.
- Live U11 audit + external-QA ledger: `docs/parity-2026-07/native-parity-audit-2026-07-05.md`.
- Gap register: `docs/parity-2026-07/android-ios-parity-gaps.md`; app-links deploy artifact: `docs/parity-2026-07/android-assetlinks.md`.
- Build (gradle is hook-redirected → run via context-mode ctx_execute):
  `cd Android && ANDROID_HOME=~/Library/Android/sdk JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" GRADLE_USER_HOME=/private/tmp/porizo-gradle-cache gradle :app:assembleDebug`

**Recent (2026-07-04):** P1 parity gaps closed (Settings/create-entry/gift CTA); lock-screen
media controls added (`MediaSessionService`, arxitect-reviewed, commit `20c2c241`); deep-link
routing + authed screenshots verified on-device. Remaining is external provisioning, not code —
see the audit doc's external-QA ledger (assetlinks hosting, OneSignal/FCM, Play products, real
backend session for loaded-data, physical device).

---

# Goal: Architectural Map + Ranked Refactor Plan (analysis-only pass)

**Requested:** (1) align codebase with architectural best practices / modularity, (2) simplify + remove patchwork/short-term implementations, (3) updated architectural map.

**Decided scope (user-confirmed 2026-06-26):**

- **Map + ranked plan FIRST. Zero code changes this pass.**
- Revenue path (billing / auth / receipt-validation) → **documented but NOT modified** unless a proven correctness bug.
- Refactor _candidates_ to surface: writer pipeline, workflow runner, admin routes, providers, server.js.

This is **Step 1 of the architectural-loop**: identify the architectural roots. Execution of any root is a separate, approved pass.

## Plan

- [x] P1 — Fan out parallel scouts to map each subsystem (6 scouts: routes, services, writer, workflows, providers, database/server)
- [x] P2 — Catalog god-files, coupling, duplication, patchwork/short-term markers, dead code
- [x] P2b — Formal arxitect review (OO design + Clean Architecture + API design) on worst offenders
- [x] P3 — Synthesize `docs/architecture/architecture-map-2026-06.md` (honest current-state map)
- [x] P4 — Build ranked debt register (D1–D6 + 2 CRITICAL correctness findings) with blast-radius + effort
- [x] P5 — Sequence 10 architectural roots into 4 phases (`docs/architecture/architecture-debt-register-2026-06.md`)
- [ ] P6 — **AWAITING USER REVIEW** of the plan: order, C1 handling, branch strategy, test gate. NO implementation.

## Deliverables

1. `docs/architecture-map-2026-06.md` — current architecture, real (not aspirational)
2. `docs/architecture-debt-register-2026-06.md` — ranked debt + roots

## Guardrails

- No edits to `src/**` this pass (analysis only).
- Verify claims by reading code (per claim-verification rule) — no grep-only assertions in the map.
- Don't re-litigate the completed feature-audit; this is structural, not feature-level.

---

# Deferred — tackle later (found during refactor verification + TestFlight deploy, 2026-06-30)

> Context: `refactor` branch is deployed to Railway prod (`api.porizo.co`) via `railway up`, smoke-verified, and a real song rendered end-to-end. iOS 1.5.26 (146) is on TestFlight. These issues are NOT refactor regressions — pre-existing ops/config gaps surfaced by the live test. `main` is unchanged (rollback anchor: deployment `b86b2b73`).

## D-A — APNs render-completion push not configured in production (the ~100s "song ready" delay)

**Root cause (verified):** Production has 0 of the required `APNS_*` vars (checked 92 Railway prod vars). `pushNotification.isConfigured()` (`src/services/push-notification.js:40`) returns false → the push block in `src/workflows/runner.js:3338` is skipped → no render-completion push is ever sent. The app then only learns the song is ready via its own poll loop, which backs off to a 30s max interval on long renders (`PorizoApp/.../Controllers/RenderController.swift:19-38`), causing a ~100s gap between server-side completion and the app showing the result.
**iOS + server code are both correct and complete** — this is purely missing prod config. Not a refactor regression (missing on `main` too).
**Fix:** Set 5 Railway prod vars:

- [ ] `APNS_TEAM_ID=5VCH6937XM`
- [ ] `APNS_BUNDLE_ID=porizo.ios.app.PorizoApp`
- [ ] `APNS_PRODUCTION=true`
- [ ] `APNS_KEY_ID=<the APNs auth key's id>` — **BLOCKER: identify which `.p8` is an APNs key** (5 found on disk: `684S2UP4C8`, `7Q8RMW3LUM`, `83HHTLB8MR`=ASC, `46753BLRQ7`, `V5B5WV9H3B`). Check developer.apple.com → Keys for the one with "Apple Push Notifications service (APNs)" capability, or create one.
- [ ] `APNS_PRIVATE_KEY=<.p8 contents of that key>`
- [ ] No app rebuild needed once set — the shipped TestFlight build already registers + uploads the APNs token.

## D-B — OpenAI quota exhausted (429) → lyric word-timing/alignment fails

**Symptom in prod render:** `[JobRunner] Lyrics alignment failed: E401_WHISPER_ERROR: API error 429 - You exceeded your current quota`. Degrades gracefully (song still completes, `master.m4a` uploaded), but the timed/karaoke lyrics are missing.

- [ ] Top up / raise OpenAI quota (Whisper alignment uses `OPENAI_API_KEY`).
- [ ] Optional: verify alignment populates once quota restored.

## D-C — Anthropic API credit exhausted → artwork-vars fall back to defaults

**Symptom in prod render:** `[LLM] anthropic ... Your credit balance is too low` → `[artwork-vars] Haiku failed ... using defaults`. Degrades gracefully (artwork still generated via flux), but variable extraction quality drops.

- [ ] Top up Anthropic API credits (artwork-vars extractor uses `claude-haiku-4-5`).

## D-D — OneSignal tag-sync 404 on boot (pre-existing noise)

**Symptom:** Startup batch `[OneSignal] Tag sync completed updated=0 errors=76 total=76` — 404s syncing tags for 76 users. `[INFO]` level, present before the refactor. Low priority.

- [ ] Investigate why OneSignal tag sync 404s for these users (stale OneSignal IDs?).

## D-E — Optional iOS mitigation: render-poll backoff is aggressive on long renders

Even with APNs fixed, the foreground poll caps at 30s (`RenderController.swift` `backoffIntervalsNs`). If push is the primary signal this is fine; if we want snappier in-app fallback, consider capping backoff at 10s or shrinking intervals near expected completion. Lower priority than D-A.

- [ ] Decide whether to tighten poll backoff after D-A (APNs push) lands.

## D-F — Merge decision: `refactor` → `main` (HELD by user)

Backend deployed + song rendered successfully, but user is validating more in-app before merging. 189 commits ahead of `main`.

- [ ] Confirm in-app experience is good (playback, share, gift flows).
- [ ] Then merge `refactor` → `main` (style TBD: merge-commit vs squash vs PR) — OR `railway redeploy` to roll back to `main` if issues found.

### E2E sim trace findings (2026-07-14 ~10:45, Claude session)

Full repro in simulator (request + tap same install, prod API via `SIMCTL_CHILD_PORIZO_API_BASE_URL`):

- [x] **FIXED IN PROD — new-user email signup was completely broken**: exchange rejected `code=23514` (pg `check_violation`). `migrations/pg/091_user_contacts.sql` CHECK on `user_contacts.source` lacks `'magic_link'`. SQLite twin has NO check → 3,238 tests green while prod 500s. **Migration 130 (pg widens CHECK; sqlite no-op) applied to prod + recorded in schema_migrations + verified** (`pg_get_constraintdef` now includes magic_link).
- [ ] **OPEN — client completion self-sabotage loop** (needs iOS fix + build 155): after the constraint fix, tap → exchange → poll sees `consumed` → `/auth/magic/native/complete` returns **200 with credentials repeatedly** (server perfect), but the client rejects its own success each time, shows "We could not check the link", retries every ~3.5s. Diagnosed cause: `finishMagicLogin` (or its caller) re-checks `isCurrentMagicOperation(generation, sessionGeneration:)` AFTER installing the session — and login itself bumps `authSessionGeneration` (`AuthManager.swift:1831/:2042`) → guard fails → own success discarded. Fix: capture/exempt the session-generation bump caused by the operation itself (or drop the sessionGeneration check post-install). See `AuthManager.swift:821-831` + `:1898-1920`.
- [x] User-confirmed context for the phone TestFlight failure: the tapped email was **not initiated from that install** — platform-bound by design; needs clearer UX copy ("requested on another device — request a new one here") instead of silent absorb / generic error.
