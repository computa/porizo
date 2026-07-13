# App Store Review Audit — 2026-07-14

**Scope:** TestFlight (internal testing) uploads of builds **1.5.27 (151)**, **(152)**, and **(153)** from `main`.
**Context:** Delta over build 150 (magic-link login state race + review-prompt policy refactor); build 152 adds one recovery-UI change. Backend magic-link account-takeover fix (`b81df270`) deployed to Railway prod and live-verified (build-151 on-device test confirmed the recovery flow: exchange → 409 → Apple recovery → session). This is an INTERNAL TestFlight build — NOT an App Store submission and NOT external TestFlight review.

## Build 152 additional delta (`605fbc75..9d683662`)

| Commit     | Change                                                                                                                                                                                                                                                            | Review surface                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `6a38244e` | fix(ios): legacy-recovery screen hides "Continue with phone" unless the account has no Apple factor (phone is legacy-recovery-only, not a registration method; 3 phone-only accounts in prod keep access). `.contains(where:)`→`.allSatisfy` on support fallback. | None — recovery-UI visibility logic; builds clean |
| `9d683662` | chore: build 151 → 152                                                                                                                                                                                                                                            | None                                              |

## Build 153 additional delta (`9d683662..277f73d8`)

Both fixes traced from prod logs of the build-152 on-device test (two-tap sign-in + email-screen flash). No new capabilities, entitlements, or metadata.

| Commit     | Change                                                                                                                                                                                                                                                                                                                   | Review surface                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `919fbe46` | fix(ios): (a) `handleMagicLoginURL` no longer lets an in-flight status poll short-circuit the exchange → first tap reliably signs in; (b) `AuthView` shows a progress placeholder while a magic flow resolves (`isMagicFlowResolving`) instead of flashing the email-entry screen. AuthManagerTests green; builds clean. | None — auth-flow state/UX timing |
| `277f73d8` | chore: build 152 → 153                                                                                                                                                                                                                                                                                                   | None                             |

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
