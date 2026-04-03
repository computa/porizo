# Warm Canvas Gap Analysis — April 3, 2026

Consolidated findings from 4 parallel review agents comparing the current iOS implementation against the YC research approach, product specs, warm canvas handoff docs, and unified creation flow design.

---

## P0 — Critical (Breaks core promise or conversion)

| # | Finding | Source | Detail |
|---|---------|--------|--------|
| P0-1 | **Onboarding audio player is a non-functional mock** | YC-N8, Spec-NI12 | Play button has no action handler. The product sells audio but the pre-auth hook is inert. All 5 YC research agents independently flagged "play before auth" as the #1 recommendation. |
| P0-2 | **No haptic feedback on Reveal** | YC-N2 | Research specifies `.success` + `.heavy(0.8)` 200ms later. `RevealBloomView` has zero haptic calls. The reveal is "the single highest-leverage design investment" — it should feel physical. |
| P0-3 | **Share link not pre-generated at render completion** | YC-N4, Flow-DATA1 | Link is generated lazily on "Send" tap, causing 5s visible wait. Research: "generate at `previewReady` so sharing feels instant." Fix: call `generateShareLink()` in `transitionToReveal()`. |
| P0-4 | **"2-3 minutes" wait copy contradicts "90 seconds" onboarding promise** | Flow-UX1 | `WaitPulseView.swift:73` says "2-3 minutes." Onboarding and auth both say "90 seconds." Undermines the core conversion promise at the worst moment. |
| P0-5 | **Wait copy shows raw seconds counter** | YC-V1, YC-N7 | `"Creating for \(elapsedSeconds)s..."` — engineer-facing output. Research specifies 6 emotional timing buckets like "Writing the melody for {name}...". Only 3 buckets implemented. |
| P0-6 | **No funnel metrics instrumentation** | YC-N9 | Firebase analytics disabled. No Mixpanel/Amplitude/PostHog. The redesign shipped without measurement infrastructure to evaluate whether it's working. |

---

## P1 — High (Significant UX degradation or spec violation)

| # | Finding | Source | Detail |
|---|---------|--------|--------|
| P1-1 | **Reveal has no path to NowPlayingView** | Flow-GAP2 | Full player with scrubber/lyrics/transport only reachable via MiniPlayer on main tabs. User stuck with inline play on Reveal. No "settle to player" transition exists. |
| P1-2 | **ShareClaimView is PIN-first, not Listen-first** | Flow-GAP4 | Design: "Listen Now" primary CTA, PIN secondary. Code inverts this — PIN required before playback. |
| P1-3 | **Share claim shows wrong sender attribution** | YC-N6 | Shows recipient name as sender ("Sarah sent you a song" when Sarah is the recipient). No `senderName` field surfaced. |
| P1-4 | **VoiceSelectionChips forces binary gender decision** | YC-V4 | Static `.female`/`.male`/`.myVoice` order. Research: voice should be chosen for emotional fit, not gender assumption. Should be invisible for first-time users. |
| P1-5 | **"Edit lyrics" from Reveal drops back to full conversation thread** | Flow-UX2 | Returns to `.tell(.trackCreated)` showing all previous messages. Violates "in-route transformation" principle. Should be modal/overlay, not route regression. |
| P1-6 | **Voice skip fires on wrong event** | YC-N1, Flow-DATA2 | `hasCompletedFirstSong` set on render completion, not session start. Reinstall/second device resets it. Uses `@AppStorage` (local-only), not backend-reconciled. |
| P1-7 | **VoiceSelectionChips pinned outside scroll thread** | Flow-UX3 | Chips render below ScrollView, not inside it. User can't scroll conversation while voice prompt is active. Spec shows chips as part of scrollable thread. |
| P1-8 | **Error overlays provide no access to conversation** | Flow-UX6 | Full-screen `zIndex(100)` covers. User can't see their story, AI's last message, or context. Only "retry" or "exit." Especially bad for moderation errors. |
| P1-9 | **Onboarding: no Name-Before-Auth flow** | Flow-GAP1 | Design: Name Entry -> Auth -> Tell. Both CTAs go straight to `.auth`. No intent preservation across sign-in gate. |
| P1-10 | **Poem flow discards occasion from InlineNamePromptView** | Flow-GAP5, Flow-DATA5 | `onStart: { name, _ in startChatWithName(name) }` — occasion explicitly dropped with `_`. |

---

## P2 — Medium (Spec deviations, missing features)

| # | Finding | Source | Detail |
|---|---------|--------|--------|
| P2-1 | **No per-song AI cover art** | YC-N5 | Full Tier 2 spec exists (DALL-E 3, $0.04/image). `coverImageUrl` returns nil in all cases. No backend image generation service. |
| P2-2 | **No 5-tab layout with center Create button** | Spec-NI1,2 | Spec: 5 tabs with prominent Create center. Code: 4 tabs (home/songs/poems/profile). App opens to Home, not Create. |
| P2-3 | **Splash screen: static circle, not particle globe** | Spec-NI9 | Spec: animated particle sphere with rose accents and glow/bloom. Code: static gold circle + mic.fill. |
| P2-4 | **Onboarding: single page, not 3-slide wizard** | Spec-NI11,V3 | Deliberately violated — comment says "Single-page onboarding." No slides, no page dots, no swipe. |
| P2-5 | **All section specs specify Light Mode; code was dark** | Spec-V12 | Songs/Poems/Settings specs say white/stone backgrounds. Was dark `#0A0A0A`. Warm Canvas fixed this for the main flow but specs still reference the light mode with rose accents, not coral. |
| P2-6 | **Tab icons mismatch spec** | Spec-V1,NI3 | home=`"house"` (spec: `"safari"`), songs=`"music.note"` (spec: `"music.note.list"`), poems=`"scroll"` (spec: `"text.book.closed"`). |
| P2-7 | **Song cards: compact rows, not card-based layout** | Spec-V8,NI23 | Spec: card-based with large thumbnail. Code: 56pt compact row. |
| P2-8 | **Failed song state not rendered** | Spec-NI25 | `statusBadge` has no `failed` case — falls through to `default: EmptyView()`. |
| P2-9 | **Explore tab missing: stats row, search, bell icons, feature banner** | Spec-NI5,6,7 | All absent from `ExploreTabView.swift`. |
| P2-10 | **Settings: no help center, non-interactive language** | Spec-NI29,30 | Only `mailto:support@porizo.co`. Language row is display-only. |
| P2-11 | **SharePostcardView "How it works" adds friction before send CTA** | YC-V5 | 4-step PIN explanation sits between postcard and send button. Spec says "multi-step share preparation" doesn't belong in Share moment. |
| P2-12 | **"Save to Photos" is a stub** | Screens | `onSaveToPhotos` shows "coming soon" toast. No implementation. |
| P2-13 | **"90 seconds" promise absent from authenticated home** | YC-G6 | Onboarding/auth have it. ExploreTabView "Create for someone special" CTA has no time promise for authenticated-but-unconverted users. |
| P2-14 | **OccasionPickerCard double-prompts for occasion** | Flow-UX4 | If user skips chips in InlineNamePromptView, another picker appears in conversation. Double-prompt for same info. |

---

## P3 — Low (Cleanup, polish, stale code)

| # | Finding | Source | Detail |
|---|---------|--------|--------|
| P3-1 | **LyricsReviewView uses system font shortcuts** | Screens | `.headline/.body/.caption` instead of `DesignTokens.bodyFont()/displayFont()`. Stale "Velvet & Gold" comment. |
| P3-2 | **EnrollmentFlowView uses system fonts** | Screens | `.title.bold()` instead of `DesignTokens.displayFont()`. |
| P3-3 | **8 files have stale Velvet & Gold comments** | Screens | SplashView, AuthView, InputBarView, ExploreTabView, SongsTabView, PoemsTabView, SettingsTabView, LyricsReviewView — references to old hex codes or "v1.pen". |
| P3-4 | **Dead code: ThemePickerSheet.swift** | Screens | No callers. Velvet & Gold era remnant. |
| P3-5 | **Debug artifacts: WarmCanvasScreenGallery.swift** | Screens | 32-screen DEBUG gallery. `showWarmCanvasScreens` and `useUnifiedCreateFlow` flags are migration-era. Should be removed before release. |
| P3-6 | **RevealBloomView waveform animates regardless of playback state** | Flow-DATA4 | Waveform bounces perpetually even if audio fails. No `playbackError` check (exists in InlinePlayerCard but not here). |
| P3-7 | **`styleName` defaults to "Custom" before genre selection** | Flow-DATA3 | ChatHeaderView shows "Custom" chip before user selects genre. WarmCanvas handles this by passing nil. |
| P3-8 | **Two reveal paths may coexist** | YC-G7 | `RevealBloomView` (designed) and `InlinePlayerCard` (legacy) both map to `previewReady`. Unclear if legacy path is still reachable. |
| P3-9 | **Poem and song reveals are stylistically disconnected** | YC-G2 | PoemRevealView (wax seal, dark) and RevealBloomView (bloom, light) share no visual grammar. |
| P3-10 | **No guerrilla usability tests documented** | YC-N10 | All research docs treat 5 tests as "Position 0." No results in repo. |

---

## Detailed Reports

Full agent reports saved at:
- `/Users/ao/Documents/projects/porizo/.claude/cache/agents/scout/output-2026-04-03-yc-audit.md`
- `/Users/ao/Documents/projects/porizo/.claude/cache/agents/scout/output-20260403-spec-audit.md`
- `/Users/ao/Documents/projects/porizo/.claude/cache/agents/scout/output-20260403-102658.md`
- `/Users/ao/Documents/projects/porizo/.claude/cache/agents/scout/output-20260403-warmcanvas-screen-audit.md`
