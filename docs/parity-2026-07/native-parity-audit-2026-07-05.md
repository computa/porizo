# Native Android → iOS parity audit (2026-07-05)

**The U11 gate.** Live side-by-side audit of the **pure-native** Android app vs the iOS
reference (`PorizoApp`), feature/color/design/flow, per the native parity plan
(`docs/plans/2026-07-05-001-...`). This is the pass that turns `◑ PARITY-PENDING` into `DONE`.

> **UPDATE 2026-07-05 (commit `dade4452`) — all three P1 gaps CLOSED + verified.**
>
> - ✅ **Settings** rebuilt to the iOS consumer layout (Your Voice banner, Account/
>   Preferences/Support/Legal groups); dev controls gated behind `BuildConfig.DEBUG`.
> - ✅ **Create entry** now a full-screen modal (× close, tab bar hidden) with
>   "Choose from Contacts" one-tap-send + "Just type a name instead" fallback.
> - ✅ **Explore gift CTA** "Schedule and send, for them" added; plus P2 wins (CTA
>   subtitle, occasion-chip emoji).
>   Re-verified side-by-side on the emulator.
>
> **UPDATE 2026-07-05 (commit `f63c185a`) — dark-mode audit PASS + loaded-chrome unblocked.**
>
> - ✅ **Dark mode audit: PASS.** Flipped the emulator to dark and re-shot Explore +
>   Settings. `PorizoDarkPalette` (warm dark `#1A1614`, brightened coral, cream text)
>   is a faithful Warm Canvas dark theme; all P1 fixes render cleanly with good
>   contrast in both themes. No dark-mode deltas found.
> - ✅ **Debug bypass-auth added** (`--ez bypass_auth true`, DEBUG-only). With it, the
>   authed **Songs** layout is now auditable and shows the **"My Songs / Received"
>   segmented filter + empty-state card — matching iOS**. (The earlier "My Songs vs
>   Songs title" note was an auth-state artifact: signed-out shows a gate; signed-in
>   shows "Songs" + a "My Songs" segment.)
>
> **Remaining for full U11 sign-off (NOT code):** loaded-_data_ audit needs a real
> backend session/token (the bypass flips chrome only — list DATA shows "Missing
> authorization token"); + external provisioning (Google Web Client ID, OneSignal/
> FCM, Play products, signing keystore — R-2) and the R-1 consumable endpoint.

## Method

- **Android:** native `com.porizo.app` (`gradle :app:assembleDebug` ✅ SUCCEEDED — no Skip),
  installed on emulator `Porizo_GateA_API36`. Signed-out (no bypass-auth on Android).
- **iOS:** `PorizoApp` (`xcodebuild` ✅ BUILD SUCCEEDED), on sim `iPhone 17 Pro`, launched
  `--bypass-auth` (proceeds as authed → shows loaded/loading states).
- Screenshots in `docs/parity-2026-07/native-audit-shots/`.

**Harness caveat:** iOS is bypass-auth'd (authed states) and Android is signed-out (gated
states), so some deltas below are _auth-state_ differences, not parity bugs — flagged as
`[auth-state]`. The color/design/copy deltas are real regardless of auth.

---

## Headline result

**The native rebuild is real and structurally strong.** All 4 tabs render genuine Warm
Canvas Compose screens (Fraunces titles, coral `#E07850` accents, correct card/chip shapes),
the 4-tab bar is correct with **no Claim tab**, and the create flow, library gates, and
splash/icon all match the iOS brand. This is **not** a stub — it is a near-complete native
app. **But it is not yet at pixel/flow parity:** there are a handful of real feature, copy,
and design gaps — most notably the **Settings screen** (a dev control panel, not the iOS
consumer settings) and the **create-flow entry** (in-tab + type-only vs iOS modal +
Contacts-first). None are architectural; all are finishing work.

**Verdict:** `◑ PARITY-PENDING` → **mostly parity, with a ranked punch-list below.** Not a
clean pass yet; Settings (P1) and create-entry (P1) must close before sign-off.

---

## Per-tab findings

### Explore / Home — ◑ close, 3 deltas

`ios-explore.png` vs `android-explore.png`

| Element                                                                       | iOS                                                          | Android                                           | Verdict                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------- |
| "Explore" title (Fraunces), hero card + waveform, "Create something personal" | ✓                                                            | ✓                                                 | ✅                                        |
| Primary CTA "Create for someone special"                                      | ✦ icon · **subtitle "Ready in about 90 seconds"**            | ♪ icon · **no subtitle**                          | ⚠️ P2 — add subtitle; align icon          |
| **"Schedule and send, for them"** gift CTA (2nd coral button)                 | ✓                                                            | **❌ missing**                                    | 🔴 **P1 — gift entry absent**             |
| "Create for an Occasion" chips                                                | **emoji** (🎂/💐/💑) · {Birthday, Mother's Day, Anniversary} | **no emoji** · {Birthday, Anniversary, Thank You} | ⚠️ P2 — add emoji; reconcile occasion set |
| "Your first song is free" card                                                | "…in under 90 seconds" (no button)                           | different copy + extra **"See all songs"** button | ⚠️ P2 — copy + stray button               |
| Tab bar (no Claim)                                                            | ✓                                                            | ✓                                                 | ✅                                        |

### Songs — ◑ title delta (+auth-state)

`android-songs.png`

- iOS title **"My Songs"**; Android **"Songs"** → ⚠️ **P2 title mismatch.**
- Android adds a subtitle ("Songs you make or receive stay app-bound…") iOS lacks → ⚠️ P2.
- iOS shows loading skeleton cards; Android shows a "Sign in to see your songs" gate →
  `[auth-state]` (both are valid states; can't compare loaded lists without an Android session).

### Poems — ◑ title delta (+auth-state)

`android-poems.png`

- iOS **"My Poems"**; Android **"Poems"** → ⚠️ **P2 title mismatch** (same pattern as Songs).
- Android subtitle + sign-in gate vs iOS skeletons → `[auth-state]`.

### Settings — 🔴 the biggest gap

`android-settings.png` vs the iOS Settings screenshot

- **iOS** = a polished consumer Settings: **"Your Voice" coral banner** (Set Up), **ACCOUNT**
  (Sign In / My Subscription·"Upgrade now" / Gift Bag·"Buy tokens"), **PREFERENCES**
  (Appearance / Lyrics Style / Language / Launch Flash), **SUPPORT** (Help Center / Get
  Support), and (below) Legal / Danger.
- **Android** = a **developer control panel**: Account (Signed out / Sign in), Subscription
  (**"Load billing" / "Open purchase sheet" / "Refresh purchases" / "Sync receipt" /
  "Billing not loaded."**), Notifications (**"Enable push" / "Disable push"**).
- 🔴 **P1 — Settings is not designed to iOS parity.** Missing: Your Voice banner, the grouped
  Preferences/Support/Legal/Danger sections, the row design, and the consumer framing. It also
  **leaks dev-only controls** ("Load billing", "Sync receipt", raw push toggles) that must be
  `#if DEBUG`-gated or removed. This is the `core:platform` service test-bench standing in for
  the real Settings screen (plan unit corresponds to iOS `SettingsTabView`).

### Create flow entry — 🔴 flow + feature delta

`android-create-entry.png` vs the iOS create modal

- **iOS:** a **full-screen modal** (× to close) — "Who's this song for?", **"⨭ Choose from
  Contacts"** CTA ("We'll text them the song in one tap…") + "Just type a name instead".
  Contact-first, one-tap-send framing.
- **Android:** an **in-tab screen** ("Create" + RECIPIENT section), "Who is this for?", a plain
  **"Recipient name"** field + Continue. Type-only.
- 🔴 **P1 — missing "Choose from Contacts" + one-tap-send**, and the flow is in-tab rather than
  a modal. Copy differs ("Who's this song for?" vs "Who is this for?"). (Note: the deeper
  wizard steps — details → conversation → lyrics → render → reveal → share — exist natively
  per U8 and were not driven here because they need a signed-in Android session; audit those
  once auth is available on the Android harness.)

---

## Not yet audited (needs an Android session or specific triggers)

These native units are BUILT but couldn't be visually compared in this pass (Android
signed-out; iOS bypass-auth doesn't reach them either):

- Loaded Songs/Poems lists (cards, badges, filter), NowPlaying + mini-player.
- The full create wizard past the entry (details/conversation/lyrics/render/reveal/share).
- Deep-link claim sheets (share / receiver-handoff / poem-share) — logic tested, UI not shot.
- Auth sheet + onboarding graph screens.
- Dark mode (iOS Settings shows an Appearance toggle; not exercised).

**Recommendation:** provision a test phone-auth session on the Android harness (or a
`--bypass-auth` equivalent) to complete the loaded-state visual audit before U11 sign-off.

---

## Ranked punch-list (close before parity sign-off)

**P1 (blocks parity sign-off):**

1. **Settings screen** — rebuild to iOS parity (Your Voice banner; Account/Preferences/Support/
   Legal/Danger groups; consumer row design) and **gate/remove dev controls** (Load billing,
   Sync receipt, raw push). Ref: iOS `SettingsTabView`.
2. **Create entry** — add **"Choose from Contacts" + one-tap-send** framing; present as a
   **modal**; align copy to "Who's this song for?".
3. **Explore "Schedule and send, for them"** gift CTA — add the missing second coral button.

**P2 (polish):** 4. Library titles → **"My Songs" / "My Poems"**; drop the extra Android subtitles. 5. Occasion chips → add **emoji**; reconcile the occasion set (Mother's Day vs Thank You). 6. Explore primary CTA → add **"Ready in about 90 seconds"** subtitle; align the leading icon. 7. "Your first song is free" card → match iOS copy; remove the stray "See all songs" button.

**Deferred / external:**

- Loaded-state + dark-mode visual audit (needs Android session).
- Google Web Client ID, push/billing provisioning (R-2), R-1 consumable endpoint.

---

## Gap-register reconciliation

Against `docs/parity-2026-07/android-ios-parity-gaps.md`:

- **Closed (verified live):** the 4-tab structure incl. Claim-tab removal (X1), Warm Canvas
  palette/type on the shells (color/design gate for Explore/Home ✅), the create-entry and
  library screens exist natively (not stubs), splash/icon brand match.
- **Still open (this audit's punch-list):** Settings parity (T-series), create Contacts/
  one-tap-send + modal presentation (E-series), Explore gift CTA (E3), library titles/chip
  emoji/copy (P6/E5 polish).
- **Not yet re-verifiable:** loaded library, full create wizard, claim sheets, onboarding/auth
  screens, dark mode — pending an Android authed session.

**Bottom line:** the native app is **~85% parity by surface** — structurally done, brand-correct,
no Skip — with a **short, concrete P1 punch-list (Settings, create-entry, gift CTA)** plus P2
polish standing between it and a clean U11 sign-off. The deeper flows need an authed Android
harness to finish auditing.
