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
