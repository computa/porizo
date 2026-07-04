# ACTIVE: Android (Skip spike) → iOS parity audit + phased plan (2026-07-03)

**Goal:** Replicate the exact iOS app on Android. Audit every tab/section/function/flow, curate a gap list, turn it into a phased plan via /ce-plan.

**Ground truth (verified):**

- iOS: `PorizoApp/` — 287 Swift files, ~80 screen/view files (full app)
- Android: `.worktrees/refactor-android/PorizoAndroid/Sources/PorizoSkipSpike/` — 12 files, ~5 tab stubs in one `ContentView.swift`
- Shared: 5 tabs (Explore, Songs, Poems, Claim, Settings), design tokens, backend
- Scope: FULL parity, phased (P0 core → P1 → P2). Method: screenshots + source.

## Plan

- [x] Boot Android emulator + capture each tab (adb; 5 tabs)
- [x] Boot iOS simulator (--bypass-auth) + capture each tab + create flow
- [x] Map iOS screen inventory from source (2 scout agents, all tabs + cross-cutting)
- [x] Map Android spike surface from ContentView.swift (12 files, ~25 stub structs)
- [x] Gap analysis per tab + cross-cutting
- [x] Curate consolidated gap list → docs/parity-2026-07/android-ios-parity-gaps.md
- [x] /ce-plan → phased implementation plan → docs/plans/2026-07-03-001-feat-android-ios-parity-plan.md (18 units, P0/P1/P2)

**Key finding:** Android is a Skip _spike_ (~5-10% of iOS), not a port. iOS = 4 tabs; Android has an extra mock "Claim" tab (remove, X1). ~12 P0 items dominated by create wizard + playback + real library + auth.

## Implementation progress (/ce-work on `refactor` branch in worktree; plan doc = docs/plans/2026-07-03-001-...)

**Location:** all Android source at `.worktrees/refactor-android/PorizoAndroid/Sources/PorizoSkipSpike/`. Commit on `refactor` branch.
**Build:** `cd Android && ANDROID_HOME=~/Library/Android/sdk JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" GRADLE_USER_HOME=/private/tmp/porizo-gradle-cache gradle :app:assembleDebug` (run via context-mode ctx_execute — Bash build is hook-redirected). APK at `.build/Android/app/outputs/apk/debug/app-debug.apk`.
**Tests:** `swift test --filter "AuthLogicTests|TabModelTests|AudioHeaderTests|PlayerModelTests|SongLibraryTests|PoemLibraryTests|CreateFlowTests"` — runs on macOS host (NOT full `swift test` — its XCSkipTests Gradle leg fails on SkipUIBridging). 59/59 pass.
**Emulator:** AVD `Porizo_GateA_API36`, `com.porizo.app`. adb at `~/Library/Android/sdk/platform-tools/adb`.

**Skip gotchas (hit repeatedly):**

1. `private` on `@State`/`@Environment`/`@Observable` in a bridged View → "cannot be bridged". Drop `private`.
2. `@Observable` models need `import Observation` + `import SkipFuse` + `@MainActor`.
3. Host `swift test` needs `HostTestShims.swift` (#if os(macOS) no-op shims for navigationBarTitleDisplayMode/textInputAutocapitalization/keyboardType) — already in place.
4. SF Symbols like arrow.right/sparkles fall back to a warning-triangle glyph on Skip (P2 icon-mapping).

**DONE (P0 — ALL 10/10):** U1 tabs (9d50274) · U2 ExoPlayer (efb85c8) · U3 player+mini (2ed0253) · test-infra (57cf0fd) · U5 Songs (0882e16) · U4a-d auth (85f751c/e046b6d/a435b55/c5c3ada) · U6 Poems (8378a37) · U7 create-entry (de28944) · U8 story-conversation (ad3aeb8) · U9 lyrics+render+poll (1c10eb2d) · U10 reveal+share (5ea1136e). Tests: 93/93. Create flow: launch→name→details→conversation verified (fires /story/start; "Sign in required" signed out). Reveal/share code-complete; a signed-in end-to-end reveal smoke awaits the Google OAuth client ID.

**U4 note:** Google sign-in compiles but needs `AndroidAppConfig.googleWebClientId` (empty placeholder). Phone auth works. Google button self-disables as "coming soon".
**U9 note:** old CreateSongView removed in U7; `VoiceSource`, `AndroidRenderPollStore`, `PorizoPendingRender`, `AndroidCreateDraftStore` now temporarily unreferenced — U9 will consume them (render polling + voice selection).

**TODO (P0 remaining):**

- [x] U8 — AI story conversation (DONE, ad3aeb8). confirmStory ConfirmStoryOutcome handles 422=needsInput. StoryEngine tested.
- [x] U9 — lyrics review + render + poll (DONE, 1c10eb2d). Pure AndroidRenderController (backoff elapsed-bucketed 1/2/5/10/30s, terminal set {failed,dead_letter,blocked}, resume-before-start decision, error taxonomy + Edit-Lyrics/paywall CTA gating) — RenderControllerTests 16/16. AndroidRenderModel @Observable poll loop: approve→render_preview→poll /jobs/:id→re-fetch GET /tracks/:id (C7)→reveal; 3-miss fallback; PorizoPendingRender persist (C12). API added: retryPreview, approveLyrics. LyricsReviewView/RenderWaitView/VoiceChips wired into .lyrics/.wait. My Voice disabled per KTD7.
- [x] U10 — reveal + share (DONE, 5ea1136e). RevealView (Play→U3 player, Send-to-{name} one-tap, Share-link). SharePostcardView (POST /tracks/:id/share on appear → link+PIN, Copy/Share, no expiry urgency). PorizoNativeShareBridge.kt (ACTION_SEND chooser + smsto: + clipboard, KTD3, wired in Main.kt). Pure ShareLogic + ShareFlowTests 9/9. Per-app custom grid deferred (system chooser covers it).

## P0 COMPLETE (10/10). P1 in progress.

**P1 DONE:**

- U11 onboarding (8baa1cc8) — question-graph, pure OnboardingGraphEngine + 8 tests, @AppStorage gate, template resolution. **Skip gotcha #5 (lessons):** @Observable recomposes only on reads of the model's own STORED props.
- U12 deep-link claim (aa35ac1a) — claim SHEET (not tab; completes X1/X4/R1/R2). Pure ClaimLogic (share-state map + device-token single-retry-on-401) + 12 tests. AndroidClaimModel resolves track-share + opaque receiver-handoff (persisted across install→login). Verified live: porizo://receiver-handoff/<id> → sheet → resolves api.porizo.co → honest error on bad id. Tests: 113/113.
- U13 poem create branch + poem-share claim (649270ea) — finish() branches to /story/:id/to-poem (synchronous → verses reveal); poem-share deep link → PoemClaimView. Pure PoemClaimLogic + 7 tests. **Deep-link Skip gotchas #6/#7 (lessons):** parser must route by host + manifest must declare host (poem-share was silently .unknown); warm-while-active delivery needs a direct callback, not @Observable signal. Verified: cold porizo://poem-share/<id> → sheet → live resolve. Tests: 125/125.

- U14 push parsing + tap routing (a0a92c1a) — pure AndroidPushRouting (render_complete→trackReveal, recipient_played→informational) + 7 tests. OneSignal click listener → bridged onNotificationTap → Songs tab. Delivery external (R-2). **Skip gotcha #8 (lessons):** #if SKIP Kotlin funcs can only reference Kotlin-visible symbols → forward to a bridged Swift method. Tests: 132/132.

- **Icon/splash fix** (5dcc9381, user-reported) — Android launcher + Android-12 splash used the OLD maroon "P" brand; replaced with the iOS AppIcon coral gift-box (all-density PNGs from the 1024px source, bg #D8643F, Theme.Porizo splash). Verified on emulator.

**P1/P2 remaining:** U15 gift+Play Billing (**BLOCKED R-1: needs new backend consumable-receipt endpoint**) · U16 Settings real · U17 voice enrollment (**gated KTD7: voice cloning not product-ready**) · U18 polish (dark mode, SF-symbol mapping, copy).

**Session end 2026-07-04:** refactor branch at 5dcc9381. P0 complete (10/10) + P1 U11/U12/U13/U14 done + icon fix. 132/132 host tests. 8 Skip gotchas captured in lessons.md. Remaining: U15 (backend-blocked), U16, U17 (KTD7-gated), U18. Next agent: resume at U16 (Settings — fully unblocked) or U18 (polish); U15 needs the backend consumable endpoint first.

**iOS contracts reference:** exact endpoints/models/state-machines are in the agent reports; the plan doc U8/U9/U10 sections have per-unit file lists + test scenarios.

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
