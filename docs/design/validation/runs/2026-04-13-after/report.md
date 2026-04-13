# Validation Report: 2026-04-13 (After)

**Run date:** 2026-04-13
**Build:** v1.5.4 (post-Codex implementation)
**Device:** iPhone 16 Pro simulator (iOS 18.6)
**Branch:** version3
**Fixtures used:** `--reset-onboarding`, `--bypass-auth`, `--fixture-reveal`, `--fixture-reveal-ready`, `--fixture-creating`

---

## Scenario Results

### S1 · Pre-auth Create Carry-Through (V1 + V6)

| Check | Status | Evidence |
|-------|--------|----------|
| Onboarding secondary CTA says "Get started" | **PASS** | Tapped through 3 pages, "Get started" appeared on last page |
| Name Entry → auth → create preserves name | **PASS** | Entered "Sarah" + Birthday → Continue → Create flow shows "For Sarah" with Birthday chip |
| Recipient field shows "Sarah" | **PASS** | `snapshot_ui`: `name-entry-recipient-field` AXValue = "Sarah" |
| Occasion chip IDs work | **PASS** | `tap(id: "occasion-chip-birthday")` succeeded |
| `create-flow-recipient-display` shows "For Sarah" | **PASS** | Screenshot `11-v1-carry-through-validated.jpg` |

**V1: PASS** — Pre-auth personalization carries through.
**V6: PASS** — "Get started" label is correct.

### S2 · Reveal and Share Readiness (V2 + V3)

| Check | Status | Evidence |
|-------|--------|----------|
| Reveal-ready fixture loads with seeded share state | **PASS** | `--fixture-reveal-ready` lands directly in reveal with seeded track + share controller |
| Reveal accessibility IDs present | **PASS** | `reveal-play-button`, `reveal-share-button`, `reveal-save-button`, `reveal-edit-lyrics-button`, `reveal-exit-button`, `reveal-listen-button` all present |
| Share pre-generated before tap | **PASS** | `snapshot_ui` exposes `share-link-ready-indicator` with label `Share link ready` before any tap |
| First share interaction opens immediately | **PASS** | Tapping `reveal-share-button` transitions directly to Share Postcard with no loading toast/polling state |
| Reveal actions don't eject | **PASS** | `Go back` returns to reveal, `reveal-save-button` changes to `Saved to library` and remains in-flow |

**V2: PASS** — Share readiness is now behavior-testable and seeded before tap.
**V3: PASS (fixture path)** — Reveal persists through share/back/save without ejecting to Songs.

### S3 · Wait and Create Chrome Hygiene (V4 + V5)

| Check | Status | Evidence |
|-------|--------|----------|
| Wait subtitle says "90 seconds" | **PASS** | `--fixture-creating` shows "Ready in about 90 seconds" |
| Explore has no placeholder buttons | **PASS** | `snapshot_ui` — no `explore-search-button`, no `explore-notifications-button`, no "Coming soon" |
| Creating card has no % text | **PASS** | `--fixture-creating` screenshot shows only status message, no percentage |

**V4: PASS** — "Ready in about 90 seconds" confirmed.
**V5a: PASS** — Placeholder buttons removed.
**V5b: PASS** — Progress percentage removed.

### S4-S8 · Web/Distribution Scenarios

#### S4 · Web Recipient Open (V7)

| Check | Status | Evidence |
|-------|--------|----------|
| Playback is available without install on unbound web-allowed share | **PASS** | `/share/sh_9595a66da401083e/audio` returned `200 audio/mp4`; browser page shows live `Play` surface |
| OG metadata is emotionally specific | **PASS** | Raw HTML now renders `og:title = "A birthday song for Sarah"` and `og:description = "Open Sarah's birthday song and listen in your browser."` |
| Recipient context leads the page | **PASS** | Live page now opens as `Birthday song for Sarah` with subtitle `Made for Sarah` |
| App CTA does not block first listen | **PASS** | Initial HTML now sets `id="post-play-cta" aria-hidden="true"` and the live player opens without an overlay on the play button |
| Viral creation CTA exists | **PASS** | After playback completes, the post-play CTA appears with `Make a song for someone you love` and `Download Porizo — Free on the App Store` |

**V7: PASS** — Browser-first framing is now specific enough and first listen is no longer blocked.

#### S6 · Post-Claim Browser Listening (V9)

| Check | Status | Evidence |
|-------|--------|----------|
| Claimed share still exposes read-only browser playback when public listening is allowed | **PASS** | `claimed_share_same_device` returns `status:"claimed"`, `web_stream_url`, and `/audio` returns `200 audio/mp4` |
| Claimed share browser page still loads a playable surface | **PASS** | Browser page for `sh_8d0bf739ee07cfc4` loads with `Play`, `Copy Link`, WhatsApp/X share actions |
| Claimed share on another device remains blocked when app-required | **PASS** | `claimed_share_other_device` returns `web_stream_url:null`; `/audio` returns `403`; browser shows claimed-on-another-device block page |

**V9: PASS** — Ownership no longer kills public listening by default.

#### S7 · Share Message Quality (V8)

**Status: NOT RUN** — Native share-sheet copy still needs a dedicated iOS/manual pass. The current harness did not automate the system share sheet.

#### S8 · Gift Policy Mode

| Check | Status | Evidence |
|-------|--------|----------|
| `gift_require_app_claim = true` blocks browser playback | **PASS** | `gift_share_app_required` shows install-only browser page; `/audio` returns `403` |
| `gift_require_app_claim = false` allows browser playback | **PASS** | `gift_share_web_allowed` exposes `web_stream_url`; `/audio` returns `200 audio/mp4` |
| Web-allowed gift path carries sender context cleanly | **PASS** | Raw HTML renders `Marcus made a graduation song for Alex`; live page shows `Graduation song for Alex` with subtitle `From Marcus`; WhatsApp/X share text uses the same framing |
| Web-allowed gift path gives value before install ask | **PASS** | Initial player loads with Play surface unobstructed; app CTA overlay only appears post-play |

**Policy behavior:** **PASS**
**Recipient experience quality:** **PASS**

---

## Violation Summary

| Violation | Description | Status | Confidence |
|-----------|-------------|--------|------------|
| V1 | Pre-auth carry-through | **PASS** | High — live flow validated |
| V2 | Share pre-generation | **PASS** | High — reveal fixture exposes ready state before tap |
| V3 | Reveal settle | **PASS** | High — reveal → share → back → save stays in-flow |
| V4 | Wait copy "90 seconds" | **PASS** | High — fixture confirmed |
| V5a | Placeholder buttons removed | **PASS** | High — accessibility tree confirmed |
| V5b | Progress % removed | **PASS** | High — fixture confirmed |
| V6 | Onboarding label "Get started" | **PASS** | High — live flow validated |
| V7 | OG preview framing / web-first recipient surface | **PASS** | High — live browser + raw HTML rerun validated |
| V8 | Share-sheet copy | **NOT RUN** | Needs native share-sheet validation |
| V9 | Post-claim browser listening | **PASS** | High — live browser + HTTP validated |

---

## Artifacts

### Accessibility Snapshots

- Explore tab: No `explore-search-button` / `explore-notifications-button` — **V5a confirmed**
- Name Entry: `name-entry-recipient-field` AXValue="Sarah", `occasion-chip-birthday` selectable — **V1 IDs working**
- Reveal fixture: `reveal-share-button`, `reveal-save-button`, `reveal-listen-button`, `reveal-exit-button`, `share-link-ready-indicator` — **S2 confirmed**
- Share postcard: `Go back`, `Send this postcard to Sarah`, `Copy share link` — **S2 transition confirmed**
- Web player initial state: `Birthday song for Sarah`, `Made for Sarah`, `Copy Link`, `WhatsApp`, `X`, `App Store`, `Google Play` — **S4 rerun snapshot**
- Web player post-play state: `Make a song for someone you love`, `Download Porizo — Free on the App Store`, `Listen again` — **S4 post-play CTA rerun**
- Gift web-allowed state: `Graduation song for Alex`, `From Marcus`, WhatsApp/X share text includes sender + recipient + occasion — **S8 rerun**
- Gift app-required page: `Something went wrong`, `Web playback is disabled for this song. Open the Porizo app to claim and listen.` — **S8 policy block confirmed**
- Claimed share on blocked device: `This link has already been claimed on another device. Ask the sender for a new link.` — **V9 wrong-device guard confirmed**

### HTTP / DOM Evidence

- Unbound share HTML: `og:title = "A birthday song for Sarah"`, `og:description = "Open Sarah's birthday song and listen in your browser."`
- Gift web-allowed share HTML: `og:title = "Marcus made a graduation song for Alex"`, `og:description = "Marcus made this graduation song for Alex. Listen in your browser."`
- Initial player DOM: `#post-play-cta` now starts with `aria-hidden="true"` and no `visible` class
- Post-play DOM: `#post-play-cta.className = "overlay-cta post-play-cta visible"` only after playback completes
- Claimed public share: `/share/sh_8d0bf739ee07cfc4/audio -> 200 audio/mp4`
- Claimed wrong-device share: `/share/sh_01e76bc5f6fb9724/audio -> 403 application/json`

---

## Next Steps

1. Run a dedicated native/manual pass for S7 share-sheet copy
2. Run S5 on a real device/TestFlight for web-to-app continuity
3. If you want durable visual artifacts in-repo, persist screenshots/video from this rerun into the validation assets directory
