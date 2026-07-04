---
title: "feat: Android → iOS parity (pure-native Kotlin/Compose, Skip removed)"
type: feat
date: 2026-07-05
supersedes: docs/plans/2026-07-03-001-feat-android-ios-parity-plan.md
origin: docs/parity-2026-07/android-ios-parity-gaps.md
status: in-progress
depth: deep
execution: code
---

# feat: Android → iOS parity — pure-native Kotlin/Compose

**Target repo:** this repo. Android app lives in the worktree
`.worktrees/refactor-android/PorizoAndroid/Android/` (Gradle multi-module Kotlin +
Jetpack Compose). iOS reference is `PorizoApp/`; shared backend is `src/` (deployed at
`api.porizo.co`). All Android paths below are relative to
`.worktrees/refactor-android/PorizoAndroid/`.

---

## Why this plan supersedes the Skip plan

The prior plan (`2026-07-03-001`) delivered Android parity via **Skip Fuse**
(Swift→transpiled-Kotlin). That approach is **retired.** We are shipping **pure-native
Android** — Kotlin + Jetpack Compose in a standard multi-module Gradle app — and a pure
native iOS app, with **no Skip transpilation layer** on either side.

The parity **goal is unchanged**: the Android app must match the iOS app **feature for
feature, color for color, design for design, and flow for flow.** Same 4 tabs, same guided
create flow, real library + playback, real auth, deep-link claim, gift/billing, real
settings, onboarding, and Warm Canvas visual system.

### What carried forward from the Skip spike (not wasted)

The Skip spike's **pure decision-logic contracts and their test suites** were the durable
asset, and they have **already been ported to Kotlin** in `core:domain`:

| Skip Swift (retired)                              | Native Kotlin (kept)                          | Contract                                                                 |
| ------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `AuthLogic.swift` + `AuthLogicTests`              | `AuthLogicTest.kt`                            | token-refresh classification, phone-verify outcomes                      |
| `AndroidRenderController.swift` + tests           | `RenderControllerTest.kt`                     | backoff schedule, terminal statuses, resume-before-start, error taxonomy |
| `SongLibrary.swift` / `PoemLibrary.swift` + tests | `SongLibraryTest.kt` / `PoemLibraryTest.kt`   | status→badge map, My/Received filter, playable-track build               |
| `StoryEngine.swift` + tests                       | `StoryEngineTest.kt`                          | transcript building, finish-gating                                       |
| `OnboardingGraphEngine.swift` + tests             | `OnboardingGraphEngineTest.kt`                | node graph, template resolution, completion                              |
| `AndroidDeepLinkParser` + tests                   | `DeepLinkParserTest.kt`                       | scheme/host routing (incl. the poem-share host fix)                      |
| `ClaimLogic` / `PoemClaimLogic` + tests           | `ClaimLogicTest.kt` / `PoemClaimLogicTest.kt` | share-state map, device-token 401-retry, verse extraction                |
| `ShareLogic` / `AndroidPushRouting` + tests       | `ShareLogicTest.kt` (+ push routing)          | message copy (no expiry urgency), SMS-vs-sheet, push payload → route     |

These contracts are **exact iOS behavioral parity** distilled from `PorizoApp/` and verified
against the live backend during the Skip build-out. The native ViewModels wire to them; the
tests lock the behavior. **The native-icon/splash work also survives** — `mipmap-*`,
`Theme.Porizo`, and the manifest are standard Android resources, already correct for the
coral gift-box logo matching iOS (commit `5dcc9381`).

### What was discarded

The entire Skip mechanism: `#if SKIP` free funcs, `Sources/PorizoSkipSpike/Skip/*.kt`
native bridges, `@Observable`/SkipFuse bridging, and the transpile toolchain. The Skip
gotchas in `tasks/lessons.md` (#5–#8) are now historical — native Compose has its own
state model (`StateFlow`/`collectAsStateWithLifecycle`), not Skip's observation quirks.

---

## Native architecture (as built by the migration)

Standard Now-in-Android-style multi-module layout under `Android/`:

**Core modules**

- `core:model` — data classes (domain models, DTOs) — _ported from `AndroidAPIModels.swift`_
- `core:domain` — repository **contracts** + pure decision logic + **the ported test suites**
- `core:network` — Retrofit/Ktor client behind the domain contracts — _from `AndroidAPIClient.swift`_
- `core:datastore` — DataStore/Keychain-equivalent session + token storage
- `core:data` — repository **implementations** binding network+datastore to domain contracts
- `core:ui` — the **Warm Canvas** Compose design system (colors, type, components) — _design parity anchor_
- `core:media` — ExoPlayer playback engine (replaces the Skip ExoPlayer bridge)
- `core:share` — Android share sheet + SMS intent (replaces the Skip share bridge)
- `core:platform` — Google Sign-In (Credential Manager), push (OneSignal/FCM), recorder, billing

**Feature modules** (Compose screens + ViewModels)

- `feature:onboarding`, `feature:auth`, `feature:library` (songs+poems+player), `feature:create`, `feature:claim`

**App**

- `app` — `MainActivity`, `AppRoot`, `AppNavigationShell`, `PlayerViewModel`, Hilt/DI (`di/PorizoAppModule`), `AppDestination`

State model: **`ViewModel` + `StateFlow` UiState + `collectAsStateWithLifecycle`** (the native
idiom), replacing the Skip `@Observable`. Shared cross-screen state (player, create flow) is
an app-scoped or nav-scoped ViewModel.

---

## Parity is the bar: feature / color / design / flow

Non-negotiable acceptance criteria for every feature module — verified against iOS
(`PorizoApp/`) and the live app, not against the Skip spike:

- **Feature-for-feature:** every iOS screen, action, and state (loading/empty/error/loaded)
  has a native Compose equivalent. The gap register `docs/parity-2026-07/android-ios-parity-gaps.md`
  is the scope source of truth.
- **Color-for-color:** the **Warm Canvas** palette exactly — background `#FBF7F2`, coral
  `#E07850`, sage `#7B8F6B`, text `#2C2420`/`#6B6560`, per `PorizoApp/PorizoApp/CLAUDE.md`
  (the iOS style guide). `core:ui` holds these as the single source; no ad-hoc colors.
- **Design-for-design:** Fraunces display + SF-Pro/Roboto body, the same spacing scale
  (20px page padding, 12px card padding, 12/14/24px radii), card/chip/CTA/mini-player
  component shapes. Fraunces is bundled as a font resource (already present in `res/font`).
- **Flow-for-flow:** the same navigation graph and state machines — 4 tabs
  (Explore·Songs·Poems·Settings, **no Claim tab**), the guided create wizard
  (name→details→conversation→lyrics→render→reveal→share), deep-link-only claim, and the
  onboarding question graph.

---

## Backend + auth facts (unchanged, de-risked)

- **No backend work for auth or core flows.** `/auth/social` accepts `provider:"google"`;
  phone endpoints exist; tracks/jobs/share/receiver-handoff/poems/billing/enrollment are all
  live. Native `core:network` re-implements the `AndroidAPIClient` surface in Kotlin.
- **Android auth = phone-OTP + Google (Credential Manager)**, no Apple (iOS-only).
- **Share links are lifetime** — never ship expiry-urgency copy (project memory).
- **The one net-new backend dependency remains:** a **Google Play consumable-receipt
  validation endpoint** for gift-token purchases (only subscription validation exists). This
  gates the billing half of U9 (see Risks R-1).

---

## Implementation Units (aligned to the migration's actual sequencing)

Status reflects Codex's progress: **U1–U8 complete, U9 in progress (~78% by unit count).**
Each unit's parity target cites the iOS reference and the gap-register IDs it closes.

### U1. Native Android app shell ✅ DONE

Replace the Skip Gradle bootstrap with a native multi-module Android app: `app` +
`core:*`/`feature:*` module graph, Compose + Hilt, `MainActivity`/`AppRoot`.
**Parity:** app launches to the 4-tab shell; Warm Canvas theme scaffolding.
**Verify:** `gradle :app:assembleDebug` succeeds; app boots on emulator.

### U2. Shared model + domain contracts ✅ DONE

Port `core:model` (data classes from `AndroidAPIModels.swift`) and `core:domain`
(repository contracts + the pure decision-logic + **the ported JUnit test suites** listed
above). **Parity:** the 10 contract test files pass, locking iOS behavior.
**Verify:** `gradle :core:domain:testDebugUnitTest` green (10 suites).

### U3. Native data/network/session storage ✅ DONE

`core:network` (Retrofit/Ktor client = `AndroidAPIClient` surface: auth, tracks, jobs,
share, receiver-handoff, poems, billing, enrollment), `core:datastore` (session + token,
device-token lifecycle), `core:data` (repository impls binding the two behind domain
contracts). **Parity:** device-token single-retry-on-401, token-refresh classification.
**Verify:** repository/network unit tests; a live call to `api.porizo.co` resolves.

### U4. Compose design system + navigation shell ✅ DONE

`core:ui` Warm Canvas system (colors/type/components) + `app` navigation
(`AppNavigationShell`, `AppDestination`) — the 4-tab bottom bar, NavHost, mini-player slot.
**Parity — COLOR/DESIGN GATE:** the palette, Fraunces, spacing, and component shapes match
iOS exactly. **Verify:** side-by-side screenshots of each tab shell vs iOS.

### U5. Auth + onboarding ✅ DONE

`feature:auth` (phone-OTP + Google sign-in gate) + `feature:onboarding` (question graph,
`OnboardingGraphEngine`, completion persisted, recipient seed). **Closes:** X3 + auth gaps.
**Parity:** fresh-install→onboarding→tabs, relaunch skips; sign-in sheet.
**Verify:** emulator flow; `OnboardingGraphEngineTest` + `AuthLogicTest` green.

### U6. Library + poems + playback ✅ DONE

`feature:library` (Songs + Poems real libraries: My/Received filter, states, status badges)

- `core:media` ExoPlayer + app `PlayerViewModel` (persistent mini-player + NowPlaying).
  **Closes:** library + playback gaps. **Parity:** owned-Bearer vs shared-presigned streaming,
  mini-player persists across tabs. **Verify:** `SongLibraryTest`/`PoemLibraryTest`; play a
  track on emulator.

### U7. Share / claim / deep links ✅ DONE

`feature:claim` + `core:share`: deep-link claim **sheet** (track-share + receiver-handoff +
poem-share), device-token 401-retry, sign-in-to-claim, honest lifetime copy; share sheet +
one-tap SMS send. **Closes:** X1/X4/R1/R2/R3, share gaps. **Parity:** `porizo://`/https
routing (incl. poem-share host), no Claim tab. **Verify:** `ClaimLogicTest`/`PoemClaimLogicTest`/
`DeepLinkParserTest`/`ShareLogicTest`; fire a deep link on emulator → claim sheet.

### U8. Create / render / reveal ✅ DONE

`feature:create`: the guided wizard (`CreateViewModel`/`CreateUiState`/`CreateScreen`) —
name→details→AI conversation→lyrics review→render+poll→reveal→share, plus the poem branch
(synchronous `to-poem` → verses reveal). **Closes:** the create-path gaps (C-series).
**Parity:** the `RenderController` poll contract (backoff/terminal/resume/error-taxonomy);
voice chips (AI voices; My Voice "coming soon" per KTD7). **Verify:** `RenderControllerTest`/
`StoryEngineTest`; drive create→conversation on emulator against `api.porizo.co`.

### U9. Native platform services 🔄 IN PROGRESS

`core:platform`: **Google Sign-In** (Credential Manager → `/auth/social`), **push**
(OneSignal/FCM registration + notification-tap routing → track reveal), **billing** (Play
Billing: subscriptions now; **consumables gated on R-1 backend endpoint**), **voice
recorder** (enrollment capture — gated by KTD7, "My Voice" stays coming-soon until
product-ready). **Closes:** X6 (push), auth-Google, T2/T3 (billing), T8 (enrollment UI).
**Parity:** push payload → `.trackReveal` (Songs tab); Google button self-disables until a
Web Client ID is provisioned (external). **Verify:** `PushRouting`/billing unit tests;
Google sign-in against live `/auth/social`; delivery/purchase are device+dashboard-validated.
**Remaining in U9:** feature wiring (connect `core:platform` services into `feature:auth`/
`app` push routing/settings), not net-new logic.

### U10. Release identity, signing, icons, permissions, Play Store 🔲 TODO

App id, versioning, **signing config** (`keystore.properties`), launcher **icon + splash**
(already correct — coral gift-box, `Theme.Porizo`, commit `5dcc9381`), runtime permissions
(RECORD_AUDIO, POST_NOTIFICATIONS), `assetlinks.json` for App Links `autoVerify`, and Play
Console listing config. **Closes:** release readiness. **Parity:** icon/splash match iOS
(done); permissions match capability set. **Verify:** signed release APK/AAB builds;
App Links verify; internal-testing upload.

### U11. Skip removal + final parity audit 🔲 TODO

Delete `Sources/PorizoSkipSpike/` and all Skip Gradle/plugin artifacts; remove the Skip
toolchain from the build. Run a final **feature/color/design/flow audit** vs iOS across every
tab and flow (the parity gate), and reconcile the gap register to closed. **Closes:** cleanup

- the parity sign-off. **Verify:** no Skip references remain (`rg -i skip` clean of the
  transpiler); full unit-test suite green; side-by-side screenshot parity pass on all surfaces.

---

## Scope Boundaries

**In scope:** full native parity across the 4 tabs, create flow, playback, auth, claim,
gift, settings, onboarding — feature/color/design/flow.

### Gated / blocked (carry-over from the Skip plan; still true)

- **R-1 (blocks U9 billing consumables):** Android gift **consumable** purchases need a
  **new backend Google-consumable-receipt endpoint** — only subscription validation exists.
  Ship subscriptions-only first; defer consumables until the endpoint lands.
- **KTD7 (gates "My Voice"):** voice-cloning is not product-ready. The voice recorder /
  enrollment UI can be built, but "My Voice" stays disabled ("coming soon") until the product
  ships it. Never position on "your voice."
- **External (U9/U10):** Google OAuth **Web Client ID**, OneSignal/FCM dashboard, Play
  Console products, and signing keystore are provisioning steps outside the code — unit tests
  cover parse/route/registration; delivery/purchase/verify are device+console validated.

### Deferred to follow-up

- Lyric-synced highlight (iOS vocal-onset heuristic) — static lyrics ship; sync later.
- Lock-screen/media-session rich metadata parity.
- Full per-component dark-mode token audit beyond the primary palette.

### Outside this plan

- Backend changes beyond the one Google-consumable endpoint (R-1).
- iOS app changes (this is the Android-native parity track; iOS is the reference).

---

## Risks & Dependencies

- **R-1 (blocker, U9):** consumable-receipt backend endpoint — sequence before gift billing.
- **R-2 (external, U9/U10):** push delivery (OneSignal/FCM) + Play Billing products +
  App Links `assetlinks.json` + signing require console/keystore setup.
- **R-3 (parity fidelity):** native Compose removes the Skip render-divergence risk entirely
  — the color/design gate is now purely "does it match the Warm Canvas spec + iOS
  screenshots." Make U4 and U11 hard screenshot-parity gates.
- **R-4 (contract exactness — carried):** render-poll state machine, 422-is-not-error,
  device-token retry, token-refresh classification remain exact-contract items — the ported
  `core:domain` tests are the guard; keep them green through every ViewModel wiring.

---

## Phased Delivery

- **P0 (usable app):** U1–U8 — ✅ **complete.** A native Android app that creates a song
  end-to-end, plays it, signs in, shows the real library, deep-link-claims, with the 4
  correct tabs and Warm Canvas design.
- **P1 (launch-ready):** U9 (platform services) + U10 (release config). Exit: Google sign-in,
  push tap routing, subscriptions, signed release, App Links. (Consumables gated on R-1.)
- **P2 (closeout):** U11 — Skip removal + full parity audit sign-off.

---

## Sources & Reference

- **Parity scope:** `docs/parity-2026-07/android-ios-parity-gaps.md` (gap register, both apps
  running live).
- **iOS contracts (behavioral parity source):** `PorizoApp/PorizoApp/` — `Controllers/RenderController.swift`,
  `AuthManager.swift`, `Services/AudioPlayerService.swift`, `Flows/*`, `Onboarding/*`,
  `Util/RecipientMessage.swift`, `Services/PushPayloadParser.swift`; backend `src/routes/*`.
- **iOS design spec (color/design parity source):** `PorizoApp/PorizoApp/CLAUDE.md` (Warm
  Canvas v2.0 — palette, type scale, spacing, component patterns).
- **Ported contract tests (kept from Skip):** `Android/core/domain/src/test/kotlin/**` — the
  10 suites that lock iOS behavior; originally authored as the Skip Swift test suites this
  session (commits `1c10eb2d`…`a0a92c1a`).
- **Superseded plan:** `docs/plans/2026-07-03-001-feat-android-ios-parity-plan.md` (Skip Fuse
  approach — retired; kept for unit-level parity detail and the gap-ID → unit mapping).
