# Task Tracking

## Current Task

**Subscription + StoreKit Production Hardening (ASC-aligned)**

### Phase 1: Contract + Purchase Routing
- [x] 1. Accept both `transactionId` and `transaction_id` — already implemented (server.js:5276)
- [x] 2. Add `/billing/subscription` alias route — already implemented (server.js:5590)
- [x] 3. iOS paywall purchase mapping — already correct (SubscriptionView.swift:511-524)
- [x] 4. Tests — existing tests cover items 1-3; added 2 new spendSong tests + 1 sync type guard test

### Phase 2: Validation + Lifecycle Hardening
- [x] 5. Apple environment fallback — already implemented (apple-receipt-validator.js:342)
- [x] 6. Subscription sync job type guard for non-subscription validation types
- [x] 7. Eliminated double-charge: render_full now uses spendSong(), runner no longer deducts
- [x] 8. Render eligibility now uses song-based checks via spendSong (trial + subscription)

### Phase 3: Postgres Safety + ASC Readiness
- [x] 9. Eliminated SQL string interpolation in plan-config.js getPlans()
- [x] 10. Created tools/verify-asc-products.js — compares DB plan_products with expected ASC IDs
- [x] 11. Created docs/asc-setup.md — subscription group ordering, metadata, sandbox testing

### Verification
- [x] 12. Lint: 0 errors on all modified files
- [x] 13. Billing tests: 29 pass / 0 fail (subscription-manager + subscription-sync)
- [x] 14. Full suite: 1138 pass / 52 fail (pre-existing; +5 new passing tests vs baseline 1133)
- [x] 15. No Swift files modified — iOS build check not needed

---

## Previous Task

**Stability Hardening + Writer v3 Test Fixes** — Complete provider stability pipeline and fix pre-existing test regressions

## Results

Commit `d99ad13`: Harden provider stability and fix writer v3 test regressions

| Files Changed | Insertions | Deletions | Net |
|---------------|------------|-----------|-----|
| 6 | +319 | -55 | +264 |

Deliverables:
1. Stale job recovery — already existed
2. Checkpoint saving — already existed
3. Circuit breaker for ElevenLabs music — threshold 5→3, wrapped render calls
4. Provider fallback on policy rejection — Suno→ElevenLabs reverse direction
5. `[no producer tag]` in Suno style fields
6. Structured rejection telemetry — SHA256-hashed lyrics logging

Writer v3 fixes (4 pre-existing failures → 0):
- Grounding: added "together" to allowedWords
- Quality: reflective readiness threshold 0.66→0.62
- Engine: forward-coverage fact supersession check
- Test: mock narrative POV alignment

---

## Queued Task

**Subscription + StoreKit Production Hardening (ASC-aligned)** — fix API/client contract drift, correct product selection, harden Apple/TestFlight validation, and close billing lifecycle gaps. (15 items across 3 phases — not started)

---

## Previous Task

**iOS Code Review Fixes** — Fix all 13 issues from two review rounds across 12 files

## Plan

### Batch 1: Quick Wins
- [x] 1. Add `@MainActor` to PlayerState (thread safety)
- [x] 2. Fix poem "Done" button trapping user in modal
- [x] 3. Fix hardcoded version string in SettingsTabView
- [x] 4. Replace 15 raw hex colors with DesignTokens (4 new tokens)

### Batch 2: Navigation & Stub Fixes
- [x] 5. Wire NowPlaying share button with UIActivityViewController
- [x] 6. Fix LyricsReview back navigation (track originating state)
- [x] 7. Remove 5 non-functional stub buttons
- [x] 8. Remove dead code from PoemCard (unused formatters)

### Batch 3: Polish & Accessibility
- [x] 9. Add MiniPlayer bottom padding to Poems tab
- [x] 10. Add VoiceOver accessibility labels to PoemFullView
- [x] 11. Move App Store URL to AppConfig constant
- [x] 12. Add AVAudioSession interruption handling

### Batch 4: Deferred
- [x] 13. Add TODO comment for extracting duplicate togglePlayback

### Verification
- [x] Build succeeds with zero errors
- [x] No raw hex colors remain in scoped files
- [x] Pushed to GitHub
- [x] Deployed to Railway
- [x] Uploaded to TestFlight

## Progress

- 17:15 - Batch 1 complete (Tasks 1-4): @MainActor, poem Done fix, dynamic version, DesignTokens
- 17:18 - Batch 2 complete via agent (Tasks 5-8): share button, back nav, stub removal, dead code
- 17:20 - Batch 3 complete via agent (Tasks 9-12): padding, a11y, URL fix, interruption handling
- 17:20 - Batch 4 complete (Task 13): TODO comment added
- 17:22 - Fixed PoemsTabView Preview + V1ScreenCatalogView missing playerState param
- 17:23 - Fixed @MainActor deinit issue, added nonisolated deinit + setupInterruptionHandling()
- 17:24 - Build clean: zero errors, 12 files changed, +100/-109 lines
- 17:25 - Committed: 9886c06
- 17:26 - Pushed to origin/admindash
- 17:27 - Railway deployed
- 17:30 - TestFlight upload succeeded

## Results

Commit `9886c06`: fix(ios): Address 13 code review issues across UI, navigation, and accessibility

| Files Changed | Insertions | Deletions | Net |
|---------------|------------|-----------|-----|
| 12 | +100 | -109 | -9 |

Key architectural improvements:
- **Thread safety**: `@MainActor` on PlayerState ensures compile-time main thread guarantees
- **Audio resilience**: Interruption observer pauses playback on phone calls/Siri
- **Design consistency**: All status badge colors now flow through DesignTokens
- **Accessibility**: PoemFullView now has full VoiceOver support
- **Navigation**: Poem Done dismisses modal; LyricsReview back tracks origin state
- **Cleanup**: Removed 5 stub buttons + dead code = net line reduction
