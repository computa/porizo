# Task 12 — Skipped pending design decision

**Date:** 2026-05-19
**Task:** Adopt `BlurBackdropArtwork` in `RevealBloomView`
**Status:** Not executed — plan's assumption doesn't match the codebase.

## What the plan said

Plan section: "Adopt BlurBackdropArtwork in RevealBloomView" (lines 2719-2804).

The plan's code snippet replaces the body of `RevealBloomView.swift` with:

- `BlurBackdropArtwork(artworkURL: artworkURL)` as the base layer
- A bottom gradient scrim with `Text("For \(recipientName)")` and an occasion subtitle

## Why it was skipped

`PorizoApp/PorizoApp/Flows/RevealBloomView.swift` does NOT currently render artwork. Its actual structure is:

- A radial coral-gradient bloom background (no image)
- Frosted checkmark
- `For {recipientName}` title
- Occasion emoji subtitle
- Animated waveform bars
- Play button (white circle, dominant CTA)
- Share button
- "Listen with lyrics" link
- Edit-lyrics + save-to-library tertiary links

No `AsyncImage`, no `artworkURL` parameter, no artwork rendering region exists. Applying the plan's code literally would replace the entire reveal-moment UX with a static artwork-plus-title screen — losing the play CTA, the haptic + animation choreography, the waveform, the share button, and the tertiary links.

## Where artwork actually renders

The artwork-rendering surfaces are:

- `PorizoApp/PorizoApp/Flows/SharePostcardView.swift` — has `artworkURL: String?` and `AsyncImage(url:)` at the top of the view, plus `Text("For \(recipientName)")` at line 150
- `PorizoApp/PorizoApp/Flows/WarmCanvasFlowView.swift` — also uses `AsyncImage`/`artworkURL` (2231 lines, broader flow shell)
- `NowPlaying*` views (per Task 13's audit list)

The plan likely intended one of these (SharePostcardView is the closest match for the "BlurBackdropArtwork + title overlay" pattern).

## What was shipped

Task 11's `BlurBackdropArtwork` component lives at:

- `PorizoApp/PorizoApp/Components/BlurBackdropArtwork.swift`

It compiles, has the spec-required props (`artworkURL`, padding, blur radius, dim opacity), and is reusable. No surface adopts it yet.

## What needs a decision before Task 12 can proceed

1. **Which surface should adopt `BlurBackdropArtwork`?**
   - `SharePostcardView` is the closest semantic match (artwork + recipient name + share context). Adopting it there is a high-impact UX change to the share moment — requires design approval.
   - `WarmCanvasFlowView`'s artwork section could use it. Need to identify the specific subview.
   - `NowPlaying` views are a separate "active playback" context — different design priorities.
   - `RevealBloomView` as written has no artwork; adopting `BlurBackdropArtwork` there would require an intentional redesign of the reveal moment (artwork-first instead of bloom-first).

2. **If `RevealBloomView` IS meant to be redesigned around artwork**, the plan needs a fresh pass that preserves the play CTA, checkmark, waveform, share button, and tertiary links — likely by layering them OVER the new artwork background instead of replacing them.

## Recommendation

Defer Task 12 to the manual QA + cutover phase (Task 16). When a real Flux-generated artwork is in hand and the user reviews the new visual style, decide then which surface(s) should host `BlurBackdropArtwork`. The component is ready and waiting.
