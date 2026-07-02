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

---

# ACTIVE TASK: Android UF1 foundation + retoken loop (Gate A spike) — started 2026-07-02

**Target:** `PorizoAndroid/` Skip app on `emulator-5554`.
**Plan:** `docs/plans/2026-07-01-001-feat-android-design-replica-fidelity-plan.md` (UF1).
**Loop:** implement → build/install on emulator → screenshot-review → curate issues → fix → verify.

## Verified ground truth (2026-07-02)

- Spike = 10 Swift files; 29 View structs in one 2773-line `ContentView.swift`. Zero `DesignTokens`/`Fraunces`/`.ttf` (clean slate).
- **CRITICAL:** iOS `DesignTokens.swift` colors are asset-catalog-backed (`Color("Colors/Gold")`), NOT hex literals. Skip does NOT read iOS asset catalogs → must port RESOLVED hex from `PorizoApp/Assets.xcassets/Colors/*.colorset` (27 colorsets, each with light+dark appearance). e.g. Gold = light #E07850 / dark #E88A65.
- `skip 1.9.4` on PATH; `emulator-5554` live.

## Plan

- [ ] 1. Extract all 27 colorsets' light+dark hex (subagent) → color table
- [ ] 2. Create `Sources/PorizoSkipSpike/DesignTokens.swift` (Skip-compatible: hex init + light/dark, spacing, radius, Fraunces font helpers, shadow tokens)
- [ ] 3. Source 4 Fraunces static weights → `Android/app/src/main/res/font/fraunces_{regular,medium,semibold,bold}.ttf`
- [ ] 4. Wire `Font.custom("Fraunces", …)`; normalize 3 shadow systems into named tokens
- [ ] 5. Retoken existing spike screens to consume DesignTokens
- [ ] 6. `skip export --debug --android`; install APK on `emulator-5554`
- [ ] 7. Screenshot-review every screen
- [ ] 8. Curate issues (missing tokens, wrong colors, font not loading, SF Symbol triangles)
- [ ] 9. Fix all curated issues
- [ ] 10. Verify: rebuild, re-screenshot, confirm each fix; token snapshot assertions

## Progress (loop turn 1)

- [x] 1-7 tokens+font+retoken+build+install+screenshot (Explore/Settings, Create, Recipient)
- [x] 8 Curated: I1(HIGH) Fraunces sans-serif — ROOT CAUSE (skip-ui Font.swift:206): Font.custom("Fraunces") getIdentifier can't match res/font/fraunces_*.ttf. I2(HIGH) SF Symbols render as ▲ (15 symbols) — DEFERRED to own loop. I3(MED) accents blue not coral. I4(LOW) chips flat — deferred.
- [x] 9 FIXED I3 (coral): .tint(gold) at app root + hue port. FIXED crash: fraunces.xml font-family crashed getFont() on API36 → removed, point #if SKIP name at single "fraunces_regular".
- [x] 10 VERIFY (SCREENSHOT-CONFIRMED on com.porizo.app, NOT com.porizo.skipfusespike):
  - ✅ I3 CORAL: hero gradient coral, all CTAs/links/tab-selection coral, NO mustard anywhere. BIG win.
  - ✅ ICONS: real glyphs render (home/play/pencil/lock/gear/waveform) — SF-symbol triangles GONE on tabs.
  - ✅ CRASH fixed: app runs, 5 tabs functional.
  - ❌ I1 FRAUNCES: still sans-serif. ROOT CAUSE PROVEN: variable Fraunces .ttf loads via getFont (no crash/warning) but Compose renders default≈sans. This IS the plan's UF2 answer: variable-file Fraunces does NOT render as serif via Skip. NEEDS real static Fraunces-Regular.ttf (Google Fonts, network-gated) — no fonttools locally to instance it.
  - I5 (NEW) hero text clipped by fixed .frame(height:154). FIX1 (minHeight+fixedSize) removed clip but caused title/subtitle OVERLAP (caught by screenshot). FIX2 ✅ VERIFIED: gradient as .background of content (content-driven height, .bottomLeading frame) — no clip, no overlap, subtitle spaced correctly.

## I1 Fraunces — KNOWN LIMITATION (3 verified attempts, STOPPED per user 2026-07-02)

Fraunces will not render as serif via SkipUI `Font.custom` on Android. Evidence:

1. Variable .ttf (360KB): loads, renders sans.
2. res/font/fraunces.xml font-family (4 weights): CRASHES getFont() NotFoundException on API36.
3. Real STATIC fraunces_regular.ttf (71KB, from Google Fonts CSS API, verified in APK): resolves, NO warning, STILL sans-serif.
   Root cause deep: Font.kt findNamedFont→getFont(fid)→FontFamily(customTypeface); .weight() (Font.kt:104) preserves fontFamily; family IS passed to Compose. Yet renders system font. Likely Skip 1.9.4 / Compose FontFamily(Typeface) bug.
   ✅ FIXED (2026-07-02 turn 3) via KTD-F5 ComposeView escape hatch. SCREENSHOT-CONFIRMED: "Explore" renders Fraunces SERIF (vs sans hero right below it = proof). Root cause CONFIRMED: SkipUI Font.custom does NOT honor FontFamily(Typeface); raw Compose FontFamily(Font(R.font.fraunces_regular)) DOES.

FIX PATTERN (working):

- Android/app/src/main/kotlin/Main.kt: `FrauncesTextComposer: skip.ui.ContentComposer` renders Compose Text with FontFamily(Font(R.font.fraunces_regular)). Color = Color(colorArgb.toInt()) [NOT toULong — different bit packing]. No Int64(bitPattern:) [not in Kotlin].
- Sources/PorizoSkipSpike/FrauncesTitle.swift: #if SKIP → ComposeView{FrauncesTextComposer(...)}; #else → SwiftUI Font.custom. Color passed as FrauncesTitleColor enum → ARGB Int64 literal (no SwiftUI Color bridging).
- All 4 title sites converted: Explore, hero "Every moment...", "Create", PorizoScreenHeader(title) [drives all main headers]. Verifying (bg brqf1l5hm).
- Bugs hit + fixed: Int64(bitPattern:) unresolved in Kotlin; Color(ULong) wrong packing; DesignTokens unresolved in #if SKIP Color compare. Also: Gradle assemble can FAIL while skip export exits 0 → ALWAYS grep BUILD FAILED before install.

## I2 SF Symbols — RESOLVED (verified 2026-07-02)

VERIFIED FIXED: forced-rendered all 5 tabs, logcat shows ZERO "Unable to find system image" warnings. Every SF symbol our app uses is in Skip's ~65-name composeSymbolName→Material table. Claim screen shows coral heart + coral share icons (were triangles on the FIRST build only — a stale-build artifact, gone after rebuilds). Not claiming the auth/subscription SHEETS (not opened), but their symbols (envelope/checkmark.circle/person/lock/bell/cart) are all in the known table.
Mechanism (for reference): Skip maps SF→Material via composeSymbolName (Image.kt:762); unmapped → ⚠️ Icons.Default.Warning (Image.kt:510); OR bundle an asset named after the symbol (Image.kt:503 checks Bundle.main first).

## Guardrails

- Do NOT commit/push unless asked. Skip does not read iOS asset catalogs — port resolved hex, both appearances.
- I2 (SF Symbols) is next loop: per-symbol Android vector/glyph mapping.
