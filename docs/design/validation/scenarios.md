# Validation Scenarios

**Purpose:** Durable source of truth for all user-facing behavioral validation.
**Referenced by:** `yc-validation-harness-plan-2026-04-13.md`

---

## S1 · Pre-auth Create Carry-Through

**Covers:** V1 (pre-auth personalization broken), V6 (onboarding label mismatch)

**Goal:** User enters recipient context before auth, authenticates, and lands in a prefilled creation flow without re-entering data.

**Setup:**
- Fresh app state (delete app or reset UserDefaults)
- `--bypass-auth` NOT used (need real auth transition)
- Or: use deterministic local auth fixture

**Steps:**
1. Launch app → Onboarding appears
2. Navigate to last onboarding page
3. **Capture:** Screenshot of last page CTA label
4. **Assert:** Secondary CTA says "Get started" (not "Sign in")
5. Tap primary CTA → Name Entry screen
6. Type "Sarah" in recipient field
7. Select "Birthday" occasion chip
8. **Capture:** Screenshot of name entry with data
9. Tap Continue → Auth screen
10. Complete auth (Apple ID or phone)
11. App transitions to Main → auto-launches Create flow
12. **Capture:** Screenshot of create flow first screen
13. **Assert:** Recipient field shows "Sarah"
14. **Assert:** Occasion context shows "Birthday"

**Pass criteria:**
- [x] Onboarding secondary CTA label is "Get started"
- [x] After auth, create flow is entered without retyping
- [x] Recipient field shows "Sarah"
- [x] Occasion shows "Birthday"
- [x] User is not dropped at generic main state first

**Accessibility IDs referenced:**
- `onboarding-secondary-cta` (implemented)
- `name-entry-recipient-field` (implemented)
- `occasion-chip-{name}` e.g. `occasion-chip-birthday` (implemented)
- `create-flow-recipient-display` (implemented)

**Automation level:** iOS simulator (XcodeBuildMCP)

---

## S2 · Reveal and Share Readiness

**Covers:** V2 (share not pre-generated), V3 (reveal ejects to Songs)

**Goal:** When a song is ready, share is immediately available and reveal actions don't eject prematurely.

**Setup:**
- Authenticated user with a song in rendering
- Or: deterministic reveal-ready fixture (mock render completion)

**Steps:**
1. Enter a prepared reveal-ready song flow
2. Wait for reveal to appear
3. **Capture:** Accessibility snapshot of reveal screen
4. **Assert:** Share-ready state exists BEFORE user taps Share
5. Tap Share
6. **Capture:** Screenshot of share phase
7. **Assert:** No loading/polling toast (share link already available)
8. Go back to reveal
9. Tap "Save to Library"
10. **Capture:** Screenshot of resulting screen
11. **Assert:** Still in the flow (reveal/player/share state), NOT on Songs tab

**Pass criteria:**
- [x] Share link is pre-generated before user taps Share
- [x] First share interaction opens immediately (no polling delay)
- [x] Reveal persists until explicit exit
- [x] "Save to Library" / "Listen Fully" do not bounce to Songs tab

**Accessibility IDs referenced:**
- `reveal-share-button` (implemented)
- `reveal-save-button` (implemented)
- `reveal-listen-button` (implemented)
- `reveal-exit-button` (implemented)
- `share-link-ready-indicator` (implemented via `--fixture-reveal-ready` / validation-mode debug hook)

**Automation level:** iOS simulator — runnable via `--fixture-reveal-ready` without backend render completion

---

## S3 · Wait and Create Chrome Hygiene

**Covers:** V4 (wait copy), V5 (dead chrome + progress %)

**Goal:** Wait and create surfaces reinforce the brand promise and don't expose system scaffolding.

**Setup:**
- Bypass-auth is fine
- Use Warm Canvas Screens gallery for wait state
- Navigate to Explore tab for chrome check

**Steps:**
1. Navigate to Settings → Warm Canvas Screens → Wait
2. **Capture:** Screenshot of wait screen
3. **Assert:** Subtitle text contains "90 seconds" (not "2 minutes")
4. Go back → navigate to Explore tab
5. **Capture:** Accessibility snapshot of Explore header
6. **Assert:** No element with "Coming soon" help text
7. **Assert:** No element with magnifyingglass/bell that has TODO action
8. Navigate to a creating/generating state (gallery or live)
9. **Capture:** Screenshot of creating card
10. **Assert:** No `%` text visible in creating card

**Pass criteria:**
- [x] Wait copy says "90 seconds" (or equivalent)
- [x] Explore has no placeholder search/notification buttons
- [x] Creating state has no exposed progress percentage

**Accessibility IDs referenced:**
- `wait-subtitle-text` (implemented)
- `explore-search-button` (REMOVED — V5a fix deleted the buttons entirely)
- `explore-notifications-button` (REMOVED — V5a fix deleted the buttons entirely)
- `creating-progress-percent` (REMOVED — V5b fix deleted the % text entirely)

**Automation level:** iOS simulator (XcodeBuildMCP) — fully automatable via gallery + tab navigation

---

## S4 · Web Recipient Open

**Covers:** Distribution quality, share UX

**Goal:** A cold recipient gets emotional value in browser before being asked to install.

**Setup:**
- Local server running (`npm run dev`)
- Run `node scripts/seed-validation-fixtures.js` to create fixtures
- Use `unbound_share_web_allowed` share URL from output

**Steps:**
1. Open share URL in browser (`/play/{shareId}`)
2. **Capture:** Raw HTML response (OG meta tags)
3. **Assert:** `og:title` leads with recipient/sender context
4. **Assert:** `og:description` is emotionally specific
5. Wait for web player to load
6. **Capture:** Screenshot of initial load state
7. **Assert:** Recipient context is prominent (larger than product branding)
8. **Assert:** Sender context appears when the share carries sender metadata (gift flows)
9. Start playback
10. **Capture:** Screenshot during playback
11. Observe post-play state
12. **Capture:** Screenshot of CTA hierarchy
13. **Assert:** App CTA exists but is secondary to first value
14. **Assert:** "Make one for someone" viral CTA is present after first listen, not before it

**Pass criteria:**
- [x] OG metadata is emotionally specific (not generic product copy)
- [x] Browser page leads with recipient context, plus sender context when available
- [x] Playback is available without install
- [x] App CTA is present but not blocking first listen
- [x] Viral creation CTA exists

**Automation level:** Browser automation (Expect MCP or Chrome DevTools)

---

## S5 · Web to App Handoff

**Covers:** Distribution continuity

**Goal:** Installing the app after web listening preserves context.

**Setup:** Real device or TestFlight

**Steps:**
1. Open share link in mobile Safari
2. Listen to song in web
3. Tap install / app CTA
4. Install from TestFlight
5. Open app
6. **Assert:** App opens to claim/continuation flow for that specific song
7. **Assert:** User does not land on generic home

**Automation level:** MANUAL ONLY — requires real install cycle

---

## S6 · Post-Claim Browser Listening

**Covers:** Secondary virality

**Goal:** Claiming ownership must not destroy the public listening surface.

**Setup:**
- Run `node scripts/seed-validation-fixtures.js` to create fixtures
- Use `unbound_share_web_allowed` share URL and PIN from output
- Device that can claim

**Steps:**
1. Open share URL in browser → plays fine
2. **Capture:** Pre-claim browser screenshot
3. Claim the share in the app (PIN entry)
4. **Capture:** App claim screenshot
5. Reopen original share URL in browser
6. **Capture:** Post-claim browser screenshot
7. **Assert:** Browser still provides read-only listening

**Pass criteria:**
- [x] Pre-claim: browser plays audio
- [x] Post-claim: browser still plays audio (read-only)
- [x] Ownership is bound to device, but public listen survives

**Automation level:** Mixed — browser automation + iOS simulator

---

## S7 · Share Message Quality

**Covers:** Distribution copy

**Goal:** Outbound share text carries emotional context, not generic product wording.

**Setup:** Authenticated user with a completed song

**Steps:**
1. Open a completed song
2. Tap Share
3. Open system share sheet
4. **Capture:** Screenshot of share sheet
5. **Assert:** Pre-filled text includes recipient name or occasion context
6. **Assert:** Link is present and usable

**Automation level:** iOS simulator — partial (share sheet may be hard to automate)

---

## S8 · Gift Policy Mode

**Covers:** Policy correctness

**Goal:** Verify behavior under both `gift_require_app_claim` modes.

**Setup:**
- Run `node scripts/seed-validation-fixtures.js` to create fixtures
- Use `gift_share_app_required` and `gift_share_web_allowed` share URLs from output

**Steps:**
1. Open gift share with `app_required = true` in browser
2. **Capture:** Screenshot — should show install prompt, not playback
3. Open gift share with `app_required = false` in browser
4. **Capture:** Screenshot — should show playback in browser
5. **Assert:** Both behaviors match their explicit policy

**Automation level:** Browser automation
