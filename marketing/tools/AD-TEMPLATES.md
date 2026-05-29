# Porizo Meta Ad Creative Templates

Reusable, config-driven ad creative system. Three standing templates, each rendered at 3 sizes (1:1, 4:5, 9:16). Pick whichever fits the situation; swap copy/images per campaign via a config.

Generator: `marketing/tools/generate-ad-templates.js` (Sharp/SVG, deterministic, no external calls).

## The three templates

| Template | What it is | Use when |
|---|---|---|
| `product` | iPhone showing the Porizo player — cover art, song title, waveform, play button, headline + CTA. | **Default / highest install clarity.** Shows the actual deliverable. Best for cold install campaigns. |
| `floral` | Full-bleed song-artwork image + dark scrim + bold serif headline + CTA. | "Better than flowers" / gift-replacement hook. Strong for Mother's Day, romantic occasions. (Florals skew feminine — mind the occasion.) |
| `comparison` | Before/after split (faded cliché gift vs the song mini-player) + footer headline + CTA. | Gift-buyer framing — "not another [tie/mug]." Scroll-stopping contrast. |

## Run

```bash
# All templates, all sizes, default config (Father's Day 2026)
node marketing/tools/generate-ad-templates.js

# One template only
node marketing/tools/generate-ad-templates.js --only product

# A different campaign config
node marketing/tools/generate-ad-templates.js --config ./marketing/tools/ad-configs/mothers-day-2026.json
```

Output → `marketing/campaigns/output/<config.name>/templates/<template>-<size>.png` (9 files).

## Config shape

A config describes one campaign/occasion. Copy the `FATHERS_DAY_2026` block in the generator (or pass `--config <file.json>`):

```jsonc
{
  "name": "fathers-day-2026",          // output dir name
  "brand": "Porizo",
  "product": {
    "kicker": "PORIZO · SONG GIFT MAKER",
    "headline": ["Memories,", "in a song."],   // last line renders in accent color
    "coverImage": "marketing/remotion/public/stock/drive-home/04-father-daughter-bike.png",
    "songTitle": "For Dad",
    "songSub": "made by Maya · 0:48",
    "cta": "TRY FREE ON APP STORE"
  },
  "floral": {
    "bgImage": "storage/artwork-library/v2/i_love_you/0.jpg",
    "headline": ["Forget Flowers.", "Make Him a Song."],
    "sub": "Father's Day is June 21. A personalized song, sung in your voice — free, under 60s.",
    "cta": "TRY FREE ON APP STORE"
  },
  "comparison": {
    "beforeLabel": "the same old gift",
    "afterImage": "marketing/remotion/public/stock/drive-home/04-father-daughter-bike.png",
    "afterLabel": "a song of your memories",
    "footerHeadline": ["Give him something", "he'll keep."],
    "cta": "MAKE HIS SONG — FREE"
  }
}
```

Image paths are relative to repo root (or absolute). `headline` / `footerHeadline` are arrays — the **last line** renders in the coral accent.

## Design notes (why it looks the way it does)

- **Palette** matches the live Porizo player + app: dark canvas `#0E0B08`/`#1A0F08`, coral accent `#E8966E`, player accent `#E07A4B`, cream text `#F6EFE3`. Serif = Georgia (display), sans = system.
- **Rasters** are cover-cropped with Sharp (`fit:cover, position:attention` — auto-focuses the subject) then base64-embedded into the SVG so it's a single deterministic render.
- **No emoji** — librsvg can't color-render them. The comparison "before" side uses a drawn vector gift mark instead.
- Layouts scale proportionally to canvas height, so the 9:16 (Reels/Stories) reads correctly, not just the square.

## Source assets used by the Father's Day config

- Dad memory photo: `marketing/remotion/public/stock/drive-home/04-father-daughter-bike.png`
- Song artwork florals (75 images, 15 occasions × 5): `storage/artwork-library/v2/<occasion>/<0-4>.jpg`

`generate-ad-templates.js` is the single canonical ad-creative generator. (The earlier type-only `generate-fathers-day-ads.js` was removed 2026-05-29 to avoid confusion.)

## Deploying to a live Meta campaign

Per `reference_meta_ios14_skan_campaign_creation` (memory): upload PNG → `POST /act_29474028/adimages` (hash) → `POST /act_29474028/adcreatives` (object_story_spec.link_data, CTA `INSTALL_MOBILE_APP`) → update the ad's `creative` or create a new ad. No campaign rebuild needed.
