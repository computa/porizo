---
name: porizo-shortform-pipeline
description: |
  Generate Porizo-ready memory stories, cut finished songs into short-form audio assets, and assemble vertical product demos for TikTok, Instagram Reels, Facebook Reels, and ReelFarm.
  Use when: (1) Turning a topic and moment into a stronger Porizo story input, (2) Preparing a finished song for hook/proof/payoff/tail usage, (3) Merging Lyrics, Reveal, and Now Playing captures into a short product demo, (4) Packaging final video outputs for short-form vertical platforms.
---

# Porizo Shortform Pipeline

Use this skill when the user wants one memory turned into a usable short-form content package instead of a one-off story or one-off video edit.

This skill has two modes.

`story mode` is for turning a real memory into a Porizo-ready story brief and optional manual lyric draft.

`production mode` is for taking a finished song and optional demo assets and turning them into reusable audio cuts and platform-ready demo videos.

## Story Mode

Do not ask for only `topic` and `moment`. That is too thin and leads to generic output.

Collect this input schema instead. Read `references/story-schema.md` if you need the exact wording.

- `hook`
- `recipient`
- `relationship`
- `occasion`
- `moment`
- `what it felt like then`
- `what it means now`
- `must-include details`
- optional `genre / vibe`

After you have the input, create or reuse a campaign output folder by running:

  node .agents/skills/porizo-shortform-pipeline/scripts/init_package.js --slug "<campaign-slug>"

Write the story package into that folder. The minimum output is:

- `story/story.md`

That file should contain:

- the hook
- a short story summary in plain language
- a `Porizo Story Input`
- a compact `Story paste block` that can be copied into the app
- optional manual lyric draft if the user asked for it

Keep the writing specific. Prefer small real details over generic gratitude.

## Production Mode

Production mode starts only after the user has a downloaded song file.

The normal sequence is:

1. Create or reuse the campaign package folder.
2. Copy or point at the finished song file.
3. Cut `hook`, `proof`, `payoff`, and `tail`.
4. If demo assets exist, build a master vertical demo.
5. Export platform-ready copies for TikTok, Instagram Reels, Facebook Reels, and ReelFarm.

### Song Cuts

The meanings are fixed:

- `hook`: the fastest attention-grabbing clip
- `proof`: the clip that proves the song is about a specific real memory
- `payoff`: the emotional lift or chorus
- `tail`: soft support for CTA or product demo

Read `references/production-rules.md` before choosing windows. If timestamps are known, prefer explicit timestamps over guessing. Sung-audio transcription is unreliable, so do not pretend clip windows are precise if they are not.

Use the cut script instead of rebuilding ffmpeg commands from scratch:

  node .agents/skills/porizo-shortform-pipeline/scripts/cut_song_assets.js \
    --input "<song-file>" \
    --output-dir "marketing/campaigns/output/<slug>/song" \
    --cuts "hook=00:58-01:04,proof=00:18-00:27,payoff=01:54-02:06,tail=02:30-02:36" \
    --title "Thank You Mom"

This writes the clips plus `cuts.json` and `cuts-manifest.md`.

### Product Demo

If the user has screen assets such as `Lyrics`, `Reveal`, and `Now Playing`, assemble one clean 9:16 master video. Keep the reveal audio as the only soundtrack unless the user explicitly wants something else.

Use the builder script:

  node .agents/skills/porizo-shortform-pipeline/scripts/build_product_demo.js \
    --lyrics "marketing/product demo/Lyrics.jpeg" \
    --reveal "marketing/product demo/Thank you mom.mp4" \
    --now-playing "marketing/product demo/Thank you mom2.mp4" \
    --output "marketing/campaigns/output/<slug>/demo/master.mp4"

The script will create a single vertical master that can move through `Lyrics -> Reveal -> Now Playing` when those assets exist.

### Platform Packaging

Do not create separate creative concepts per platform inside the skill. Produce one clean vertical master and then export labeled copies.

Use:

  node .agents/skills/porizo-shortform-pipeline/scripts/export_shortform_pack.js \
    --input "marketing/campaigns/output/<slug>/demo/master.mp4" \
    --output-dir "marketing/campaigns/output/<slug>/platforms" \
    --basename "<slug>"

This creates outputs for:

- TikTok
- Instagram Reels
- Facebook Reels
- ReelFarm

These exports are distribution assets, not a guarantee that the creative itself is optimal for each platform.

## Output Folder Convention

Use one campaign folder per concept under `marketing/campaigns/output/<slug>/`.

The normal structure is:

- `story/`
- `song/`
- `demo/`
- `platforms/`
- `reelfarm/`
- `sources/`

Use the scaffolding script so the structure stays predictable.

## ReelFarm Note

ReelFarm is an asset destination here. Do not try to automate its browser UI by default. Produce:

- the hook text
- the story package
- the audio cuts
- the master demo
- the four platform exports

If the user later wants manual ReelFarm setup help, pair the most appropriate sound cut with the right demo asset and hook, but keep that separate from the skill’s main production path.
