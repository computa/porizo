# App Store Review Audit — 2026-04-16

**Build under review:** 96 (1.5.4) — uploaded 2026-04-15 17:42 PST, `processingState=VALID`
**App ID:** 6758205028 | **Version state:** `PREPARE_FOR_SUBMISSION` | **Xcode:** 26.3

## Verdict: NO-GO (ASC-side fixes only — binary is clean)

**2 BLOCKERS, 3 WARNINGS, 4 INFOs.** Build 96 binary itself is clean; the App Store Connect submission record is incomplete. No code changes required — all fixes are 5-minute ASC operations.

---

## Blockers (2)

| # | Category | Issue | Evidence | Fix |
|---|----------|-------|----------|-----|
| **B1** | L, N | No build attached to version 1.5.4 | `asc review doctor` → `build.required.missing (severity: error, blocking)`. Live-confirmed: version ID `c06316d6-fee4-495c-998f-5d0563ca0edf` has no build relationship | In ASC web: Version 1.5.4 → Build section → attach build 96. Or CLI: `asc versions attach-build --version-id c06316d6-fee4-495c-998f-5d0563ca0edf --build-id 574a32ce-5b3e-4f72-b709-85d6d60e473e` |
| **B2** | B, L | Duplicated paragraph + missing space in en-US description | Live description text: `"No musical talent needed. Just your words and a couple of minutes.Turn your most meaningful moments..."` — sentence runs into the next with no space, and the "Turn your most meaningful moments" paragraph appears twice | Rewrite the en-US description as one clean block. Update via `asc localizations update --id 5e0e1c17-e577-4682-a6f3-c46bb1d07451 --description "..."` |

## Warnings (3)

| # | Category | Issue | Fix |
|---|----------|-------|-----|
| W1 | L, N | "What's New" empty for en-US | Update via `asc localizations update --id 5e0e1c17-... --whats-new "..."` |
| W2 | E, L | Description still references Apple's stdeula URL though a custom Porizo EULA is configured in ASC | Remove "Terms of Use: https://www.apple.com/legal/..." line from description (custom EULA supersedes) |
| W3 | C | `NSPrivacyTracking=true` with tracking domains — Facebook (`graph.facebook.com`), Google (`app-measurement.com`, `googleads.g.doubleclick.net`), Apple Ads (`api-adservices.apple.com`). ATT must be requested BEFORE any tracking domain is contacted | Verify Facebook SDK is gated on `ATTrackingManager.trackingAuthorizationStatus` and does not fire any network requests before the user resolves the prompt |

## Info (4)

| # | Note |
|---|------|
| I1 | SIWA prominently placed first in auth flow — satisfies Guideline 4.8 |
| I2 | Subscription auto-renew disclosure + Restore Purchases button properly rendered in view body |
| I3 | Delete Account flow with two-step confirmation present |
| I4 | Age rating declares `userGeneratedContent: false` but user supplies free-form message → lyrics. Consider setting UGC=true to reduce reviewer pushback |

## Verified OK (16 checks — all green)

- No placeholder/TODO leak in Release
- Screenshots in ASC are `state=COMPLETE` (24 total across iPhone 6.5 + 6.7 + iPad)
- Privacy manifest: 11 data types + 3 API reasons declared correctly
- Binary has no IDFA/`ASIdentifierManager` symbols, no `AdSupport.framework` linkage
- Privacy policy discloses Firebase, ElevenLabs, Suno, Replicate
- Device ID claim ("keychain-stored UUID") matches `RootView.swift:816-835`
- 4/4 IAP consumables state=APPROVED
- Custom Porizo EULA configured (7KB, 2026-02-04 revision)
- All entitlements (applesignin, aps-environment=production, app-groups, associated-domains) match code
- AI vendors disclosed
- `npm run lint` → 0 errors
- Build 96 `processingState=VALID`
- Version 1.5.4 in `PREPARE_FOR_SUBMISSION`
- Legal URLs all 200
- Demo credentials + review notes set
- Contact info populated

## Pre-Submit Action List (ordered by rejection risk)

1. **[B1]** Attach build 96 to version 1.5.4 (ASC web or `asc versions attach-build`)
2. **[B2]** Fix duplicated paragraph in description
3. **[W1]** Set "What's New" copy (session changelog: SQL payment sync fix, animated share MP4, Launch Flash hardening, ~6.4K lines of dead code removed)
4. **[W2]** Remove Apple stdeula line from description
5. **[W3]** Smoke-test ATT prompt + FB SDK gating in Release
6. **[I4]** Reconsider UGC=false declaration

## Commits in this build (since 95)

- `def6d40` Fix onboarding entry and auth hardening (codex)
- `d38c106` Postgres SQL syntax fix
- `30a9e5d` Repo hygiene
- `f39f4c7` Animated share MP4 + AccountExistsView copy
- `49608e6` E2E TestFlight playbook
- `6c8a2a6` Migration 088 data safety
- `cf4a261` gitignore cleanup
- `e31f69f` CI + docs tracking
- `6243aad` Auth+Onboarding fixes
- `fafa471` Voice Enrollment fixes
- `5386d32` Song Creation fixes
- `90d0bd6` Playback+Library fixes
- `eb63053` Launch Flash fixes
- `98f333c` Build bump 93→96

## Sources

- [Apple App Store Rejection Guide 2026](https://www.openspaceservices.com/blog/apple-app-store-rejection-guide-2026-the-15-most-common-reasons-and-how-to-fix-each)
- [Top Reasons iOS Apps Get Rejected 2026](https://www.eitbiz.com/blog/top-reasons-ios-apps-get-rejected-by-the-app-store-and-fixes/)
- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

## Verdict

**NO-GO for submission until B1 + B2 resolved.** Both are 5-minute ASC web edits. Binary is GO; no re-archive needed.
