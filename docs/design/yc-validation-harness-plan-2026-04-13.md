# YC Design Validation Harness Plan

**Date:** 2026-04-13  
**Scope:** Validate user-facing behavior for the YC design violations and the new web-first distribution direction before and after implementation.

---

## Goal

Prove that the app and linked web experiences behave correctly for real users, not just that the code compiles or unit tests pass.

This harness must validate:

1. **Visual correctness**  
   The surfaces look like the intended product.
2. **Behavioral correctness**  
   The user can complete the flow and lands in the right state.
3. **Integration correctness**  
   State survives transitions across auth, share, web, and app.
4. **Emotional correctness**  
   The experience feels like receiving or creating a gift, not operating a tool.

---

## Principles

1. **Validate journeys, not files**
   The source of truth is the user flow. Screenshots of isolated screens are supporting evidence, not the primary proof.

2. **Use deterministic fixtures**
   Validation is only credible if the test data and app state are reproducible.

3. **Separate bug validation from policy validation**
   A flow can be “working as coded” while still conflicting with product direction. We must track both.

4. **Keep automation honest**
   Automation can prove transitions and visible state. It cannot prove emotional quality, which requires recorded walkthroughs and human review.

5. **Capture before and after**
   The same scenarios must run before implementation and after implementation with comparable artifacts.

---

## Validation Surfaces

| Surface | Primary Tooling | What It Can Prove | What It Cannot Prove Alone |
|---|---|---|---|
| iOS app | XcodeBuildMCP simulator automation | screen transitions, tap flows, accessibility tree, screenshots, video | App Store install handoff, real social preview rendering |
| Web player | Browser automation | web playback, CTA behavior, HTML/OG content, screenshots | real iMessage/WhatsApp preview presentation |
| Backend / policy | seeded fixtures + API assertions | share availability, claim behavior, policy modes | emotional quality |
| Physical device | manual checklist | install handoff, Smart App Banner, deep-link continuity, social preview appearance | repeatable automation at scale |

---

## Deliverables

### 1. Scenario Spec

Create:

`docs/design/validation/scenarios.md`

This is the durable source of truth for:

- scenario id
- user goal
- setup / fixture requirements
- scripted steps
- pass criteria
- failure criteria
- artifact capture points
- automation level
- manual-review notes

### 2. Review Rubric

Create:

`docs/design/validation/rubric.md`

This is used during human review of screenshots and videos.

It should score:

- clarity of next action
- emotional framing
- recipient/sender prominence
- timing of app ask
- presence of distracting chrome
- whether the moment feels premium or mechanical

### 3. Run Artifacts

Create:

```text
docs/design/validation/
  scenarios.md
  rubric.md
  runs/
    2026-04-13-before/
      ios/
      web/
      snapshots/
      videos/
      logs/
      report.md
    2026-XX-XX-after/
      ios/
      web/
      snapshots/
      videos/
      logs/
      report.md
```

Each `report.md` should summarize:

- scenarios executed
- pass / fail / blocked / manual-only status
- linked artifacts
- major regressions
- notes on fixture or automation gaps

---

## Prerequisites

### A. Deterministic Fixtures

Before any automation, add a stable way to generate known validation states.

Required fixtures:

1. `unbound_share_web_allowed`
   A valid unclaimed share that can be played in browser.
2. `claimed_share_same_device`
   A share already claimed by the validating device.
3. `claimed_share_other_device`
   A share claimed elsewhere, useful for blocked-state validation.
4. `gift_share_app_required`
   A gift share with app-required policy enabled.
5. `gift_share_web_allowed`
   A gift share with web-first listening allowed.
6. `auth_user_empty_state`
   Authenticated user with no active creation session.
7. `preauth_create_seed`
   Unauthenticated starting point for onboarding -> name entry -> auth continuation.

Preferred implementation:

- admin-only validation seed route, or
- scripted local fixture creation command, or
- DB seeding helper guarded to local/dev only.

### B. Stable Selectors

Before scripting flows, add accessibility identifiers or equivalent stable selectors for:

- onboarding primary and secondary CTAs
- name-entry recipient field
- occasion chips
- auth screen primary CTA
- create flow entry CTA
- reveal buttons
- share buttons
- wait subtitle text
- Explore header actions
- inline progress percentage label if present
- web player CTA hooks

Do not rely on fuzzy labels where deterministic identifiers are possible.

---

## Scenario Matrix

The harness should validate journeys, not one isolated bug per script.

### S1 · Pre-auth Create Carry-Through

**Covers:** V1, V6

**Goal:** A user starts before auth, enters recipient context, authenticates, and lands in a prefilled creation experience without re-entering data.

**Setup:** unauthenticated user, fresh app state.

**Flow:**

1. Launch app fresh
2. Move through onboarding to name entry
3. Enter recipient name `Sarah`
4. Select occasion `Birthday`
5. Continue into auth
6. Authenticate through deterministic local flow
7. Enter create flow

**Pass:**

- recipient is still `Sarah`
- occasion is still `Birthday`
- create flow is resumed, not restarted from blank state
- onboarding secondary CTA label is correct

**Capture:**

- screenshot of name entry
- screenshot of auth step
- screenshot of post-auth create state
- simulator video of full journey

### S2 · Reveal and Share Readiness

**Covers:** V2, V3

**Goal:** When a song is ready, reveal feels complete, share is immediately available, and reveal actions do not eject prematurely.

**Setup:** deterministic ready-to-reveal test content or a fast mocked render path in local/dev.

**Flow:**

1. Enter a prepared reveal-ready song flow
2. Wait for reveal to appear
3. Without tapping Share yet, inspect share readiness
4. Tap Share
5. Return to reveal/player state
6. Tap `Listen Fully` / `Save to Library`

**Pass:**

- reveal appears with no extra wait for share generation
- first Share interaction opens immediately or uses already-ready state
- reveal/player/share route persists until explicit exit
- user is not bounced to Songs tab on reveal action unless they choose a close/save exit

**Capture:**

- reveal screenshot
- share screenshot
- accessibility snapshot before share tap
- simulator video of reveal -> share -> player behavior

### S3 · Wait and Create Chrome Hygiene

**Covers:** V4, V5

**Goal:** Wait and create surfaces reinforce the product promise and do not expose mechanical system scaffolding.

**Setup:** enter a wait / generating state via fixture or designable debug state.

**Flow:**

1. Open wait state
2. Inspect copy
3. Open Explore tab
4. Inspect top chrome
5. Open creating state

**Pass:**

- wait copy reinforces `90 seconds`
- Explore has no dead “Coming soon” actions
- creating state does not show explicit `%` progress text

**Capture:**

- wait screenshot
- Explore screenshot
- inline creating screenshot

### S4 · Web Recipient Open

**Covers:** distribution quality, V7

**Goal:** A cold recipient gets emotional value in browser before being asked to install the app.

**Setup:** `unbound_share_web_allowed`

**Flow:**

1. Open share URL in browser
2. Inspect OG metadata in response HTML
3. Load web player
4. Start playback
5. Observe CTA hierarchy before and after playback

**Pass:**

- OG title/description lead with recipient/sender/occasion as designed
- browser page leads with sender/recipient framing
- playback is available without install in web-first policy mode
- app CTA exists but is not placed before first value

**Capture:**

- raw OG meta snapshot
- first-load screenshot
- playback screenshot
- post-play CTA screenshot
- browser video walkthrough

### S5 · Web to App Handoff

**Covers:** distribution continuity

**Goal:** If a user decides to install after getting value in web, the app preserves context and opens to the right place.

**Setup:** real device or high-confidence manual environment.

**Flow:**

1. Open share link in mobile browser
2. Listen in web
3. Tap install / app CTA
4. Install app from TestFlight or App Store test build
5. Open app

**Pass:**

- app opens with the same share context
- user lands in claim / continuation flow, not generic home
- no re-hunt for the original share link

**Capture:**

- manual notes
- screen recording if possible
- final landing screenshot in app

### S6 · Post-Claim Browser Listening

**Covers:** V9

**Goal:** Claiming ownership must not destroy the public read-only listening surface.

**Setup:** share link that supports claim, plus a post-claim validation step.

**Flow:**

1. Open share in web
2. Claim ownership in app
3. Reopen original public link in browser

**Pass:**

- browser still provides a read-only listening experience
- ownership remains exclusive
- public listen and ownership semantics are separate

**Capture:**

- pre-claim browser screenshot
- post-claim browser screenshot
- app claim screenshot

### S7 · Share Message Quality

**Covers:** V8

**Goal:** The outbound share text carries enough human context to improve open rate.

**Setup:** generated share from iOS app.

**Flow:**

1. Create a share in iOS
2. Open system share sheet
3. Inspect generated share text

**Pass:**

- copy is not generic product wording only
- copy includes sender, recipient, or occasion context when available
- link remains present and usable

**Capture:**

- screenshot of share sheet text
- copied text artifact in run log

### S8 · Gift Policy Mode Validation

**Covers:** T2

**Goal:** Verify intended product behavior under both policy modes.

**Setup:**

- `gift_share_app_required`
- `gift_share_web_allowed`

**Flow:**

1. Open gift share in app-required mode
2. Open gift share in web-first mode

**Pass:**

- behaviors match explicit policy
- app-required mode is treated as a deliberate override, not mistaken for a UX regression
- web-first mode delivers meaningful browser value

**Capture:**

- screenshots for both modes
- run report note explaining policy mode in effect

---

## Automation Strategy

### iOS Automation

Use XcodeBuildMCP for:

- boot / build / run
- typing and taps
- `snapshot_ui`
- screenshots
- video recording

Automate:

- S1
- S2
- S3
- parts of S7

### Web Automation

Use browser automation for:

- opening share URLs
- checking OG metadata
- testing playback UI states
- validating CTA hierarchy

Automate:

- S4
- S6
- S8

### Manual Device Validation

Manual-only or mostly manual:

- S5
- final social preview verification for S4
- final iMessage / WhatsApp share-preview rendering

---

## Artifact Rules

For every scenario run:

1. Save screenshots at named checkpoints.
2. Save one accessibility snapshot for each important state transition.
3. Save one short video for end-to-end major journeys.
4. Save relevant logs or copied text artifacts.
5. Update the run `report.md`.

Naming convention:

```text
01-launch.png
02-name-entry.png
03-auth.png
04-create-prefilled.png
snapshot-03-auth.json
flow.mp4
notes.md
```

---

## Human Review Rubric

After automation, review the artifacts against these questions:

1. Is the next action obvious without explanation?
2. Does the screen feel like a gift moment or a tool state?
3. Is the person more prominent than the product machinery?
4. Does the install / app ask happen after value, not before it?
5. Is there any dead chrome or “coming soon” surface stealing attention?
6. Would this make someone more likely to open, listen, and share?

If a flow passes automation but fails this rubric, it is not done.

---

## Execution Order

### Phase A · Harness Setup

1. Create validation doc structure
2. Define scenarios and rubric
3. Add required accessibility identifiers
4. Add deterministic fixture generation

### Phase B · Baseline Capture

1. Run all current-state scenarios
2. Save artifacts under `runs/2026-04-13-before/`
3. Produce baseline `report.md`

### Phase C · Post-Implementation Validation

1. Re-run the same scenarios after fixes
2. Save artifacts under a dated `after` run directory
3. Compare against baseline
4. Record any remaining manual-review failures

---

## Success Criteria

The harness is only complete when:

- all scenarios have documented setup and pass criteria
- fixtures can be created reproducibly
- major journeys can be rerun without manual setup drift
- before-state artifacts exist
- after-state artifacts can be compared directly
- manual device checks exist for non-automatable handoff paths
- run reports make pass/fail decisions obvious

---

## Immediate Next Steps

1. Create `docs/design/validation/` with `scenarios.md` and `rubric.md`
2. Decide fixture mechanism for local validation
3. Add critical accessibility identifiers
4. Capture baseline `before` run for S1-S4 first
5. Add web-first distribution scenarios S5-S8 once share fixtures are stable
