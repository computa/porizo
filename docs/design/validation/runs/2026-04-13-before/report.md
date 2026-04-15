# Baseline Report: 2026-04-13 (Before)

**Run date:** 2026-04-13
**Build:** v1.5.4 (93)
**Device:** iPhone 16 Pro simulator (iOS 18.6)
**Launch mode:** `--bypass-auth` + fixture args
**Branch:** version3
**Note:** This is a frozen historical snapshot. Some violations (V4, V5a, V5b, V6) were fixed during the same session after baseline capture.

---

## Scenarios Executed

### S3 — Wait and Create Chrome Hygiene

| Check | Status | Evidence |
|-------|--------|----------|
| Wait subtitle says "90 seconds" | **FAIL** | `02-wait-pulse.jpg` — Shows "Usually under 2 minutes" |
| Explore has no placeholder buttons | **FAIL** | `01-explore-home.jpg` — `explore-search-button` and `explore-notifications-button` present with "Coming soon" hint |
| Creating card has no % text | **NOT TESTED** | Requires live render state — gallery Wait screen doesn't show InlineCreatingCard |

**Accessibility evidence:**
- `explore-search-button` found with `help: "Coming soon"` — confirms V5a violation
- `explore-notifications-button` found with `help: "Coming soon"` — confirms V5a violation
- `wait-subtitle-text` not verifiable via gallery (gallery uses static mock, not real WaitPulseView)

### S1 — Pre-auth Create Carry-Through (Partial)

| Check | Status | Evidence |
|-------|--------|----------|
| Onboarding secondary CTA says "Get started" | **NOT TESTED** | Gallery onboarding is a static mock, not real `OnboardingView`. Real test requires fresh app state without bypass-auth. |
| Name entry → auth → create preserves data | **NOT TESTED** | Requires non-bypass-auth flow with real auth transition |

**Note:** S1 cannot be validated with `--bypass-auth` because it skips onboarding and auth entirely. Full S1 validation requires either:
- A fresh app install (reset simulator) without bypass-auth
- A deterministic local auth fixture

### S2 — Reveal and Share Readiness (Visual only)

| Check | Status | Evidence |
|-------|--------|----------|
| Reveal screen captured | **BASELINE** | `03-reveal-bloom.jpg` |
| Share screen captured | **BASELINE** | `04-share-postcard.jpg` |
| Share pre-generated before tap | **NOT TESTED** | Requires live render completion |
| Reveal actions don't eject | **NOT TESTED** | Gallery reveal buttons are non-functional mocks |

---

## Captured Artifacts

### iOS Screenshots

| File | Screen | Notes |
|------|--------|-------|
| `ios/01-explore-home.jpg` | Explore tab | Shows placeholder search + notification buttons |
| `ios/02-wait-pulse.jpg` | Wait (gallery) | Shows "Usually under 2 minutes" — V4 violation |
| `ios/03-reveal-bloom.jpg` | Reveal (gallery) | Visual baseline for reveal design |
| `ios/04-share-postcard.jpg` | Share (gallery) | Visual baseline for share design |
| `ios/05-onboarding.jpg` | Onboarding (gallery) | Gallery mock — not real OnboardingView |
| `ios/06-name-entry.jpg` | Name Entry (gallery) | Visual baseline for name entry |
| `ios/07-profile-completion.jpg` | Profile Completion (gallery) | Shows "Send verification code" button (fix from this session) |
| `ios/08-fixture-reveal.jpg` | Reveal (LIVE fixture) | `--fixture-reveal` — full Reveal Bloom with mock Sarah/Birthday data |
| `ios/09-fixture-creating.jpg` | Wait/Creating (LIVE fixture) | `--fixture-creating` — Wait Pulse with "Ready in about 90 seconds" |
| `ios/10-fixture-onboarding-reset.jpg` | Onboarding (LIVE fixture) | `--reset-onboarding` — fresh onboarding page 1 |

### Accessibility Snapshots

Explore tab snapshot captured inline during run. Key findings:
- `explore-search-button` present (should be removed)
- `explore-notifications-button` present (should be removed)

---

## Blocked / Not Tested

| Scenario | Reason | What's needed |
|----------|--------|---------------|
| S1 full flow | `--bypass-auth` skips onboarding + auth | Fresh simulator reset or local auth fixture |
| S2 behavioral | Needs live render completion | Backend fixture or mock render callback |
| S3 creating % | Needs live creating state | Backend fixture or direct InlineCreatingCard state |
| S4 web player | Needs local server + share fixture | `npm run dev` + seeded share token |
| S5 web-to-app | Manual only | Real device + TestFlight |
| S6 post-claim | Needs share fixture + claim flow | Backend + dual-surface test |
| S7 share copy | Needs completed song | Full render pipeline |
| S8 gift policy | Needs feature flag toggle | Backend fixture |

---

## Violation Status (from this run + same-session fixes)

| Violation | Baseline Status | Current Status | Evidence |
|-----------|----------------|----------------|----------|
| V4 — Wait copy | CONFIRMED ("2 minutes") | **FIXED** ("Ready in about 90 seconds") | `09-fixture-creating.jpg` |
| V5a — Placeholder buttons | CONFIRMED (search/notifications present) | **FIXED** (buttons removed) | User removed them from ExploreTabView |
| V5b — Progress % | CONFIRMED (% visible) | **FIXED** (% removed) | User removed from InlineCreatingCard |
| V6 — Onboarding label | CONFIRMED ("Sign in") | **FIXED** ("Get started") | `10-fixture-onboarding-reset.jpg` |
| V1 — Pre-auth carry-through | UNVERIFIED | **ALREADY WIRED** (code audit) | Needs live S1 test to confirm |
| V2 — Share pre-generation | UNVERIFIED | **OPEN** | Needs live render |
| V3 — Reveal ejects to Songs | UNVERIFIED | **OPEN** | Needs live reveal flow |

---

## Next Steps

1. **Add fixture generation** — Backend seed route or script to create known share states
2. **Test S1 without bypass-auth** — Reset simulator, run through real onboarding + auth
3. **Test S4 web player** — Start local server, create share, open in browser
4. **After V4/V5 fixes** — Re-run this exact flow and compare screenshots
