# App Store Review Audit — 2026-07-14

**Scope:** TestFlight (internal testing) upload of build **1.5.27 (151)** from `main`.
**Context:** Two-fix delta over build 150 (magic-link login state race + review-prompt policy refactor). Backend magic-link account-takeover fix (`b81df270`) deployed to Railway prod and live-verified. This is an INTERNAL TestFlight build for magic-login validation — NOT an App Store submission and NOT external TestFlight review.

## Verdict: GO (TestFlight internal)

Blockers: 0 · Warnings: 0

## Delta since last uploaded build (150 → 151, `ad5becb0..605fbc75`)

| Commit     | Change                                                                                                                                                                                                                                        | Review surface                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6d6df506` | fix(ios): magic-link tap state race — `performMagicLoginStatusRefresh` terminal-state guard (`isTerminalMagicState`, nonisolated), CheckEmailView reuses predicate; +2 regression tests, 1 stale test corrected to recovery-grace semantics   | None — internal auth flow bugfix                                                                                                                                                    |
| `7374fbff` | refactor(ios): review prompting — **removed** custom "Are you enjoying Porizo?" pre-prompt sheet; direct `SKStoreReviewController.requestReview(in:)` at verified success triggers under `ReviewPromptPolicy` (3/365d cap + min-days-between) | **Improves** compliance: custom rating-gate sheets are a known Guideline 1.1.7-adjacent risk; sanctioned API only (`ReviewManager.swift:110`), zero gating remnants (grep-verified) |
| `605fbc75` | chore: build 150 → 151 (6 pbxproj lines, `MARKETING_VERSION` unchanged at 1.5.27)                                                                                                                                                             | None                                                                                                                                                                                |

## Checks performed

| Category                                     | Result       | Evidence                                                                                                                                                            |
| -------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build integrity                              | ✅           | Device archive succeeded (`PorizoApp-151.xcarchive`, exit 0)                                                                                                        |
| Unit tests                                   | ✅           | `AuthManagerTests` 17/17 pass (incl. new race regression tests)                                                                                                     |
| Privacy manifest / Info.plist / entitlements | ✅ unchanged | `git diff --name-only ad5becb0..HEAD -- PorizoApp/` — no plist/entitlements/xcprivacy files in delta                                                                |
| App Store metadata                           | ✅ unchanged | No metadata files in delta; fastlane metadata edits remain uncommitted/not shipped                                                                                  |
| Review-prompt policy (G1.1.7/5.6.4 family)   | ✅ improved  | Sanctioned `SKStoreReviewController.requestReview(in:)` only; pre-prompt sheet deleted, no `reviewShouldShowPrePrompt`/"enjoying" remnants                          |
| Learned-rejections sweep                     | ✅ n/a       | No pattern in `~/.claude/appstore-review/learned-rejections.md` matches this delta (entitlements unchanged; no AI-consent surface touched; age-rating not affected) |
| Backend dependency                           | ✅ live      | Server fix `b81df270` deployed (`48236365` SUCCESS, commit hash verified) — client and server ship as a pair per the 2026-07-13 lesson                              |

## Out of scope (unchanged since prior audits)

Full 14-category sweep (screenshots, ASC config, EULA, IAP review screenshots, legal URLs) — no changes to any of those surfaces in this delta; last full-surface review 2026-06-30 (GO). Required before the next **App Store submission** or **external** TestFlight push.
