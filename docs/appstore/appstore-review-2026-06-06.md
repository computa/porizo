# App Store Review Audit — 2026-06-06

**Target:** TestFlight upload of **1.5.15 (build 133)**. Last App Store-approved/live: **1.5.14 (READY_FOR_SALE)**.
**Baseline:** 2026-06-05 audit (build 131) — verdict GO / 0 blockers. This pass focuses on the **DELTA**: the unified paywall (SubscriptionViewV2), permanent pay-per-song, and StoreKit hardening.
**Scope note:** TestFlight binary upload — no screenshots/metadata are submitted with the binary. ASC-side screenshot/EULA checks (Categories J/L/M/N) are deferred to the next App Store _version_ submission, exactly as in the baseline.

## Verdict: GO

The only binary changes since the GO baseline are the paywall unification, pay-per-song permanence, and StoreKit purchase hardening. All three are compliant: subscription disclosure + restore + Terms/Privacy + Manage Subscription are rendered; all product IDs are real and degrade gracefully on load failure; the consumable funds digital content with no external steering; and no new permissions/entitlements/privacy-manifest/encryption changes were introduced.

(Render quality gate and Anthropic Haiku model bump are server-side only — not in this binary.)

## Blockers (0)

_None._

## Category Checks (verified by reading the actual files this session)

| #   | Category                                                    | Result | Evidence                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Build / archive                                             | PASS   | `** ARCHIVE SUCCEEDED **` reported for 1.5.15 (133). `MARKETING_VERSION = 1.5.15`, `CURRENT_PROJECT_VERSION = 133` (pbxproj, consistent).                                                                                                                                                                                                                      |
| B   | Encryption export compliance                                | PASS   | `ITSAppUsesNonExemptEncryption = false`, `Info.plist:168-169`. Unchanged from baseline.                                                                                                                                                                                                                                                                        |
| C   | IAP — subscription disclosure (3.1.2)                       | PASS   | `SubscriptionViewV2.swift:572-611`. `subscriptionDisclosure` is rendered in the view body (`:83`). Disclosure text (`:609-611`) includes auto-renew + 24h-cancel + "charged to your Apple ID account" + "Manage subscriptions in Settings". Restore (`:580-586`), Terms (`:588`), Privacy (`:592`), Manage Subscription (`:596-604`) all present and rendered. |
| D   | IAP — price/period shown (3.1.1)                            | PASS   | Subscription cards show `displayPrice / month\|year` from real StoreKit product (`:459-475`); monthly/annual toggle (`:170-209`). Bundle rows show `product.displayPrice` (`:264, 331`). Hero shows real `product.displayPrice`. Hardcoded `$4.99/$7.99/$1.99` are DEBUG/`SimulatorFixtures`-guarded only — not shipped to reviewers.                          |
| E   | IAP — product IDs real & graceful (2.1)                     | PASS   | `ProductID` enum (`StoreKitManager:16-24`) declares plus/pro monthly+annual + gift_bundle_1/3/5. Load failure: `loadProducts` catches/logs (`:377-380`); `bundlesSection` renders nothing when empty; hero renders nothing when no price; `purchasePlan` shows an Error alert instead of a dead button. No crashes / dead buttons.                             |
| F   | IAP — consumable funds digital content, no steering (3.1.1) | PASS   | `gift_bundle_1/3/5` route through `syncAppleGiftConsumable` crediting gift-wallet tokens that fund the user's own songs. All purchases via `product.purchase()`. No external-purchase/web-checkout steering (grep clean). Copy "yours to keep. No subscription" — accurate.                                                                                    |
| G   | StoreKit hardening (no new risk)                            | PASS   | `purchase()` single chokepoint `guard !purchaseState.blocksRepeatPurchase` (`:394`); `.success` handler resets shared state after dismiss (`:541-554`). Transaction sync finishes only after backend confirmation (C6); dedup via `processedTransactionIds` (C11).                                                                                             |
| H   | Deleted SubscriptionView.swift — clean removal              | PASS   | File absent; 0 stale references in Swift sources and pbxproj. `PBXFileSystemSynchronizedRootGroup` means V2 files build without explicit pbxproj entries — consistent with the successful archive.                                                                                                                                                             |
| I   | No new permissions / entitlements / privacy manifest        | PASS   | Diff over PrivacyInfo.xcprivacy, entitlements, Info.plist: only pbxproj changed (version bump). ATT + privacy manifest unchanged.                                                                                                                                                                                                                              |
| J   | Legal URLs                                                  | PASS   | `https://porizo.co/legal/terms` → 200, `https://porizo.co/legal/privacy` → 200 (node fetch).                                                                                                                                                                                                                                                                   |
| K   | Poem-context gating                                         | PASS   | Create flow passes `offerPayPerSong: resolvedSelectedType == .song` (`WarmCanvasFlowView:1053`) — pay-per-song hidden in poem contexts, falls back to subscription-first layout.                                                                                                                                                                               |

## Warnings (3 — non-blocking; deferred to the next App Store _version_ submission, carried over from baseline)

| #   | Category           | Issue                                                                                                                                                                   | Location                                                      | Fix                                                                                     |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Metadata / copy    | Voice over-promise copy ("songs that sound just like you" / "in your voice") still in production UI. Shipped in already-approved 1.5.14, so not a _new_ rejection risk. | `EmptyStateView.swift:45`, `DesignSampleView.swift:1008/1353` | Remove/soften before next App Store submission. See `project_no_voice_cloning_tech.md`. |
| 2   | Screenshots (iPad) | iPad App Store screenshots still show "In your own voice" pills. Not part of a TestFlight upload.                                                                       | ASC iPad screenshot set                                       | Re-render de-voiced + upload with next App Store version.                               |
| 3   | IAP / ASC hygiene  | Legacy consumable `com.porizo.gift_token_oneoff` ($2.99) still active in ASC but hidden in-app (excluded at `StoreKitManager:222`).                                     | ASC product list                                              | Deactivate in ASC to avoid an orphaned purchasable product.                             |

## Info (1)

| #   | Category     | Note                                                                                                     | Location                     |
| --- | ------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Code hygiene | `PayPerSongHeroView` header comment still references the deleted `SubscriptionView`. Stale comment only. | `PayPerSongHeroView.swift:5` |

## Quality Gates

| Gate                                               | Result | Details                                           |
| -------------------------------------------------- | ------ | ------------------------------------------------- |
| npm lint                                           | PASS   | ESLint: No issues found (0 errors / 0 warnings)   |
| Legal URLs (node fetch)                            | PASS   | terms 200, privacy 200                            |
| Xcode archive (Release)                            | PASS   | `** ARCHIVE SUCCEEDED **` for 1.5.15 (133)        |
| Privacy manifest / entitlements / Info.plist delta | PASS   | Unchanged vs baseline (only pbxproj version bump) |
| Encryption compliance                              | PASS   | `ITSAppUsesNonExemptEncryption = false` present   |

---

**Verdict: GO / Blockers: 0 / Warnings: 3** (all deferred to the next App Store version submission, none blocking this TestFlight binary upload).
