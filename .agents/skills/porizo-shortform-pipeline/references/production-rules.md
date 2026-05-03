# Production rules

This file defines the reusable production rules for song cuts, product demos, and platform packaging.

## Audio cut meanings

- `hook`
  The fastest, most legible section. Good under a spoken hook or at the start of a ReelFarm UGC ad.
- `proof`
  The part that proves the song is specific to a real memory. Use it when the ad is showing the app or the story itself.
- `payoff`
  The emotional lift. Often chorus territory.
- `tail`
  The lower-pressure support section for CTA, logo, or app playback.

Recommended lengths:

- `hook`: 4 to 6 seconds
- `proof`: 6 to 10 seconds
- `payoff`: 8 to 12 seconds
- `tail`: 4 to 6 seconds

If a song does not support all four cuts cleanly, say so and create the strongest three instead of forcing bad windows.

## Clip selection rules

- Prefer explicit timestamps when known.
- If the user has lyric text, use it to choose windows.
- If the user does not have lyric text, inspect structure and choose windows conservatively.
- Do not pretend sung-audio transcription is precise when it is not.

## Product demo rules

The clean master should usually be one vertical 9:16 video.

Preferred flow:

- `Lyrics`
- `Reveal`
- `Now Playing`

If only `Reveal` and `Now Playing` exist, use those.

If `Lyrics` is a still image, it is acceptable to use a short hold or a subtle motion treatment before transitioning into video.

Unless the user explicitly asks otherwise, keep the reveal clip audio as the only soundtrack. Do not stack duplicate audio from multiple screen recordings.

## Platform outputs

Export one clean vertical master and then create labeled MP4 copies for:

- TikTok
- Instagram Reels
- Facebook Reels
- ReelFarm

Use H.264 video, AAC audio, yuv420p pixel format, and `+faststart` where possible.

## ReelFarm note

ReelFarm can use uploaded custom sound, but the UI is misleading. The uploaded sound card itself acts as the selection target even when there is no explicit `Use` button. The skill should not depend on automating that UI; just produce clean audio assets and a demo file.
