# Task Tracking

## Current Task

**Subscription + StoreKit Production Hardening (ASC-aligned)** — fix API/client contract drift, correct product selection, harden Apple/TestFlight validation, and close billing lifecycle gaps.

## Plan

### Phase 1: Contract + Purchase Routing
- [ ] 1. Make Apple receipt endpoint accept both `transactionId` and `transaction_id`.
- [ ] 2. Add `/billing/subscription` alias route pointing to `/billing/subscription-status`.
- [ ] 3. Fix iOS paywall purchase mapping to use selected tier + billing period (not hardcoded Pro).
- [ ] 4. Add/update tests for payload compatibility + endpoint alias + tier product mapping.

### Phase 2: Validation + Lifecycle Hardening
- [ ] 5. Implement Apple environment fallback logic (production <-> sandbox) for transaction lookup.
- [ ] 6. Fix subscription sync job contract mismatch with validator output.
- [ ] 7. Remove double-charge path between render reservation and `spendSong` completion charge.
- [ ] 8. Update render eligibility to song-based entitlement checks (including trial songs).

### Phase 3: Postgres Safety + ASC Readiness
- [ ] 9. Eliminate risky SQL placeholder usage in billing services under Postgres paths.
- [ ] 10. Add a script/check that compares backend `plan_products` with expected ASC product IDs.
- [ ] 11. Document ASC setup/verification steps for subscription group ordering + metadata completeness.

### Verification
- [ ] 12. Run lint.
- [ ] 13. Run billing/subscription-focused tests.
- [ ] 14. Run full `npm test`.
- [ ] 15. Run relevant iOS build check for touched Swift files.

## Progress

- [ ] (2026-02-09) Started execution plan and repo triage.

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
