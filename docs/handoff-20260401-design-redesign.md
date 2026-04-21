# Handoff: Porizo iOS App Redesign Session
**Date:** April 1, 2026
**Branch:** version3
**Status:** Design complete, prototype ready, implementation next

---

## What Was Done This Session

### 1. UX Audit + 23 Fixes (SHIPPED)
Committed: `0c87ac8` + `54ab89d`
- Full UX review of every iOS screen via simulator screenshots
- 3 specialist reviewers (correctness, reliability, completeness) validated findings
- 23 fixes implemented across 15 Swift files, verified on iPhone via build_run_device
- Key fixes: auto-capitalization, clear CTAs, occasion context, tappable legal links, playback race condition, skeleton loaders, MiniPlayer padding, keyboard dismiss

### 2. Design System Research + Spec Creation
Committed: `ad65d5e`
- Original Codex critique → research-validated response (3 agents, 30+ sources)
- 6-agent spec review (correctness, adversarial, design lens, product lens, scope guardian, feasibility)
- 5-agent design review (shotgun, design lab, frontend quality, UX flow, feminine design research)
- LLM Council (5 advisors + peer review + chairman verdict)
- All Claude-Codex disagreements resolved across 4 rounds

### 3. Interactive Prototype (32 screens)
Location: `~/.gstack/projects/computa-porizo/designs/create-flow-20260401/prototype-full.html`
Serve: `python3 -m http.server 8888 --directory ~/.gstack/projects/computa-porizo/designs/create-flow-20260401`
View: `http://localhost:8888/prototype-full.html`

Screens: Splash, Onboarding, Name Entry, Auth (Apple + Phone + Verify + Profile), Home, Songs Library, Poems Library, Settings, Tell (Conversation Garden), Tell-Lyrics, Wait (Pulse), Reveal (Bloom + Success merged), Lyrics Review, Share (Postcard + Social Previews), Voice Enrollment (4 screens), Subscription, Now Playing, Poem Detail, Share Claim + 7 error states + no-credits screen

### 4. LLM Council Skill Created
Location: `~/.claude/skills/llm-council/SKILL.md`
Trigger: "council this", "run the council", "pressure-test this"

---

## Key Design Decisions (LOCKED)

| Decision | Choice |
|----------|--------|
| Palette | **Warm Canvas**: #FBF7F2 bg, #E07850 coral, #7B8F6B sage, Fraunces display font |
| Tell moment | **Conversation Garden** — organic bubbles, sage AI / coral user |
| Wait moment | **The Pulse** — transparent breathing coral rings, dark text on cream |
| Reveal moment | **The Bloom** — radial coral gradient, in-route transformation |
| Share moment | **The Postcard** — coral-to-amber gradient card, waveform decoration |
| Logo | Wrapped-song gift mark on coral tile (#E07850) |
| Flow order | Name Entry → Auth → Tell (inline genre) → Lyrics Review (inline) → Wait → Reveal → Share |
| First-time voice | Skip voice selection entirely, auto-select AI voice |
| Target audience | Emotionally expressive gifting, women as primary wedge (not exclusive) |
| "90 seconds" | Headline promise on onboarding + auth screens |
| Recipient naming | "For Sarah" as hero text, not "Birthday Song for Sarah" |
| In-route reveal | Not a modal — the route transforms in place |

---

## What Needs to Happen Next

### Phase 0 (Ship this week)
These are already implemented in Swift from the UX audit but need the design token swap:

1. **Swap DesignTokens.swift from dark to Warm Canvas palette**
   - Background: #0A0A0A → #FBF7F2
   - Surface: #161616 → #FFFFFF
   - Accent: #D4A574 → #E07850
   - Secondary: #8B7355 → #7B8F6B
   - Text: #F5F5F0 → #2C2420
   - Font: Playfair Display → Fraunces (download from Google Fonts)

2. **Remove StoryElementsCardView from UnifiedCreateFlowView.swift** (already identified, lines 407-416)

3. **Remove SongProgressIndicator** (lines 400-404)

4. **Skip voice selection for first-time users** (detect via UserDefaults flag, default to AI female voice)

5. **Run 5 guerrilla usability tests** on the cleaned build

### Phase 1 (After guerrilla tests)
- Build reveal choreography (reference PoemRevealView.swift)
- Pre-generate share links on `.previewReady`
- Design recipient open/claim experience
- Error UX for each moment

### Phase 2 (Emotional payoff)
- Per-song AI cover art generation (DALL-E 3, spec in design-like-a-yc-startup-spec.md)
- Onboarding redesign (sample song, single screen)
- Occasion-triggered reactivation push notifications

---

## Important Development Notes

1. **Name field starts blank** — prototype name field is empty. Auth copy is generic ("Sign in to create your song").
2. **Auth is skipped for returning users** — second create: Name Entry → Tell directly.
3. **Alternative flow documented** — if guerrilla tests show name-before-auth confuses users, fall back to: Onboard → Auth → Home → Create.
4. **Decision gates in spec** — guerrilla test results determine Phase 1 priorities (see spec lines 220-228).
5. **Coral text contrast resolved** — #C06030 (`--coral-text`) for small body/link text (4.5:1 WCAG AA). #E07850 (`--coral`) for buttons, fills, and display text.
6. **Recipient claim is deep-link first** — "Listen Now" is primary CTA, PIN entry is secondary fallback. Implementation needs signed URL token claim path.
7. **Social sharing previews** — Share screen shows iMessage, WhatsApp, and Instagram DM link previews. Implementation needs Open Graph meta tags on the share URL.
8. **Success merged into Reveal** — no separate success screen. Reveal shows checkmark + Play + Share + Save in one view.

## Codex Review Fixes Applied (Post-Handoff)

| Finding | Status | What Changed |
|---------|--------|-------------|
| Reveal sequencing (extra Success screen) | Fixed | Merged into Reveal. Flow: Tell → Wait → Reveal → Share |
| Recipient PIN friction | Fixed | Deep-link "Listen Now" primary, PIN fallback |
| Credits banner in Tell | Fixed | Removed entirely |
| Fraunces typography | Fixed | Google Fonts loaded, 37 instances swapped |
| Home too busy | Fixed | Feature banner removed, two CTAs merged to one |
| Sarah demo prefill | Fixed | Name field blank, auth copy generic |
| Generic tell error | Fixed | Contextual: what happened + what's saved + what next |
| Coral contrast | Fixed | --coral-text (#C06030) for small text across all classes |
| Social sharing display | Added | iMessage, WhatsApp, Instagram DM link previews on Share |

---

## Files Reference

### Design Documents (committed)
```
docs/design/
├── design-like-a-yc-startup.md              # Original critique
├── design-like-a-yc-startup-v2.md           # Research-validated response
├── design-like-a-yc-startup-spec.md         # Design spec (THE working doc)
├── design-like-a-yc-startup-comprehensive.md # Implementation brief
├── spec-review-findings.md                  # 6-agent review
├── design-review-synthesis.md               # 5-agent synthesis
├── yc-recommendations-validation.md         # YC validation
docs/council/
├── council-report-20260401.html             # LLM Council report
├── council-transcript-20260401.md           # Full transcript
```

### Prototype (not committed — user data dir)
```
~/.gstack/projects/computa-porizo/designs/create-flow-20260401/
├── prototype-full.html          # 32-screen interactive (81KB)
├── approved.json                # Locked design choices
├── variant-*.html               # Individual variant mockups
├── variant-reveal-a.png         # AI-generated cover art reference
```

### iOS Code Modified This Session
```
PorizoApp/PorizoApp/
├── Flows/InlineNamePromptView.swift    # F-01: auto-cap + F-05: occasion context
├── Flows/UnifiedCreateFlowView.swift   # F-05: occasion passthrough
├── Tabs/ExploreTabView.swift           # F-02,08,09,23: CTAs, chips, banner, playback
├── PhoneAuthView.swift                 # F-18: tappable legal links + F-27: keyboard
├── MainTabView.swift                   # F-15,19,22: tab label, share, padding
├── AuthView.swift                      # F-12: waveform + context message
├── RootView.swift                      # F-24,26: deep link context, dead code removal
├── VoiceEnrollmentView.swift           # F-20: chevron back button
├── ShareClaimView.swift                # F-21: loading state + F-27: keyboard
├── Tabs/PoemsTabView.swift             # F-22,25: padding, skeleton
├── MySongsView.swift                   # F-22,28: padding, LPM feedback
├── DesignTokens.swift                  # F-22: miniPlayerHeight constant
├── Components/SkeletonView.swift       # F-25: PoemCardSkeleton
├── Services/RenderPollingService.swift  # F-28: isLowPowerModeActive
├── ProfileCompletionView.swift         # F-27: keyboard dismiss
```

---

## Session Stats
- ~50 agents spawned across research, design, review, and implementation
- 3,657 lines of design documentation committed
- 297 lines of Swift code changes (23 UX fixes)
- 32-screen interactive prototype (81KB HTML)
- 1 new skill created (llm-council)
- App installed on physical iPhone
